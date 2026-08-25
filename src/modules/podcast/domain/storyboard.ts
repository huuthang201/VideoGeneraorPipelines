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

/** What a storyboard may reference: the backdrops in the shared library. */
export interface AvailableAssets {
  environment: readonly string[];
}

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
  available: AvailableAssets,
  targetWords: number | null = null,
): string[] {
  const scenes = draft.scenes;

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

    if (!available.environment.includes(scene.environment)) {
      problems.push(
        `Scene "${scene.id}" uses environment "${scene.environment}", which is not one of the ` +
          `available backdrops: ${available.environment.join(', ')}.`,
      );
    }
  }

  // A ten minute video that shows two photographs is a slideshow of two
  // photographs. Only checked against what the library can actually offer, so a
  // small library is never blamed for the model's choices.
  const distinct = new Set(scenes.map((s) => s.environment)).size;
  const affordable = Math.min(available.environment.length, Math.ceil(scenes.length / 2));
  if (distinct < affordable) {
    problems.push(
      `The episode uses only ${distinct} different backdrop(s) across ${scenes.length} scenes. ` +
        `Use at least ${affordable} of the ${available.environment.length} available, so the ` +
        'picture changes as the subject does.',
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
