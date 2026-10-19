import { z } from 'zod';
import {
  AnimationNameSchema,
  ImageFitSchema,
  SceneEffectSchema,
  SceneOverlaySchema,
  SceneTypeSchema,
  TransitionNameSchema,
} from './scene';
import { ModuleIdSchema, StyleNameSchema } from './config';

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
 * A caption "page" - the subtitle line shown at once, with the words that make
 * it up. Mirrors the TikTokPage shape from @remotion/captions so the two
 * interop without a translation layer.
 *
 * Whether there is a second line under the first is the module's decision, and
 * the two answers come from the same reasoning rather than from a preference. A
 * podcast is narrated in English to a Vietnamese audience, so the pair carries
 * meaning the viewer would otherwise miss, and a 16:9 frame has room for it. A
 * fact short is already in the viewer's language, and a vertical frame has room
 * for one line of type at the size a phone needs.
 */
export const CaptionPageSchema = z.strictObject({
  text: z.string(),
  /**
   * The translated line shown under the first, or empty for a module that
   * subtitles in one language.
   *
   * Whole-phrase rather than word-timed: two languages do not put the same idea
   * in the same order, so there is no honest per-word mapping between them. It
   * appears and disappears with the page it belongs to.
   */
  translation: z.string().default(''),
  startMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  tokens: z.array(CaptionTokenSchema),
});
export type CaptionPage = z.infer<typeof CaptionPageSchema>;

/**
 * Who took the photograph, drawn in the corner of the scene.
 *
 * Carried in the timeline rather than looked up at render time because it is
 * part of the frame: the pictures are found by searching an openly-licensed
 * library, and several of those licences require the creator to be named
 * wherever the work appears. A credit that lived only in the video description
 * would satisfy nobody, and a credit resolved at render time could go missing
 * on a re-render without anything failing.
 */
export const ImageCreditSchema = z.strictObject({
  /** The short form actually drawn on screen, e.g. "Tim Gouw · CC0". */
  label: z.string().min(1),
  creator: z.string().min(1),
  /**
   * The library or the paper it came from. Optional because timelines written
   * before press photographs existed do not have it, and the description only
   * needs it for those - "Phạm Tuấn" alone does not say which paper allowed it.
   */
  provider: z.string().min(1).optional(),
  /**
   * The rest of the attribution, carried so the publishing kit can be rebuilt
   * from the timeline alone. `publish-kit` re-runs long after the search
   * results are gone, and a written credit missing its licence URL is not a
   * credit anybody could check.
   */
  license: z.string().min(1),
  licenseUrl: z.string().min(1),
  sourceUrl: z.string().min(1),
});
export type TimelineImageCredit = z.infer<typeof ImageCreditSchema>;

/**
 * The backdrop layer: one photograph filling the frame, already resolved to a
 * path inside the staged bundle.
 */
export const TimelineBackgroundSchema = z.strictObject({
  /** Path relative to the Remotion public dir, for staticFile(). */
  src: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fit: ImageFitSchema,
  /** Null only for a hand-authored timeline that names no source. */
  credit: ImageCreditSchema.nullable().default(null),
  /**
   * Show the photograph exactly as published: whole, still, unfiltered.
   *
   * Set by the timeline builder from the credit's licence rather than chosen by
   * anybody, so the renderer never has to know what a licence is. See
   * `PERMISSION_LICENCE`. Defaulted so every timeline written before this
   * existed renders the way it always did.
   */
  preserve: z.boolean().default(false),
});
export type TimelineBackground = z.infer<typeof TimelineBackgroundSchema>;

/**
 * A drawn stage, for pipelines whose scenes have no photograph.
 *
 * Deliberately not a variant of `TimelineBackground`. A photo backdrop is a
 * file with a size, a crop and a licence; a stage is a place and a cast, and
 * squeezing one into the other would give both a pile of fields that are null
 * half the time. A scene has one or the other, and the router picks the
 * component that knows how to draw it - the same shape `CaptionRenderer`
 * already uses, two components rather than one with conditionals.
 */
export const TimelineStageSchema = z.strictObject({
  /** Which drawn backdrop. Resolved in the browser, so no path travels here. */
  scenery: z.string().min(1),
  cast: z
    .array(
      z.strictObject({
        character: z.string().min(1),
        position: z.enum(['trai', 'giua', 'phai']),
        pose: z.string().min(1),
        expression: z.string().min(1),
      }),
    )
    .min(1),
  /** Who is talking, so the mouth moves on the right character. */
  speaker: z.string().min(1).nullable().default(null),
});
export type TimelineStage = z.infer<typeof TimelineStageSchema>;

export const TimelineSceneSchema = z.strictObject({
  id: z.string().min(1),
  type: SceneTypeSchema,
  /** Absolute start frame within the composition. */
  from: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  /** On-screen title for this beat. Empty is legal, and usual. */
  title: z.string(),
  /**
   * The photograph, for the pipelines that shoot against one.
   *
   * Nullable rather than absent so one timeline schema serves every pipeline;
   * exactly one of `background` and `stage` is set, and `SceneRouter` reads
   * which.
   */
  background: TimelineBackgroundSchema.nullable().default(null),
  /** The drawn stage, for the pipelines that do not. */
  stage: TimelineStageSchema.nullable().default(null),
  /**
   * A sound effect at the top of this scene, already resolved to a staged path.
   *
   * A path rather than the effect's id, for the same reason the backdrop is:
   * the composition runs in a browser, which has no `assets/sfx` and no way to
   * look one up. Everything Remotion needs has to arrive already resolved.
   */
  sfxSrc: z.string().min(1).nullable().default(null),
  /** Scene-local caption pages. Empty is legal (a scene may carry no narration). */
  captionPages: z.array(CaptionPageSchema),
  animation: AnimationNameSchema,
  transition: TransitionNameSchema,
  effect: SceneEffectSchema.default('none'),
  overlay: SceneOverlaySchema.default('none'),
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
     * Which module produced this timeline, and therefore which theme pack
     * Remotion renders it with.
     *
     * It has to travel in the file rather than be read from configuration,
     * because the composition runs in a browser: the bundle has no .env and no
     * `loadConfig`. Defaulted to `podcast` so a timeline written before the two
     * pipelines were merged still parses and still renders the way it did.
     */
    module: ModuleIdSchema.default('podcast'),
    /**
     * The single narration track. Optional only so a composition can be
     * previewed before TTS has run; the output validator makes it mandatory for
     * any job that reaches DONE.
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
