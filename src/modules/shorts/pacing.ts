import type { Pacing } from '../../domain/config';

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
 *    same text at the same speed, Thanh Bình reads 318 wpm and Thái Sơn 248 -
 *    a 28% gap between two voices from the same engine, both described as
 *    storytelling voices. Changing voice without re-measuring is how a
 *    forty-five second video comes out at thirty-five.
 * 2. **Punctuation.** The engine pauses at a full stop and barely at a comma,
 *    so how the script is written changes its pace: a chopped script (one short
 *    sentence per scene) and a flowing one differ by about a fifth. When the
 *    prompt changed from statements to explanation, this had to move with it.
 * 3. **The speed**, which is the obvious one.
 *
 * Through the configured voice, on a real script of the shape the prompt now
 * produces:
 *
 *   VieNeu · Thanh Bình · speed 1.00   268 wpm
 *   VieNeu · Thanh Bình · speed 1.15   318 wpm   <- configured
 *   VieNeu · Thanh Bình · speed 1.30   352 wpm
 *
 * For the record: Thái Sơn at 1.15 is 248 wpm, and the Edge fallback measured
 * 232 on vi-VN-NamMinhNeural at rate +0%.
 *
 * `npm run tts:pace <script.txt>` does the measurement. Run it on a real
 * script, never on a passage of prose.
 */
export const WORDS_PER_MINUTE = 318;


/** Words the script needs to run its intended length. See WORDS_PER_MINUTE. */
export function targetWordsFor(targetDurationSec: number): number {
  return Math.round((targetDurationSec / 60) * WORDS_PER_MINUTE);
}

/**
 * How long one scene holds, in seconds, before the picture wants to change.
 *
 * Five seconds. Long enough that the eye finishes with the photograph, short
 * enough that the video never stops moving - and it lines up with the writing,
 * because five seconds of this voice is about one full Vietnamese sentence.
 */
export const SECONDS_PER_SCENE = 5;

export const SHORTS_PACING: Pacing = {
  sceneDuration: SCENE_DURATION_BOUNDS,
  wordsPerMinute: WORDS_PER_MINUTE,
};
