import { z } from 'zod';

/**
 * Scene vocabulary (spec §30-32).
 *
 * These lists are whitelists in the strict sense: Claude may only *pick* from
 * them, never extend them. Anything outside fails zod validation before it can
 * reach Remotion, which is what keeps the model from inventing component names
 * or animations that have no implementation behind them.
 */

/**
 * V1 ships four scene types. Spec §30 lists seven, but `price` and `comparison`
 * need payload (a price, two things to compare) that `info.json` may not carry,
 * and a scene type with no data behind it is just an invitation to hallucinate.
 * They land in V1.1 with their own payloads, gated on the data existing.
 *
 * `image` from §30 is not a separate type here - it is `product` without a
 * headline, which the component already handles.
 */
export const SCENE_TYPES = ['hook', 'product', 'feature', 'cta'] as const;
export const SceneTypeSchema = z.enum(SCENE_TYPES);
export type SceneType = z.infer<typeof SceneTypeSchema>;

/** Spec §32 animation whitelist, verbatim. */
export const ANIMATIONS = [
  'none',
  'zoom-in',
  'zoom-out',
  'pan-left',
  'pan-right',
  'pan-up',
  'pan-down',
  'fade',
  'spring',
  'slide-left',
  'slide-right',
  'slide-up',
] as const;
export const AnimationNameSchema = z.enum(ANIMATIONS);
export type AnimationName = z.infer<typeof AnimationNameSchema>;

export const TRANSITIONS = ['cut', 'fade', 'slide', 'whoosh'] as const;
export const TransitionNameSchema = z.enum(TRANSITIONS);
export type TransitionName = z.infer<typeof TransitionNameSchema>;

/**
 * How a source image is fitted into the 1080x1920 frame (spec §23).
 * Never a stretch - see `resolveFit` in remotion/components/fit.ts.
 */
export const IMAGE_FITS = ['cover', 'contain', 'blur-pad'] as const;
export const ImageFitSchema = z.enum(IMAGE_FITS);
export type ImageFit = z.infer<typeof ImageFitSchema>;

/**
 * A scene as authored by Claude.
 *
 * Note `duration`: it is a *hint*. The authoritative per-scene duration is
 * derived from measured TTS audio in the timeline builder (§2.2 of the plan).
 * Remotion never sees this field - it only ever receives a `Timeline`.
 */
export const SceneSchema = z.strictObject({
  id: z.string().min(1),
  type: SceneTypeSchema,
  /** Filename of a source image; refined against the real file list at parse time. */
  asset: z.string().min(1),
  /** On-screen text. Short by design - long headlines wrap badly at 9:16. */
  headline: z.string().max(28),
  /** The line that gets spoken. Non-empty: Vietnamese narration is mandatory (§7). */
  narration: z.string().min(1).max(140),
  /** Claude's guess in seconds. Advisory only. */
  duration: z.number().positive().max(15),
  animation: AnimationNameSchema,
  transition: TransitionNameSchema,
});

export type Scene = z.infer<typeof SceneSchema>;
