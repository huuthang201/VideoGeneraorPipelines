import type { ProcessedImage } from '../domain/project';
import type { CaptionPage, Timeline, TimelineScene } from '../domain/timeline';
import { creditLine, type ImageCredit } from '../image/credit';
import type { ModuleId, Pacing } from '../domain/config';
import type { SceneLike, StoryboardLike } from '../modules/contract';
import type { WordTiming } from '../tts/types';
import { alignByProportion, alignScenesToWords, type AlignmentResult } from '../tts/align';
import { estimateWordTimings } from '../tts/estimate-words';
import { defaultFitFor } from '../remotion/layout/fit';

/**
 * Turns a storyboard plus a measured voice track into the frame-exact Timeline
 * that Remotion renders.
 *
 * This is the single place where seconds become frames. Everything upstream
 * talks in text and milliseconds; everything downstream sees only integers.
 * Claude's `scene.duration` is read *only* when there is no audio to measure -
 * which is what makes caption drift a structural impossibility rather than
 * something to be careful about.
 *
 * Pure and I/O-free by design: this is the highest-risk logic in the codebase,
 * so it has to be exhaustively testable without rendering anything.
 */

/** One scene's photograph, already downloaded and normalised. */
export interface SceneBackdrop {
  image: ProcessedImage;
  /** Null for a hand-assembled timeline whose picture names no source. */
  credit: ImageCredit | null;
}

export interface BuildTimelineInput<S extends SceneLike> {
  storyboard: StoryboardLike<S>;
  /** Stamped into the timeline so Remotion can pick the right theme pack. */
  module: ModuleId;
  /**
   * Scene-duration bounds and speaking pace, from the module.
   *
   * A parameter rather than an import because the two modules disagree by an
   * order of magnitude - a podcast scene may run forty-five seconds where a
   * short's ceiling is twelve - and a constant that was right for one would
   * silently clamp every scene of the other.
   */
  pacing: Pacing;
  /** See `defaultFitFor` - the two modules crop very differently. */
  coverTolerance: number;
  /**
   * Turns a scene's measured words into subtitle pages.
   *
   * Supplied by the module because the two subtitle very differently: one line
   * broken at heard pauses, or two lines with a translation divided across
   * them. See each module's `captions.ts`.
   */
  buildCaptions: (input: {
    words: readonly WordTiming[];
    sceneStartMs: number;
    durationInFrames: number;
    fps: number;
    scene: S;
  }) => CaptionPage[];
  /**
   * The photograph for each scene, keyed by scene id.
   *
   * Keyed by scene rather than looked up by filename, which is what this took
   * when only the podcast existed and its storyboards named files in a library.
   * The fact module has no library to name a file in - it searches for each
   * scene's `imageQuery` and hands back whatever it found - so the scene id is
   * the only thing both modules can agree on.
   */
  backdrops: ReadonlyMap<string, SceneBackdrop>;
  /** Path to voice.mp3 relative to the Remotion public dir, or null pre-TTS. */
  voiceSrc: string | null;
  /** Measured container length in seconds. 0 when there is no voice. */
  voiceDurationSec: number;
  words: readonly WordTiming[];
  /** Maps a processed image to its path relative to the public dir. */
  imageSrcFor: (image: ProcessedImage) => string;
  music?: { src: string; volume: number } | null;
}

export interface BuildTimelineOutput {
  timeline: Timeline;
  diagnostics: {
    alignmentConfidence: number;
    usedFallbackAlignment: boolean;
    clampedScenes: string[];
    /**
     * Scenes that run longer than the module's `pacing.sceneDuration.maxSeconds`.
     *
     * Not an error and not clamped: when the length came from measured audio,
     * shortening the scene would cut the narration off. It does mean the same
     * photo sits on screen a long time, which usually points at a scene whose
     * narration should have been split - so it is surfaced for the caller to
     * warn about rather than silently corrected.
     */
    longScenes: string[];
    /** Difference between the voice track and the video, in seconds. */
    voiceOverhangSec: number;
  };
}

