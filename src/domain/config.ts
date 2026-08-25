import { z } from 'zod';

/** Styles are theme objects, not duplicated component trees. */
export const STYLES = ['calm', 'warm', 'night'] as const;
export const StyleNameSchema = z.enum(STYLES);
export type StyleName = z.infer<typeof StyleNameSchema>;

/**
 * Which pipeline a project belongs to.
 *
 * Carried in the timeline as well as in configuration, because it has to
 * survive the crossing into the browser: Remotion picks its theme pack by this
 * value, and the bundle has no access to node config or to .env.
 */
export const MODULE_IDS = ['podcast', 'fact', 'psych'] as const;
export const ModuleIdSchema = z.enum(MODULE_IDS);
export type ModuleId = z.infer<typeof ModuleIdSchema>;

/**
 * Output format. Fixed by the system, never by Claude - the frame size is a
 * delivery decision (16:9 for an ordinary feed, 9:16 for Shorts) that belongs
 * to whoever publishes the video, so letting the model emit it would only add
 * a way for a render to come out the wrong shape.
 */
export const VideoConfigSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  targetDuration: z.number().positive(),
  durationMin: z.number().positive(),
  durationMax: z.number().positive(),
  style: StyleNameSchema,
});

export type VideoConfig = z.infer<typeof VideoConfigSchema>;

/**
 * The ceiling that decides whether an upload is a Short at all.
 *
 * Nothing in the YouTube API says "this is a Short" - there is no field, no
 * flag, no endpoint. The platform decides for itself from two things it can
 * measure: the frame is vertical, and the video is short. `#shorts` in the
 * description is a discovery aid, not the mechanism.
 *
 * So this number is the whole feature, and crossing it is silent: the upload
 * succeeds, the video appears on the channel, and it is simply never served in
 * the Shorts feed. Sixty seconds rather than the three minutes YouTube now
 * permits, because the Shorts *feed* still behaves quite differently either
 * side of a minute and the fact module exists to feed it.
 *
 * Only the fact module defends this. A podcast episode is meant to be an
 * ordinary video and crosses it by design.
 */
export const SHORTS_MAX_SECONDS = 60;

export const ASPECTS = ['landscape', 'portrait'] as const;
export const AspectSchema = z.enum(ASPECTS);
export type Aspect = z.infer<typeof AspectSchema>;

export const FRAME_SIZES: Record<Aspect, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

/**
 * Bounds applied when turning measured audio into scene durations, and the
 * speaking pace used to turn a target length into a word budget.
 *
 * Both are per-module and neither is guessable: see each module's `pacing.ts`
 * for the measurements behind the numbers. They are grouped in one type so the
 * shared timeline builder can take them as a parameter rather than importing a
 * constant that would be wrong for one of the two modules.
 */
export interface Pacing {
  sceneDuration: {
    minSeconds: number;
    /** Only a warning threshold - a scene is never cut short of its narration. */
    maxSeconds: number;
    /** Breathing room added after a scene's narration ends, in seconds. */
    tailPaddingSeconds: number;
  };
  /**
   * Whitespace tokens per minute, measured through the module's configured
   * voice at its configured rate, on a real script.
   *
   * A "word" is a whitespace token, which in English is a word and in
   * Vietnamese is a syllable - so the two modules' numbers are not comparable
   * with each other.
   */
  wordsPerMinute: number;
}

/**
 * Placeholder composition metadata for the Remotion registry.
 *
 * Every field is overridden by `calculateMetadata` from the timeline that is
 * actually passed in, so these values never reach a finished render. Portrait
 * because Remotion Studio opens on them and the fact module is the one anyone
 * is likely to be poking at interactively.
 */
export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  ...FRAME_SIZES.portrait,
  fps: 30,
  targetDuration: 45,
  durationMin: 30,
  durationMax: 60,
  style: 'calm',
};
