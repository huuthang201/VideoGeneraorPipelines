import type { WordTiming } from './types';

/**
 * Word timings estimated from a span, for audio that came with none.
 *
 * Every real provider here reports where each word was spoken, and everything
 * downstream is built on that: the scene cuts land on speech, and the subtitle
 * highlights the word being said. An audio track that arrives from outside the
 * pipeline - rendered by hand in some other tool and dropped into the job
 * folder - has no such information, and the honest fallback (splitting each
 * scene's span proportionally) produced scenes with *no words at all*, which
 * meant a video with no subtitles rather than one with approximate ones.
 *
 * So the span is filled in: each scene's words are laid across the time that
 * scene actually occupies, weighted by length. It is an estimate and reads like
 * one under a stopwatch - but the subtitle here is a whole line shown at once,
 * not a karaoke bounce, so a word being fifty milliseconds early is invisible.
 * The line changes at the right time because the scene boundaries are real.
 */

/** Fraction of a word's slot left as a gap, so highlights step rather than slide. */
const INTER_WORD_GAP = 0.1;

/**
 * Longer words take longer to say, but not proportionally - every word carries
 * onset and release regardless of length. A constant floor plus the character
 * count tracks measured speech far better than either alone.
 */
const BASE_WEIGHT = 2.5;

export function estimateWordTimings(text: string, fromMs: number, toMs: number): WordTiming[] {
  const tokens = text.split(/\s+/u).filter(Boolean);
  const span = toMs - fromMs;
  if (tokens.length === 0 || span <= 0) return [];

  const weights = tokens.map((token) => BASE_WEIGHT + token.replace(/[^\p{L}\p{N}]/gu, '').length);
  const total = weights.reduce((a, b) => a + b, 0);

  let cursor = fromMs;
  return tokens.map((token, index) => {
    const slot = (weights[index]! / total) * span;
    const from = cursor;
    cursor += slot;
    return { text: token, fromMs: from, toMs: cursor - slot * INTER_WORD_GAP };
  });
}
