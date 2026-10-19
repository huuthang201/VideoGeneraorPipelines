import { z } from 'zod';
import {
  MIN_SCENES,
  PublishMetaSchema,
  baseDraftFields,
  baseStoryboardFields,
  checkSceneOrder,
  countWords,
  lengthVerdict,
  narrationFromScenes,
} from '../../../domain/storyboard';
import { SceneSchema } from './scene';

/**
 * How many scenes an episode may hold.
 *
 * The ceiling is what a ten minute episode needs at roughly thirty seconds a
 * scene, plus room for a faster-cut one. The floor is three because an episode
 * still has to open and close: intro, at least one segment, outro.
 */
export const MAX_SCENES = 40;

/**
 * How many visual themes an episode declares.
 *
 * More than a short's two-to-four, because an episode is four to ten times
 * longer and a picture that returns for the ninth time stops being a backdrop
 * and starts being wallpaper. Bounded at ten because every query costs a search
 * against a daily allowance, and because past that the model starts inventing
 * themes rather than finding them in its own script.
 */
export const MIN_IMAGE_QUERIES = 4;
export const MAX_IMAGE_QUERIES = 10;

const ContentSchema = z.strictObject({
  /** One or two sentences describing the episode - the show-notes blurb. */
  summary: z.string().min(1),
  /**
   * The full spoken script. Derived, not authored: it is always the scene
   * paragraphs joined, because that is what actually gets synthesised and split
   * back apart. Kept in the file for script.txt, but defaulted so a
   * hand-written storyboard need not repeat itself - and so a copy that
   * disagrees with the scenes cannot fail an otherwise valid file.
   */
  narration: z.string().default(''),
  /** The episode's visual themes, searched for once and shared across scenes. */
  imageQueries: z.array(z.string().min(1)).min(MIN_IMAGE_QUERIES).max(MAX_IMAGE_QUERIES),
});

export const StoryboardSchema = z.strictObject({
  ...baseStoryboardFields(),
  content: ContentSchema,
  scenes: z.array(SceneSchema).min(MIN_SCENES).max(MAX_SCENES),
});

export type Storyboard = z.infer<typeof StoryboardSchema>;

export const StoryboardDraftSchema = z.strictObject({
  ...baseDraftFields(),
  content: ContentSchema,
  scenes: z.array(SceneSchema).min(MIN_SCENES).max(MAX_SCENES),
});

export type StoryboardDraft = z.infer<typeof StoryboardDraftSchema>;

export { PublishMetaSchema };

/**
 * How far the spoken script may fall short of the requested length before the
 * draft is sent back.
 *
 * Asymmetric on purpose, and that asymmetry is the difference from the fact
 * module. A script that overruns the target is a longer episode than asked for,
 * which is a preference; a script that comes in at half the length is the
 * failure mode this whole prompt has to fight - a model asked for ten minutes
 * will happily return two and call it done. Rejecting it with the measured
 * shortfall is far more effective than asking for "a long one".
 */
const SHORTFALL_TOLERANCE = 0.75;
export const OVERRUN_TOLERANCE = 1.6;

/**
 * Structural rules that a plain schema cannot express, applied to a draft that
 * has already parsed. Returns human-readable violations - they get echoed back
 * to the model verbatim on retry, which is far more effective than asking it to
 * "try again".
 *
 * Written in English, like the prompt they are appended to and like the episode
 * they are about.
 *
 * @param targetWords the word budget the prompt asked for, or null to skip the
 *                    length check (a hand-written storyboard has no budget)
 */
export function checkStoryboardStructure(
  draft: StoryboardDraft,

  targetWords: number | null = null,
): string[] {
  const scenes = draft.scenes;
  const queries = draft.content.imageQueries;

  const problems = checkSceneOrder(scenes, {
    firstNotIntro: (got) => `First scene must have type "intro", got "${got}".`,
    lastNotOutro: (got) => `Last scene must have type "outro", got "${got}".`,
    duplicateId: (id) => `Duplicate scene id "${id}".`,
  });

  for (const scene of scenes) {
    if (!scene.narrationVi.trim()) {
      problems.push(
        `Scene "${scene.id}" has no "narrationVi". The subtitles are bilingual, so every ` +
          'scene needs its Vietnamese line as well as its English one.',
      );
    }

    if (!queries.includes(scene.imageQuery)) {
      problems.push(
        `Scene "${scene.id}" uses imageQuery "${scene.imageQuery}", which is not one of the ` +
          `queries declared in content.imageQueries: ${queries.join(' | ')}. Every scene must ` +
          'pick one of the declared themes.',
      );
    }

    if (/[^\u0000-\u007f]/u.test(scene.imageQuery)) {
      problems.push(
        `imageQuery for scene "${scene.id}" ("${scene.imageQuery}") is not plain English. Stock ` +
          'libraries are indexed in English only.',
      );
    }
  }

  /*
   * A ten minute episode that shows two photographs is a slideshow of two
   * photographs.
   *
   * Checked against the *themes* rather than the pictures, because two scenes
   * on one query still get different photographs - the resolver hands each
   * scene its own candidate from the pool. What it cannot fix is a script that
   * declared eight themes and then used one of them for everything.
   */
  const usedQueries = new Set(scenes.map((s) => s.imageQuery)).size;
  const expected = Math.min(queries.length, Math.ceil(scenes.length / 6));
  if (usedQueries < expected) {
    problems.push(
      `The episode uses only ${usedQueries} of its ${queries.length} declared image themes ` +
        `across ${scenes.length} scenes. Spread the scenes across at least ${expected} of them, ` +
        'so the picture changes as the subject does.',
    );
  }

  if (targetWords !== null && targetWords > 0) {
    const words = countWords(narrationFromScenes(draft));
    const verdict = lengthVerdict(words, targetWords, {
      shortfall: SHORTFALL_TOLERANCE,
      overrun: OVERRUN_TOLERANCE,
    });
    if (verdict === 'short') {
      problems.push(
        `The script is ${words} words, which is far short of the ${targetWords} words this ` +
          `episode needs to run its intended length. Write more in each scene, and add scenes ` +
          '- do not pad by repeating what has already been said.',
      );
    } else if (verdict === 'long') {
      problems.push(
        `The script is ${words} words against a target of ${targetWords}, which would run far ` +
          'longer than intended. Tighten it.',
      );
    }
  }

  return problems;
}
