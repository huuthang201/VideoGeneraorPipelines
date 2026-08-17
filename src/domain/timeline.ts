import { z } from 'zod';
import { AnimationNameSchema, ImageFitSchema, SceneTypeSchema, TransitionNameSchema } from './scene';
import { StyleNameSchema } from './config';

/**
 * The Timeline is the single source of truth for rendering, and the only thing
 * Remotion ever receives.
 *
 * Why it exists (plan §2.2): the spec has Claude assign `scene.duration`, but
 * also requires captions to track real audio and forbids the model from
 * guessing timestamps. Those cannot all hold at once. So Claude's durations
 * stay advisory in the storyboard, and this artifact - built in Node *after*
 * the voice track has been measured - carries the frame-exact truth.
 *
 * Everything here is already in integer frames. No component downstream does
 * seconds-to-frames arithmetic, which is what makes caption drift structurally
 * impossible rather than merely unlikely.
 */

/** One word-level token as produced by TTS, in scene-local milliseconds. */
export const CaptionTokenSchema = z.strictObject({
  text: z.string(),
  fromMs: z.number().nonnegative(),
  toMs: z.number().nonnegative(),
});
export type CaptionToken = z.infer<typeof CaptionTokenSchema>;

/**
 * A caption "page" - the 2-5 word chunk shown at once (spec §18).
 * Mirrors the TikTokPage shape from @remotion/captions so the two interop
 * without a translation layer.
 */
export const CaptionPageSchema = z.strictObject({
  text: z.string(),
  startMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  tokens: z.array(CaptionTokenSchema),
});
export type CaptionPage = z.infer<typeof CaptionPageSchema>;

export const TimelineSceneSchema = z.strictObject({
  id: z.string().min(1),
  type: SceneTypeSchema,
  /** Absolute start frame within the composition. */
  from: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  headline: z.string(),
  image: z.strictObject({
    /** Path relative to the Remotion public dir, for staticFile(). */
    src: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fit: ImageFitSchema,
  }),
  /** Scene-local caption pages. Empty is legal (a scene may carry no narration). */
  captionPages: z.array(CaptionPageSchema),
  animation: AnimationNameSchema,
  transition: TransitionNameSchema,
});
export type TimelineScene = z.infer<typeof TimelineSceneSchema>;

export const TimelineSchema = z
  .strictObject({
    version: z.literal('1.0'),
    projectId: z.string().min(1),
    video: z.strictObject({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fps: z.number().int().positive(),
      durationInFrames: z.number().int().positive(),
    }),
    style: StyleNameSchema,
    /**
     * The single narration track (spec §15-16). Optional only so that M1 can
     * render before TTS exists; the output validator makes it mandatory for any
     * job that reaches DONE.
     */
    voice: z
      .strictObject({
        src: z.string().min(1),
        durationInFrames: z.number().int().positive(),
      })
      .nullable()
      .default(null),
    music: z
      .strictObject({
        src: z.string().min(1),
        volume: z.number().min(0).max(1),
      })
      .nullable()
      .default(null),
    scenes: z.array(TimelineSceneSchema).min(1),
  })
  .refine(
    (t) => t.scenes.every((s, i) => (i === 0 ? s.from === 0 : s.from === sumThrough(t.scenes, i))),
    { message: 'scene.from must be the running sum of preceding durations (no gaps, no overlaps)' },
  )
  .refine(
    (t) => {
      const last = t.scenes[t.scenes.length - 1];
      if (!last) return false;
      return last.from + last.durationInFrames === t.video.durationInFrames;
    },
    { message: 'video.durationInFrames must equal the end of the last scene' },
  );

export type Timeline = z.infer<typeof TimelineSchema>;

function sumThrough(scenes: readonly { durationInFrames: number }[], index: number): number {
  let total = 0;
  for (let i = 0; i < index; i++) total += scenes[i]!.durationInFrames;
  return total;
}
