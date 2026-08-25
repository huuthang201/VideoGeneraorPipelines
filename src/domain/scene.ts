import { z } from 'zod';

/**
 * Scene vocabulary, shared by every module.
 *
 * These lists are whitelists in the strict sense: Claude may only *pick* from
 * them, never extend them. Anything outside fails zod validation before it can
 * reach Remotion, which is what keeps the model from inventing component names
 * or animations that have no implementation behind them.
 *
 * The vocabulary is short on purpose, and - this is the part worth knowing -
 * it is short for a *different reason* in each module, which is why the lists
 * themselves are shared and the theme values that drive them are not. In the
 * podcast a jolt would wake someone who was falling asleep. In a fact short
 * every scene is already a cut every few seconds, and adding shake, flash and
 * punch on top of that pace produces a video nobody can read the subtitles of.
 * Two different arguments, the same conclusion: no impacts.
 *
 * A value in the whitelist is a value the model will eventually reach for, so
 * anything not wanted is absent rather than merely unused.
 */

/**
 * What a scene is *for* in the running order, not what it looks like: every
 * scene is the same construction - one backdrop, a short on-screen title, and
 * text that gets read aloud.
 *
 * `intro` opens and `outro` closes, which the structural check enforces.
 * `segment` is everything in between and is by far the most common.
 *
 * What those three mean differs by module and lives in the prompts. For a
 * podcast the intro is a way in and the outro a way out; for a short the intro
 * is the hook - the two seconds that decide whether the video is watched at
 * all - and the outro is the payoff plus whatever the channel asks for.
 */
export const SCENE_TYPES = ['intro', 'segment', 'outro'] as const;
export const SceneTypeSchema = z.enum(SCENE_TYPES);
export type SceneType = z.infer<typeof SceneTypeSchema>;

/**
 * Camera moves on the backdrop - Ken Burns, and nothing else.
 *
 * The list is fixed; the *amplitude* is not, and it is the amplitude that has
 * to track the format. A podcast scene runs twenty to forty seconds, so the
 * move has to be slow enough to be felt rather than watched. A short's scene
 * runs four to eight, so the move has to cover its distance in that time -
 * the fact module's theme amplitudes are several times the podcast's, because
 * a move too small to notice inside eight seconds reads as a still photograph,
 * and a still photograph in a vertical feed reads as a video that has frozen.
 *
 * See `amplitude` in each module's theme pack.
 *
 * `drift` is the nothing-in-particular option: a gentle push in, for a scene
 * whose narration should carry it.
 */
export const ANIMATIONS = [
  'none',
  'drift',
  'zoom-in',
  'zoom-out',
  'pan-left',
  'pan-right',
  'pan-up',
  'pan-down',
] as const;
export const AnimationNameSchema = z.enum(ANIMATIONS);
export type AnimationName = z.infer<typeof AnimationNameSchema>;

/**
 * How a scene arrives.
 *
 * Only two, and which of them is the workhorse flips between the modules. In a
 * podcast `fade` is almost always right and a hard `cut` is for the deliberate
 * change of subject. In a short it is the other way round: at four seconds a
 * scene a fade spends a noticeable fraction of every beat dissolving, and a run
 * of them makes the whole video feel soft, so `fade` is reserved for the beats
 * that genuinely settle. The sliding and whooshing entries a short-form video
 * wants were left out of both for the reason given above.
 */
export const TRANSITIONS = ['fade', 'cut'] as const;
export const TransitionNameSchema = z.enum(TRANSITIONS);
export type TransitionName = z.infer<typeof TransitionNameSchema>;

/**
 * A layer of moving elements drawn over the photograph.
 *
 * The backdrop is a still, and a still is obvious - after a few minutes in a
 * podcast, immediately on a phone held close. These give the frame something
 * that is actually *alive* - specks drifting, light moving - without adding
 * anything the viewer has to look at instead of the words.
 *
 * Every one is deterministic: positions come from a seeded generator, never
 * from Math.random(), so the same storyboard renders the same video. They are
 * also all slow and low-contrast, for the same reason the transitions are.
 */
export const SCENE_OVERLAYS = ['none', 'dust', 'bokeh', 'rain', 'light-sweep'] as const;
export const SceneOverlaySchema = z.enum(SCENE_OVERLAYS);
export type SceneOverlay = z.infer<typeof SceneOverlaySchema>;

/**
 * A whole-frame treatment laid over the scene.
 *
 * `vignette` darkens the corners, which earns its place twice over: it settles
 * a busy photograph without the viewer noticing it happened, and it pushes the
 * eye towards the part of the frame where the type lives.
 */
export const SCENE_EFFECTS = ['none', 'vignette'] as const;
export const SceneEffectSchema = z.enum(SCENE_EFFECTS);
export type SceneEffect = z.infer<typeof SceneEffectSchema>;

/**
 * How a source image is fitted into the frame.
 * Never a stretch - see `computeFit` in remotion/layout/fit.ts.
 */
export const IMAGE_FITS = ['cover', 'contain', 'blur-pad'] as const;
export const ImageFitSchema = z.enum(IMAGE_FITS);
export type ImageFit = z.infer<typeof ImageFitSchema>;

/**
 * The fields every scene has, whatever the module.
 *
 * Spread into each module's own `z.strictObject` rather than extended from a
 * shared schema, because the two differ in the *bounds* on these fields as well
 * as in the fields around them: a podcast paragraph and a short's single line
 * are both `narration`, and capping them the same would be wrong in one
 * direction or the other. Each module passes its own limits in.
 *
 * `strictObject` in both, so an unrecognised key is an error rather than a
 * silently ignored one - which is what makes a storyboard from the wrong module
 * fail loudly instead of rendering something odd.
 */
export function baseSceneFields(limits: {
  /** Longest text a scene may hold, in characters. */
  maxNarrationChars: number;
  /** Longest on-screen title, in characters. */
  maxTitleChars: number;
  /** Ceiling on the model's own duration guess, in seconds. */
  maxDurationSec: number;
}) {
  return {
    id: z.string().min(1),
    type: SceneTypeSchema,
    /**
     * On-screen text: the name of this part, not a summary of it.
     * Short by design - a title that wraps to three lines stops being a title.
     */
    title: z.string().max(limits.maxTitleChars),
    /** The text that gets spoken. Non-empty: narration is mandatory. */
    narration: z.string().min(1).max(limits.maxNarrationChars),
    /**
     * Claude's guess in seconds. Advisory only.
     *
     * The authoritative per-scene duration is derived from measured TTS audio
     * in the timeline builder. Remotion never sees this field - it only ever
     * receives a `Timeline`.
     */
    duration: z.number().positive().max(limits.maxDurationSec),
    /** Camera move on the backdrop. */
    animation: AnimationNameSchema,
    transition: TransitionNameSchema,
    effect: SceneEffectSchema.default('none'),
    overlay: SceneOverlaySchema.default('none'),
  };
}
