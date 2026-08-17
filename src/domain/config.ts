import { z } from 'zod';

/** Spec §33. Styles are theme objects, not duplicated component trees. */
export const STYLES = ['tiktok-fast', 'modern-tech', 'minimal'] as const;
export const StyleNameSchema = z.enum(STYLES);
export type StyleName = z.infer<typeof StyleNameSchema>;

/**
 * Output format (spec §38). Fixed by the system, never by Claude - these are
 * platform requirements, not creative choices, so letting the model emit them
 * would only add a way for a render to come out the wrong size.
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
 * Bounds applied when turning measured audio into scene durations.
 * A scene never collapses to nothing even if its narration is clipped, and
 * never lingers long enough to feel like a freeze frame.
 */
export const SCENE_DURATION_BOUNDS = {
  minSeconds: 1.5,
  maxSeconds: 9,
  /** Breathing room added after a scene's narration ends, in seconds. */
  tailPaddingSeconds: 0.25,
} as const;

export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  width: 1080,
  height: 1920,
  fps: 30,
  targetDuration: 25,
  durationMin: 15,
  durationMax: 35,
  style: 'tiktok-fast',
};
