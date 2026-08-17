import type { WordTiming } from './types';

/**
 * SRT serialisation for the `captions.srt` deliverable (spec §46).
 *
 * The file is for humans and for upload tools - the renderer never reads it.
 * Remotion gets caption pages straight from the timeline, so there is no path
 * where a rounding difference in this formatting could desync the video.
 */

export interface SrtCue {
  index: number;
  fromMs: number;
  toMs: number;
  text: string;
}

/** Groups words into readable cues at natural pauses. */
export function wordsToCues(
  words: readonly WordTiming[],
  options: { maxWordsPerCue?: number; maxGapMs?: number } = {},
): SrtCue[] {
  const maxWords = options.maxWordsPerCue ?? 8;
  const maxGap = options.maxGapMs ?? 700;

  const cues: SrtCue[] = [];
  let current: WordTiming[] = [];

  const flush = () => {
    if (current.length === 0) return;
    cues.push({
      index: cues.length + 1,
      fromMs: current[0]!.fromMs,
      toMs: current[current.length - 1]!.toMs,
      text: current.map((w) => w.text).join(' '),
    });
    current = [];
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    const gap = previous ? word.fromMs - previous.toMs : 0;

    if (current.length >= maxWords || (previous && gap > maxGap)) flush();
    current.push(word);
  }
  flush();

  return cues;
}

export function serializeSrt(cues: readonly SrtCue[]): string {
  return (
    cues
      .map((cue) => `${cue.index}\n${formatTime(cue.fromMs)} --> ${formatTime(cue.toMs)}\n${cue.text}`)
      .join('\n\n') + '\n'
  );
}

function formatTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;

  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}
