import type { Pacing } from '../../domain/config';

/**
 * Podcast pacing: the two numbers that decide how long an episode comes out.
 *
 * Both are measured through the module's own voice and rate. They are not
 * comparable with the fact module's - a "word" there is a Vietnamese syllable.
 */

/**
 * Bounds applied when turning measured audio into scene durations.
 *
 * Both ends are much wider than a short-form video would want. A scene here is
 * a paragraph, so twenty-five seconds on one photograph is normal rather than a
 * mistake; the floor exists only so a one-line scene still has time to be read.
 */
export const SCENE_DURATION_BOUNDS = {
  minSeconds: 4,
  /** Only a warning threshold - a scene is never cut short of its narration. */
  maxSeconds: 45,
  /** Breathing room added after a scene's narration ends, in seconds. */
  tailPaddingSeconds: 0.4,
} as const;

/**
 * Speaking pace used to turn a target length in minutes into a word budget for
 * the prompt.
 *
 * Measured, not guessed, and measured on a real script rather than on a
 * sentence - the pauses between sentences and paragraphs dominate the average,
 * so a short sample reads twenty percent faster than an episode does. On the
 * same 600-word excerpt, through the configured default voice:
 *
 *   en-US-AriaNeural  -20%  258.7s  ->  139 wpm   <- configured
 *   en-US-AriaNeural  -10%  230.0s  ->  157 wpm
 *   en-US-AriaNeural   +0%  207.0s  ->  174 wpm
 *   en-US-AnaNeural   -20%  300.6s  ->  120 wpm
 *
 * Read the configured line against the last one: at the *same* -20%, two voices
 * differ by 19 wpm, which is most of a whole rate step. So this constant tracks
 * the pair in .env, not the rate alone - change either and re-measure, or every
 * episode comes out the wrong length.
 *
 * 139 is unhurried rather than slow: an audiobook sits at 150-160, a news read
 * well above 200.
 */
export const WORDS_PER_MINUTE = 139;


export const PODCAST_PACING: Pacing = {
  sceneDuration: SCENE_DURATION_BOUNDS,
  wordsPerMinute: WORDS_PER_MINUTE,
};
