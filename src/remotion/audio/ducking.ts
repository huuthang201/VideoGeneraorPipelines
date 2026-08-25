import type { Timeline } from '../../domain/timeline';

/**
 * Background music must never sit on top of the narration.
 *
 * Nothing sets a music track today - the pipeline passes `music: null` - so this
 * is inert until one is added. It is kept because the mixing rule is the part
 * that is easy to get wrong, not the wiring.
 *
 * Rather than duck for the whole video - which would make the music pointless -
 * we duck only while words are actually being spoken. The caption pages already
 * carry real word timings from TTS, so they double as a precise map of where
 * speech is, including the gaps between sentences where music can come back up.
 */

/**
 * Duck *factors*, not levels: the number here multiplies `MUSIC_VOLUME` from
 * configuration rather than replacing it.
 *
 * That distinction was a real bug, and an invisible one. These used to be
 * absolute levels (0.06 and 0.15) and the composition *also* multiplied by the
 * configured volume, so a perfectly reasonable MUSIC_VOLUME=0.12 came out at
 * 0.0072 under speech - inaudible on any speaker, while every log line said
 * the music track was present and mixed.
 *
 * 0.35 under speech is far enough down that the voice is never fighting it and
 * far enough up that a listener can tell the music did not stop.
 */
export const MUSIC_DUCK = {
  /** While the narrator is speaking. */
  ducked: 0.35,
  /** In the gaps between sentences and scenes. */
  open: 1,
} as const;

/** Milliseconds of lead-in/out so the music dips before a word, not on it. */
const DUCK_LEAD_MS = 180;
const DUCK_TAIL_MS = 320;

export interface SpeechInterval {
  fromMs: number;
  toMs: number;
}

/**
 * Absolute speech intervals across the whole composition, merged so that
 * overlapping or near-adjacent runs of speech become one span.
 */
export function buildSpeechIntervals(timeline: Timeline): SpeechInterval[] {
  const fps = timeline.video.fps;
  const raw: SpeechInterval[] = [];

  for (const scene of timeline.scenes) {
    const sceneStartMs = (scene.from / fps) * 1000;
    for (const page of scene.captionPages) {
      raw.push({
        fromMs: sceneStartMs + page.startMs - DUCK_LEAD_MS,
        toMs: sceneStartMs + page.startMs + page.durationMs + DUCK_TAIL_MS,
      });
    }
  }

  if (raw.length === 0) return [];

  raw.sort((a, b) => a.fromMs - b.fromMs);

  const merged: SpeechInterval[] = [{ ...raw[0]! }];
  for (const interval of raw.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (interval.fromMs <= last.toMs) {
      last.toMs = Math.max(last.toMs, interval.toMs);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

export function isSpeakingAtMs(intervals: readonly SpeechInterval[], ms: number): boolean {
  return intervals.some((i) => ms >= i.fromMs && ms < i.toMs);
}

/**
 * Music volume for a given frame.
 *
 * With no caption data at all (a timeline built before TTS exists, as in M1)
 * this returns the open factor throughout rather than ducking forever.
 */
export function musicVolumeAtFrame(
  intervals: readonly SpeechInterval[],
  frame: number,
  fps: number,
): number {
  if (intervals.length === 0) return MUSIC_DUCK.open;
  const ms = (frame / fps) * 1000;
  return isSpeakingAtMs(intervals, ms) ? MUSIC_DUCK.ducked : MUSIC_DUCK.open;
}
