import type { WordTiming } from './types';

/**
 * Puts the punctuation back into TTS word timings.
 *
 * Edge reports one boundary event per spoken word, and those events carry the
 * *spoken* form: "Good", "morning", "or" - never "Good", "morning,", "or". The
 * timings are what the captions are built from, so without this every subtitle
 * in the video reads as an unbroken run of words with no commas and no full
 * stops. On a three-second short nobody noticed; on ten minutes of subtitles
 * someone is reading along with, it is the difference between prose and a word
 * list.
 *
 * The fix is to walk the original script alongside the returned words and hand
 * each timing back its own token, punctuation and all.
 *
 * Matching is by normalised form with a small lookahead rather than by strict
 * position, because the two sequences are not always the same length: the
 * service expands "1969" into three spoken words, and splits some hyphenated
 * compounds. When a word cannot be matched it keeps the spoken form and the
 * cursor does not advance, so an expansion costs that one word its punctuation
 * instead of desynchronising everything after it.
 */

/**
 * How far ahead to look for a match before giving up on a word.
 *
 * Six covers the longest expansions in practice ("one thousand nine hundred and
 * sixty nine") while staying too short to leap over a repeated word and steal a
 * later sentence's comma.
 */
const LOOKAHEAD = 6;

const normalize = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function restorePunctuation(
  source: string,
  words: readonly WordTiming[],
): WordTiming[] {
  const tokens = source.split(/\s+/).filter(Boolean);
  let cursor = 0;

  return words.map((word) => {
    const target = normalize(word.text);
    if (!target) return { ...word };

    const limit = Math.min(tokens.length, cursor + LOOKAHEAD);
    for (let i = cursor; i < limit; i++) {
      if (normalize(tokens[i]!) === target) {
        cursor = i + 1;
        return { ...word, text: tokens[i]! };
      }
    }

    return { ...word };
  });
}