export function buildTimeline<S extends SceneLike>(
  input: BuildTimelineInput<S>,
): BuildTimelineOutput {
  const { storyboard, backdrops, words, voiceDurationSec, pacing } = input;
  const bounds = pacing.sceneDuration;
  const fps = storyboard.video.fps;
  const scenes = storyboard.scenes;

  const frameAspect = storyboard.video.width / storyboard.video.height;

  const alignment = resolveAlignment(
    scenes.map((s) => ({ id: s.id, narration: s.narration })),
    words,
    voiceDurationSec,
  );

  const clampedScenes: string[] = [];
  const voiceMs = voiceDurationSec * 1000;

  const hasMeasuredAudio = alignment !== null && !alignment.usedFallback && voiceMs > 0;

  const durations = hasMeasuredAudio
    ? tileAcrossAudio(
        alignment!.scenes.map((s) => s.startMs),
        voiceMs,
        fps,
        scenes,
        clampedScenes,
        bounds.minSeconds,
      )
    : scenes.map((scene, index) => {
        const aligned = alignment?.scenes[index];
        const spokenSec = aligned ? (aligned.endMs - aligned.startMs) / 1000 : scene.duration;
        const withPadding = spokenSec + bounds.tailPaddingSeconds;

        const clamped = Math.min(
          bounds.maxSeconds,
          Math.max(bounds.minSeconds, withPadding),
        );
        if (Math.abs(clamped - withPadding) > 1e-6) clampedScenes.push(scene.id);

        // At least one frame regardless - a zero-length Sequence renders nothing.
        return Math.max(1, Math.round(clamped * fps));
      });

  // Pass 2: lay them end to end. `from` is the running sum, which is the
  // invariant the Timeline schema re-checks and the transitions rely on.
  let cursor = 0;
  const timelineScenes: TimelineScene[] = scenes.map((scene, index) => {
    const durationInFrames = durations[index]!;
    const from = cursor;
    cursor += durationInFrames;

    const backdrop = backdrops.get(scene.id);
    if (!backdrop) {
      throw new Error(
        `Scene "${scene.id}" has no photograph. Every scene is resolved before the timeline is ` +
          `built, so this means the image stage and the storyboard disagree about scene ids.`,
      );
    }
    const background = backdrop.image;

    const aligned = alignment?.scenes[index];

    /*
     * A scene with a span but no words means the audio arrived without
     * timings - an external voice track, or a provider that reports none.
     * Estimating them here rather than shrugging is the difference between
     * approximate subtitles and no subtitles at all.
     */
    const sceneWords =
      aligned && aligned.words.length === 0 && scene.narration.trim()
        ? estimateWordTimings(scene.narration, aligned.startMs, aligned.endMs)
        : (aligned?.words ?? []);

    return {
      id: scene.id,
      type: scene.type,
      from,
      durationInFrames,
      title: scene.title,
      background: {
        src: input.imageSrcFor(background),
        width: background.width,
        height: background.height,
        fit: defaultFitFor(background.aspectRatio, frameAspect, input.coverTolerance),
        credit: backdrop.credit
          ? {
              label: creditLine(backdrop.credit),
              creator: backdrop.credit.creator,
              license: backdrop.credit.license,
              licenseUrl: backdrop.credit.licenseUrl,
              sourceUrl: backdrop.credit.sourceUrl,
            }
          : null,
      },
      // Rebased against where the scene actually starts on the timeline, not
      // against its first spoken word. Those differ - scene 1 begins at frame 0
      // while speech begins a little later - and using the word onset would
      // shift every caption early by that lead-in.
      captionPages: aligned
        ? input.buildCaptions({
            words: sceneWords,
            sceneStartMs: (from / fps) * 1000,
            durationInFrames,
            fps,
            scene,
          })
        : [],
      animation: scene.animation,
      transition: scene.transition,
      effect: scene.effect,
      overlay: scene.overlay,
    };
  });

  const durationInFrames = cursor;

  const timeline: Timeline = {
    version: '1.0',
    projectId: storyboard.project.id,
    video: {
      width: storyboard.video.width,
      height: storyboard.video.height,
      fps,
      durationInFrames,
    },
    style: storyboard.video.style,
    module: input.module,
    voice:
      input.voiceSrc && voiceDurationSec > 0
        ? {
            src: input.voiceSrc,
            durationInFrames: Math.max(1, Math.round(voiceDurationSec * fps)),
          }
        : null,
    music: input.music ?? null,
    scenes: timelineScenes,
  };

  return {
    timeline,
    diagnostics: {
      alignmentConfidence: alignment?.confidence ?? 0,
      usedFallbackAlignment: alignment?.usedFallback ?? true,
      clampedScenes,
      longScenes: timelineScenes
        .filter((s) => s.durationInFrames > bounds.maxSeconds * fps)
        .map((s) => s.id),
      voiceOverhangSec: voiceDurationSec - durationInFrames / fps,
    },
  };
}

