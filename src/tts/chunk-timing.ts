import type { WordTiming } from './types';

/**
 * Derives word timings from sentence-level measurements.
 *
 * The Edge service this replaces reported the exact position of every word.
 * VieNeu reports nothing but audio, which would leave the pipeline with no way
 * to highlight the spoken word (spec §18) or to place scene cuts on real speech
 * (the timeline builder). Dropping either was not acceptable, and adding a
 * forced-alignment model to recover them would mean shipping a second neural
 * network to caption a video the first one just spoke.
 *
 * The middle path: synthesise sentence by sentence, so every sentence boundary
 * is a *measured* fact, and interpolate word positions within each sentence.
 * The error is therefore bounded by one sentence rather than accumulating over
 * a whole narration, and scene cuts - which fall on sentence boundaries anyway
 * - stay exact.
 *
 * Interpolation is weighted by syllable count rather than character count.
 * Vietnamese is syllable-timed and written with syllables separated by spaces,
 * so each whitespace token takes roughly equal time to say. That makes token
 * count a far better predictor of duration here than it would be in English.
 */

export interface SynthesisChunk {
  text: string;
  fromMs: number;
  toMs: number;
}

/**
 * Fraction of a word's slot left as a gap before the next one begins, so the
 * caption highlight steps between words instead of sliding continuously.
 */
const INTER_WORD_GAP = 0.12;

export function distributeWordsAcrossChunks(chunks: readonly SynthesisChunk[]): WordTiming[] {
  const words: WordTiming[] = [];

  for (const chunk of chunks) {
    const tokens = chunk.text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    const span = chunk.toMs - chunk.fromMs;
    if (span <= 0) continue;

    // Punctuation-heavy tokens are spoken no slower than bare ones, but a token
    // that is *only* punctuation carries no speech at all and should not be
    // given a share of the sentence.
    const weights = tokens.map((t) => (hasLetters(t) ? syllableWeight(t) : 0));
    const total = weights.reduce((a, b) => a + b, 0);

    if (total === 0) continue;

    let cursor = chunk.fromMs;
    tokens.forEach((token, index) => {
      const share = (weights[index]! / total) * span;
      const from = cursor;
      const to = from + share;
      cursor = to;

      if (weights[index] === 0) return;

      words.push({
        text: token,
        fromMs: round2(from),
        // The gap is taken off the end of the slot, so the next word still
        // starts where this one's slot ended and the sentence stays aligned.
        toMs: round2(Math.max(from + 1, to - share * INTER_WORD_GAP)),
      });
    });
  }

  return words;
}

/**
 * Rough spoken length of a whitespace token.
 *
 * Vietnamese words are one syllable each, so the base is 1. Latin runs longer
 * than a syllable - an English brand name, a model number - take proportionally
 * longer to say, and digits are read out one at a time.
 */
function syllableWeight(token: string): number {
  const stripped = token.replace(/[^\p{L}\p{N}]/gu, '');
  if (!stripped) return 0;

  const digits = (stripped.match(/\p{N}/gu) ?? []).length;
  if (digits > 0) {
    // "2026" is four spoken syllables, not one word.
    return Math.max(1, digits);
  }

  // Vietnamese syllables are short; treat anything much longer as multi-syllable.
  return Math.max(1, Math.round(stripped.length / 4));
}

function hasLetters(token: string): boolean {
  return /[\p{L}\p{N}]/u.test(token);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
