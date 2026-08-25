import { z } from 'zod';
import { StyleNameSchema, VideoConfigSchema } from './config';

/**
 * The parts of a storyboard that are the same whatever the module.
 *
 * A storyboard is always: a project id and title, delivery settings, a voice, a
 * summary, a derived narration, optional publishing copy, and a list of scenes.
 * What differs between a ten-minute podcast and a forty-five second fact short
 * is the *bounds* on those things and the extra fields each needs - so this
 * file holds the shape and the arithmetic, and each module assembles its own
 * schema from it.
 *
 * See `src/modules/<name>/domain/storyboard.ts` for the two assemblies.
 */

/**
 * Fewest scenes any video may hold.
 *
 * Three in both modules, and for the same reason: a video still has to open and
 * close, so intro + at least one middle + outro. The *ceiling* is a format
 * decision and lives in the module.
 */
export const MIN_SCENES = 3;

/**
 * The publishing copy: what goes in the boxes on YouTube.
 *
 * Written by the same call that writes the script, because it is the same
 * judgement - a title is a promise about the content, and the model has just
 * written it. Generating it afterwards from the summary produces exactly the
 * bland "In this episode we discuss..." / "Video này nói về..." nobody clicks.
 *
 * Optional so a storyboard written before this existed still parses; the
 * pipeline falls back to the video title and summary when it is absent.
 */
export const PublishMetaSchema = z.strictObject({
  /**
   * YouTube refuses past 100 and truncates hard well before it. How much
   * earlier depends on the surface: a Short's title sits in a two-line overlay
   * over the video itself, so anything past about sixty characters is there for
   * search rather than for the viewer.
   */
  title: z.string().min(1).max(100),
  /** The first two lines are what shows above the fold; the rest can breathe. */
  description: z.string().min(1).max(4000),
  /** YouTube counts these against a 500-character total. */
  tags: z.array(z.string().min(1)).max(20).default([]),
});
export type PublishMeta = z.infer<typeof PublishMetaSchema>;

/**
 * The fields every full storyboard carries.
 *
 * `content` is deliberately left out - it is where the modules differ most (a
 * fact short names image queries, a podcast does not) - so each module spreads
 * these in and supplies its own `content` and `scenes`.
 */
export function baseStoryboardFields() {
  return {
    version: z.literal('1.0'),
    project: z.strictObject({
      id: z.string().min(1),
      /** The title, as it would appear next to the video. */
      episodeTitle: z.string().min(1),
    }),
    video: VideoConfigSchema,
    voice: z.strictObject({
      /** BCP-47 tag of the narration language, e.g. "en-US" or "vi-VN". */
      language: z.string().min(2),
      provider: z.string().min(1),
      voice: z.string().min(1),
      rate: z.string().optional(),
      pitch: z.string().optional(),
    }),
    publish: PublishMetaSchema.optional(),
  };
}

/**
 * The fields of the subset Claude is actually asked to produce.
 *
 * `video.{width,height,fps}` and `voice.{language,provider}` are deliberately
 * absent: they are delivery constants, not content decisions, and every field
 * in the schema is one more thing the model can get wrong. Node fills them from
 * config afterwards. The model still chooses `style` and the voice, which are
 * the two that genuinely follow from the writing.
 */
export function baseDraftFields() {
  return {
    version: z.literal('1.0'),
    project: z.strictObject({
      id: z.string().min(1),
      episodeTitle: z.string().min(1),
    }),
    video: z.strictObject({
      style: StyleNameSchema,
    }),
    voice: z.strictObject({
      voice: z.string().min(1),
      rate: z.string().optional(),
      pitch: z.string().optional(),
    }),
    publish: PublishMetaSchema.optional(),
  };
}

/**
 * The narration actually spoken is always the concatenation of the scene text,
 * because that is what the alignment step splits back apart. If the model's
 * `content.narration` disagrees, the scenes win - they are the finer-grained
 * and more load-bearing of the two.
 */
export function narrationFromScenes(draft: {
  scenes: readonly { narration: string }[];
}): string {
  return draft.scenes.map((s) => s.narration.trim()).join(' ');
}

/**
 * Whitespace tokens.
 *
 * In English that is words; in Vietnamese it is syllables, which is why the two
 * modules' `WORDS_PER_MINUTE` constants are wildly different numbers and are
 * not comparable with each other. Each is measured in the unit this function
 * counts, so each can be divided by it.
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Fills in the derived narration so the saved file and the audio agree. */
export function withDerivedNarration<
  T extends { content: { narration: string }; scenes: readonly { narration: string }[] },
>(storyboard: T): T {
  return {
    ...storyboard,
    content: { ...storyboard.content, narration: narrationFromScenes(storyboard) },
  };
}

/**
 * Whether a draft's script is close enough to the requested length.
 *
 * The *tolerances* are a module decision and differ sharply - overrunning a
 * podcast means a longer episode than asked for, which is a preference;
 * overrunning a Short past sixty seconds means YouTube stops serving it in the
 * Shorts feed, which is the format failing. So the arithmetic is shared and the
 * numbers are not.
 */
export function lengthVerdict(
  words: number,
  targetWords: number,
  tolerance: { shortfall: number; overrun: number },
): 'short' | 'long' | 'ok' {
  if (words < targetWords * tolerance.shortfall) return 'short';
  if (words > targetWords * tolerance.overrun) return 'long';
  return 'ok';
}

/**
 * The checks that are word-for-word the same in both modules: a video opens
 * with an intro, closes with an outro, and never repeats a scene id.
 *
 * The *messages* are supplied by the caller rather than written here, and that
 * is not ceremony. They are echoed back to the model verbatim on a retry, and
 * they have to be in the language the rest of that conversation is in - mixing
 * the two is how a model starts answering in the wrong one.
 */
export function checkSceneOrder(
  scenes: readonly { id: string; type: string }[],
  messages: {
    firstNotIntro: (got: string) => string;
    lastNotOutro: (got: string) => string;
    duplicateId: (id: string) => string;
  },
): string[] {
  const problems: string[] = [];

  const first = scenes[0];
  if (first && first.type !== 'intro') problems.push(messages.firstNotIntro(first.type));

  const last = scenes[scenes.length - 1];
  if (last && last.type !== 'outro') problems.push(messages.lastNotOutro(last.type));

  const seen = new Set<string>();
  for (const scene of scenes) {
    if (seen.has(scene.id)) problems.push(messages.duplicateId(scene.id));
    seen.add(scene.id);
  }

  return problems;
}
