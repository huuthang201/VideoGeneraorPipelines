import type { Timeline } from '../../domain/timeline';

/**
 * Background music must never sit on top of the Vietnamese narration (spec §34:
 * narration > SFX > music).
 *
 * Rather than duck for the whole video - which would make the music pointless -
 * we duck only while words are actually being spoken. The caption pages already
 * carry real word timings from TTS, so they double as a precise map of where
 * speech is, including the gaps between sentences where music can come back up.
 */

export const MUSIC_VOLUME = {
  /** While the narrator is speaking. */
  ducked: 0.06,
  /** In the gaps. Still well under the voice (spec §34 gives 0.08-0.15). */
  open: 0.15,
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
 * this returns the open level throughout rather than ducking forever.
 */
export function musicVolumeAtFrame(
  intervals: readonly SpeechInterval[],
  frame: number,
  fps: number,
): number {
  if (intervals.length === 0) return MUSIC_VOLUME.open;
  const ms = (frame / fps) * 1000;
  return isSpeakingAtMs(intervals, ms) ? MUSIC_VOLUME.ducked : MUSIC_VOLUME.open;
}
