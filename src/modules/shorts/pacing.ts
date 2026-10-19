import type { Pacing } from '../../domain/config';
import { MAX_SCENES, type HookBudget } from './domain/storyboard';

/**
 * Short-form pacing: the two numbers that decide how long a short comes out.
 *
 * Shared by every module built on this machinery, because what they measure is
 * the *narrator*, not the subject matter - the voice, the speed and the
 * punctuation the prompt produces. Two channels reading Vietnamese through
 * Thanh Bình at 1.15 speak at the same rate whatever they are talking about.
 *
 * Not comparable with the podcast module's - a "word" here is a Vietnamese
 * syllable, so this WORDS_PER_MINUTE is roughly twice the English one and says
 * nothing about the narrator being faster.
 */

/**
 * Bounds applied when turning measured audio into scene durations.
 *
 * Short-form numbers. A scene here is one fact - a sentence or two - so two
 * seconds is a legitimate beat rather than a mistake, and anything past twelve
 * means one photograph is holding a quarter of the whole video. The ceiling is
 * a warning threshold only: a scene is never cut short of its narration.
 */
export const SCENE_DURATION_BOUNDS = {
  minSeconds: 2,
  /** Only a warning threshold - a scene is never cut short of its narration. */
  maxSeconds: 12,
  /** Breathing room added after a scene's narration ends, in seconds. */
  tailPaddingSeconds: 0.2,
} as const;

/**
 * Speaking pace used to turn a target length in seconds into a word budget for
 * the prompt.
 *
 * A "word" here is a whitespace token, which in Vietnamese is a syllable - so
 * this number is much larger than the equivalent English one and the two are
 * not comparable.
 *
 * Measured, not guessed, and it has now been re-measured several times - which
 * is the point worth remembering. **Three separate things move it, and the
 * speed control is the smallest of them.**
 *
 * 1. **The voice.** The largest factor by far, and the least obvious. On the
 *    same text at the same speed, Thanh Bình reads 325 wpm and Thái Sơn 248 -
 *    a gap of nearly a third between two voices from the same engine, both
 *    described as storytelling voices. Changing voice without re-measuring is
 *    how a thirty second video comes out at twenty-four.
 * 2. **Punctuation.** The engine pauses at a full stop and barely at a comma,
 *    so how the script is written changes its pace: a chopped script (one short
 *    sentence per scene) and a flowing one differ by about a fifth. When the
 *    prompt changed from statements to explanation, this had to move with it.
 * 3. **The speed**, which is the obvious one.
 *
 * ## Where 325 comes from
 *
 * Not from `npm run tts:pace`, which is one script read once. This is the whole
 * back catalogue: 124 finished videos across both channels, comparing each
 * storyboard's word count against the duration its own timeline came out at.
 *
 *   mean 313.1 wpm · standard deviation 8.4 (2.7%) · range 278-331
 *
 * That is the rate to use as-is. It is tempting to treat it as a "video rate"
 * and add `tailPaddingSeconds` on top, and doing so is wrong: on the measured
 * path `tileAcrossAudio` lays the scenes across the voice track exactly, so a
 * finished video is precisely as long as its narration and there is no padding
 * in these numbers to subtract. See `targetWordsFor`.
 *
 * The previous value of 318 came from a single `tts:pace` run and was 1.6%
 * high, which put every video about half a second under its target - invisible
 * against a thirty-second band, and an eighth of the error budget against a
 * four-second one.
 *
 * **The 2.7% spread is the number that makes a tight band possible at all.** It
 * says a script written to its budget lands within about a second of the
 * intended length, so the length band can be enforced on word count - which is
 * checkable before anything is synthesised - rather than on the rendered file,
 * which is checkable only after ten minutes of work.
 *
 * `npm run tts:pace <script.txt>` measures a single script. Prefer re-running
 * the catalogue comparison; one script is one sample.
 */
export const WORDS_PER_MINUTE = 313;


/**
 * How long one scene holds, in seconds, before the picture wants to change.
 *
 * Five seconds. Long enough that the eye finishes with the photograph, short
 * enough that the video never stops moving - and it lines up with the writing,
 * because five seconds of this voice is about one full Vietnamese sentence.
 */
export const SECONDS_PER_SCENE = 5;

/**
 * How many scenes a video of this length wants.
 *
 * Exported because the prompt states it and the word budget is divided by it -
 * two callers deriving the count separately is how the prompt ends up asking
 * for one shape while the check enforces another.
 */
export function sceneCountFor(targetDurationSec: number): number {
  return Math.min(MAX_SCENES, Math.max(4, Math.round(targetDurationSec / SECONDS_PER_SCENE)));
}

/**
 * Words the script needs to run its intended length.
 *
 * Nothing is subtracted for `tailPaddingSeconds`, and that is worth stating
 * because it looks like an omission. Padding is only added on the fallback path
 * in `buildTimeline`; when the audio was measured - which it always is on a
 * real run - `tileAcrossAudio` lays the scenes across the voice track exactly,
 * so the finished video is precisely as long as the narration. Subtracting the
 * padding anyway makes every video a second short of its target.
 */
export function targetWordsFor(targetDurationSec: number): number {
  return Math.round((targetDurationSec / 60) * WORDS_PER_MINUTE);
}

/**
 * How long the opening line gets, in seconds.
 *
 * Three, and it is the whole design of the format rather than a preference. A
 * viewer scrolling decides in about that long, so everything that might make
 * them stay has to have happened by then: the strange claim, the impact under
 * it, the first subtitle. A hook that runs five seconds is not a longer hook,
 * it is a hook the viewer left in the middle of.
 */
export const HOOK_SECONDS = 3;

/** Words that fit in the opening line. See HOOK_SECONDS. */
export function hookWordsFor(): number {
  return Math.round((HOOK_SECONDS / 60) * WORDS_PER_MINUTE);
}

/**
 * How far past the hook budget an opening line may run before it is sent back.
 *
 * A third, so a good line is never rejected for being seventeen words instead
 * of sixteen - the check is there to catch an opening *paragraph*, which is the
 * failure that actually happens, not to police a syllable.
 */
const HOOK_OVERRUN = 1.35;

/**
 * Everything the structural check needs to judge an opening line.
 *
 * Assembled here because every number in it is a pacing number; the schema
 * module only enforces what this returns. See `HookBudget` there for why the
 * arithmetic cannot live on that side.
 */
export function hookBudget(): HookBudget {
  const words = hookWordsFor();
  return {
    words,
    ceiling: Math.round(words * HOOK_OVERRUN),
    secondsPerWord: 60 / WORDS_PER_MINUTE,
  };
}

export const SHORTS_PACING: Pacing = {
  sceneDuration: SCENE_DURATION_BOUNDS,
  wordsPerMinute: WORDS_PER_MINUTE,
};
