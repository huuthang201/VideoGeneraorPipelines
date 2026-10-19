import type { Pacing } from '../../domain/config';
import { WORDS_PER_MINUTE as SHORTS_WORDS_PER_MINUTE } from '../shorts/pacing';

/**
 * Long-form pacing on the fact channel.
 *
 * The narrator is the same VieNeu preset at the same speed as the shorts, so
 * the rate is the shorts' rate and is imported rather than re-stated - a second
 * copy of a measured constant is a second copy to re-measure. See
 * `shorts/pacing.ts` for where 313 comes from and what moves it.
 *
 * What differs is how long a photograph is held, and that is not a number the
 * shorts could have been parameterised into. A short cuts every five seconds
 * because the format is a cut - there is always something new in the frame. A
 * fifteen-minute explainer that cut every five seconds would be exhausting and
 * would need two hundred photographs, which the search cannot supply and nobody
 * would review.
 */
export const WORDS_PER_MINUTE = SHORTS_WORDS_PER_MINUTE;

/**
 * Bounds applied when turning measured audio into scene durations.
 *
 * The floor is four seconds: below that a photograph reads as a flash rather
 * than as an image. The ceiling is a warning threshold only - a scene is never
 * cut short of its narration - and thirty seconds means one photograph is
 * holding three percent of the video, which for a section-length thought is
 * long but legitimate.
 */
export const SCENE_DURATION_BOUNDS = {
  minSeconds: 4,
  maxSeconds: 30,
  /** Only reached on the fallback path; see `targetWordsFor` in shorts/pacing. */
  tailPaddingSeconds: 0.3,
} as const;

/**
 * How long one scene holds, in seconds, before the picture wants to change.
 *
 * Eleven seconds, against the shorts' five. Long enough that a viewer settles
 * into a photograph rather than being cut away from it, short enough that a
 * seventeen-minute video is not a slideshow. It also sets the arithmetic that
 * makes this format possible at all: at eleven seconds a seventeen-minute video
 * is about ninety scenes, and ninety scenes over a dozen image queries is a
 * pool the search can actually fill.
 */
export const SECONDS_PER_SCENE = 11;

/** Words the script needs to run its intended length. */
export function targetWordsFor(targetDurationSec: number): number {
  return Math.round((targetDurationSec / 60) * WORDS_PER_MINUTE);
}

export const FACTLONG_PACING: Pacing = {
  sceneDuration: SCENE_DURATION_BOUNDS,
  wordsPerMinute: WORDS_PER_MINUTE,
};
