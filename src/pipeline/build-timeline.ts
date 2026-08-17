import type { Storyboard } from '../domain/storyboard';
import type { ProcessedImage } from '../domain/project';
import type { CaptionPage, Timeline, TimelineScene } from '../domain/timeline';
import { SCENE_DURATION_BOUNDS } from '../domain/config';
import type { WordTiming } from '../tts/types';
import { alignByProportion, alignScenesToWords, type AlignmentResult } from '../tts/align';
import { defaultFitFor } from '../remotion/layout/fit';

/**
 * Turns a storyboard plus a measured voice track into the frame-exact Timeline
 * that Remotion renders (plan §2.2).
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

export interface BuildTimelineInput {
  storyboard: Storyboard;
  images: readonly ProcessedImage[];
  /** Path to voice.mp3 relative to the Remotion public dir, or null pre-TTS. */
  voiceSrc: string | null;
  /** Measured container length in seconds. 0 when there is no voice. */
  voiceDurationSec: number;
  words: readonly WordTiming[];
  /** Maps a source filename to its path relative to the public dir. */
  imageSrcFor: (filename: string) => string;
  music?: { src: string; volume: number } | null;
}

export interface BuildTimelineOutput {
  timeline: Timeline;
  diagnostics: {
    alignmentConfidence: number;
    usedFallbackAlignment: boolean;
    clampedScenes: string[];
    /**
     * Scenes that run longer than SCENE_DURATION_BOUNDS.maxSeconds.
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

export function buildTimeline(input: BuildTimelineInput): BuildTimelineOutput {
  const { storyboard, images, words, voiceDurationSec } = input;
  const fps = storyboard.video.fps;
  const scenes = storyboard.scenes;

  const imageByName = new Map(images.map((img) => [img.filename, img]));

  const alignment = resolveAlignment(
    scenes.map((s) => ({ id: s.id, narration: s.narration })),
    words,
    voiceDurationSec,
  );

  const clampedScenes: string[] = [];
  const voiceMs = voiceDurationSec * 1000;

  const hasMeasuredAudio = alignment !== null && !alignment.usedFallback && voiceMs > 0;

  const durations = hasMeasuredAudio
    ? tileAcrossAudio(alignment!.scenes.map((s) => s.startMs), voiceMs, fps, scenes, clampedScenes)
    : scenes.map((scene, index) => {
        const aligned = alignment?.scenes[index];
        const spokenSec = aligned ? (aligned.endMs - aligned.startMs) / 1000 : scene.duration;
        const withPadding = spokenSec + SCENE_DURATION_BOUNDS.tailPaddingSeconds;

        const clamped = Math.min(
          SCENE_DURATION_BOUNDS.maxSeconds,
          Math.max(SCENE_DURATION_BOUNDS.minSeconds, withPadding),
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

    const image = imageByName.get(scene.asset);
    if (!image) {
      throw new Error(
        `Scene "${scene.id}" references "${scene.asset}", which is not among the processed images: ` +
          `${images.map((i) => i.filename).join(', ')}`,
      );
    }

    const aligned = alignment?.scenes[index];

    return {
      id: scene.id,
      type: scene.type,
      from,
      durationInFrames,
      headline: scene.headline,
      image: {
        src: input.imageSrcFor(image.filename),
        width: image.width,
        height: image.height,
        fit: defaultFitFor(image.orientation),
      },
      // Rebased against where the scene actually starts on the timeline, not
      // against its first spoken word. Those differ - scene 1 begins at frame 0
      // while speech begins a little later - and using the word onset would
      // shift every caption early by that lead-in.
      captionPages: aligned
        ? buildCaptionPages(aligned.words, (from / fps) * 1000, durationInFrames, fps)
        : [],
      animation: scene.animation,
      transition: scene.transition,
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
        .filter((s) => s.durationInFrames > SCENE_DURATION_BOUNDS.maxSeconds * fps)
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
): number[] {
  const n = starts.length;
  const minMs = SCENE_DURATION_BOUNDS.minSeconds * 1000;

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
 * Groups a scene's words into 2-5 word pages with word-level tokens (spec §18),
 * rebased so 0ms is the scene's first frame.
 *
 * Pages are clipped to the scene: a scene is padded and clamped after alignment,
 * so without this a page could reference a time the scene never reaches and the
 * caption would simply never appear.
 */
export function buildCaptionPages(
  words: readonly WordTiming[],
  sceneStartMs: number,
  durationInFrames: number,
  fps: number,
): CaptionPage[] {
  if (words.length === 0) return [];

  const sceneDurationMs = (durationInFrames / fps) * 1000;
  const MAX_WORDS_PER_PAGE = 5;
  const MIN_WORDS_PER_PAGE = 2;
  const MAX_GAP_MS = 480;

  const pages: CaptionPage[] = [];
  let current: WordTiming[] = [];

  const flush = () => {
    if (current.length === 0) return;

    const tokens = current.map((w) => ({
      text: w.text,
      fromMs: clamp(w.fromMs - sceneStartMs, 0, sceneDurationMs),
      toMs: clamp(w.toMs - sceneStartMs, 0, sceneDurationMs),
    }));

    const startMs = tokens[0]!.fromMs;
    const endMs = tokens[tokens.length - 1]!.toMs;

    // A page whose words were entirely clipped away carries no information.
    if (endMs > startMs) {
      pages.push({
        text: current.map((w) => w.text).join(' '),
        startMs,
        // Hold the page until the next one starts rather than blinking out the
        // instant the last word ends.
        durationMs: Math.min(endMs - startMs + 260, sceneDurationMs - startMs),
        tokens,
      });
    }
    current = [];
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    const gap = previous ? word.fromMs - previous.toMs : 0;

    const full = current.length >= MAX_WORDS_PER_PAGE;
    const naturalBreak = current.length >= MIN_WORDS_PER_PAGE && gap > MAX_GAP_MS;

    if (full || naturalBreak) flush();
    current.push(word);
  }
  flush();

  return pages;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