/**
 * Lays scenes end to end so that together they cover the entire voice track.
 *
 * The obvious approach - give each scene the span from its first spoken word to
 * its last - loses time, and the loss is invisible until you compare durations:
 * the pauses *between* scenes and the trailing silence after the final word
 * belong to no scene and simply vanish. On the first M2 run that silently
 * truncated a 17.4s narration into a 15.0s video, cutting off the call to
 * action.
 *
 * So scenes are defined by their boundaries rather than their spans. A scene
 * runs from where its own speech begins until where the next scene's speech
 * begins, and the last one runs to the end of the audio. Total video length
 * then equals total audio length by construction.
 *
 * @param starts absolute ms at which each scene's speech begins
 */
function tileAcrossAudio(
  starts: readonly number[],
  voiceMs: number,
  fps: number,
  scenes: readonly { id: string }[],
  clampedScenes: string[],
  /** The module's floor on a scene, in seconds. */
  minSeconds: number,
): number[] {
  const n = starts.length;
  const minMs = minSeconds * 1000;

  // Boundaries[0] is 0 rather than the first word's onset: the video has to
  // start at frame 0, and the brief lead-in before speech is useful headroom
  // for the hook's entry animation.
  const bounds: number[] = [0];
  for (let k = 1; k < n; k++) bounds.push(starts[k]!);
  bounds.push(voiceMs);

  // Push boundaries forward where a scene would be too short to read. Working
  // left to right keeps them ordered; the final boundary is restored afterwards
  // so the total still matches the audio.
  for (let k = 1; k <= n; k++) {
    const minimum = bounds[k - 1]! + minMs;
    if (bounds[k]! < minimum) {
      if (k < n) clampedScenes.push(scenes[k - 1]!.id);
      bounds[k] = minimum;
    }
  }

  // If the minimums overflowed the track, the video legitimately outlasts the
  // audio - better a short trailing silence than an unreadably fast scene.
  bounds[n] = Math.max(bounds[n]!, bounds[n - 1]! + minMs);

  // Convert cumulatively so rounding error cannot accumulate across scenes:
  // each duration is the difference of two rounded absolute positions.
  const frameAt = (ms: number) => Math.round((ms / 1000) * fps);
  const durations: number[] = [];
  for (let k = 0; k < n; k++) {
    durations.push(Math.max(1, frameAt(bounds[k + 1]!) - frameAt(bounds[k]!)));
  }
  return durations;
}

function resolveAlignment(
  scenes: readonly { id: string; narration: string }[],
  words: readonly WordTiming[],
  voiceDurationSec: number,
): AlignmentResult | null {
  const fromWords = alignScenesToWords(scenes, words);
  if (fromWords) return fromWords;

  // Audio exists but carried no word timings - still better to split the real
  // measured duration than to trust the model's guesses.
  if (voiceDurationSec > 0) return alignByProportion(scenes, voiceDurationSec * 1000);

  return null;
}

/**
 * Groups a scene's words into subtitle lines, rebased so 0ms is the scene's
 * first frame.
 *
 * ## Short lines, broken where the voice breaks
 *
 * A page ends wherever the narrator stops: at a full stop, and at any real gap
 * between two words. Both matter for different reasons. The sentence break
 * keeps a line from carrying the tail of one thought and the head of the next,
 * which is unreadable at this pace; the pause break is what makes the subtitle
 * feel *timed to the voice* rather than merely synchronised with it - the line
 * changes exactly where the speaker takes a breath.
 *
 * `MAX_WORDS_PER_PAGE` is the backstop for a clause the voice runs through
 * without pausing. When it fires, the page is cut at the last comma rather than
 * at the twelfth word, because the twelfth word is as likely as not to be the
 * first half of something: "mà vi" / "khuẩn thì cần nước" is a subtitle that
 * says nothing on either line. `SOFT_BREAK` is what that cut looks for, and it
 * is why a page can come out shorter than the ceiling for no visible reason.
 *
 * The ceiling is low because the frame is nine by sixteen and the type is set
 * large enough to read on a phone at arm's length. Twelve Vietnamese syllables
 * is about two lines at that size; more than that and the block starts covering
 * the photograph it is supposed to sit on.
 *
 * Pages are clipped to the scene: a scene is padded and clamped after
 * alignment, so without this a page could reference a time the scene never
 * reaches and the caption would simply never appear.
 */
