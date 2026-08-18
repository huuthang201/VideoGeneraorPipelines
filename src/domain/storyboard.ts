import { z } from 'zod';
import { SceneSchema } from './scene';
import { StyleNameSchema, VideoConfigSchema } from './config';

/**
 * storyboard.json (spec §9) - the boundary between AI and everything else.
 * Once this file exists and validates, the rest of the pipeline runs without
 * Claude (spec §8).
 */
export const StoryboardSchema = z.strictObject({
  version: z.literal('1.0'),
  project: z.strictObject({
    id: z.string().min(1),
    productName: z.string().min(1),
  }),
  video: VideoConfigSchema,
  voice: z.strictObject({
    language: z.literal('vi-VN'),
    provider: z.string().min(1),
    voice: z.string().min(1),
    rate: z.string().optional(),
    pitch: z.string().optional(),
  }),
  content: z.strictObject({
    hook: z.string().min(1),
    /**
     * The full spoken script. Derived, not authored: it is always the scene
     * lines joined, because that is what actually gets synthesised and split
     * back apart. Kept in the file for spec §9's shape and for script.txt, but
     * defaulted so a hand-written storyboard need not repeat itself - and so a
     * copy that disagrees with the scenes cannot fail an otherwise valid file.
     */
    narration: z.string().default(''),
    cta: z.string().min(1),
  }),
  scenes: z.array(SceneSchema).min(3).max(7),
});

export type Storyboard = z.infer<typeof StoryboardSchema>;

/** Fills in the derived narration so the saved file and the audio agree. */
export function withDerivedNarration(storyboard: Storyboard): Storyboard {
  return {
    ...storyboard,
    content: { ...storyboard.content, narration: narrationFromScenes(storyboard) },
  };
}

/**
 * The subset Claude is actually asked to produce.
 *
 * `video.{width,height,fps}` and `voice.{language,provider}` are deliberately
 * absent (plan §2.4): they are platform constants, not content decisions, and
 * every field in the schema is one more thing the model can get wrong. Node
 * fills them from config afterwards. The model still chooses `style` and which
 * voice to speak in, which is what spec §60 needs.
 */
export const StoryboardDraftSchema = z.strictObject({
  version: z.literal('1.0'),
  project: z.strictObject({
    id: z.string().min(1),
    productName: z.string().min(1),
  }),
  video: z.strictObject({
    style: StyleNameSchema,
  }),
  voice: z.strictObject({
    voice: z.string().min(1),
    rate: z.string().optional(),
    pitch: z.string().optional(),
  }),
  content: z.strictObject({
    hook: z.string().min(1),
    /**
     * Derived from the scene lines, exactly as in StoryboardSchema. The prompt
     * tells the model to leave this empty, so requiring content here would
     * reject a correct reply for following its instructions - which is what it
     * did on the first real AI run, costing a retry to no purpose.
     */
    narration: z.string().default(''),
    cta: z.string().min(1),
  }),
  scenes: z.array(SceneSchema).min(3).max(7),
});

export type StoryboardDraft = z.infer<typeof StoryboardDraftSchema>;

/**
 * Structural rules that a plain schema cannot express, applied to a draft that
 * has already parsed. Returns human-readable violations - they get echoed back
 * to the model verbatim on retry, which is far more effective than asking it to
 * "try again".
 */
export function checkStoryboardStructure(
  draft: StoryboardDraft,
  availableAssets: readonly string[],
): string[] {
  const problems: string[] = [];
  const scenes = draft.scenes;

  const first = scenes[0];
  if (first && first.type !== 'hook') {
    problems.push(`First scene must have type "hook", got "${first.type}".`);
  }

  const last = scenes[scenes.length - 1];
  if (last && last.type !== 'cta') {
    problems.push(`Last scene must have type "cta", got "${last.type}".`);
  }

  const seenIds = new Set<string>();
  for (const scene of scenes) {
    if (seenIds.has(scene.id)) problems.push(`Duplicate scene id "${scene.id}".`);
    seenIds.add(scene.id);

    if (!availableAssets.includes(scene.asset)) {
      problems.push(
        `Scene "${scene.id}" references asset "${scene.asset}", which is not one of the ` +
          `available images: ${availableAssets.join(', ')}.`,
      );
    }
  }

  return problems;
}

/**
 * The narration actually spoken is always the concatenation of the scene lines,
 * because that is what the alignment step splits back apart. If the model's
 * `content.narration` disagrees, the scenes win - they are the finer-grained
 * and more load-bearing of the two.
 */
export function narrationFromScenes(draft: Pick<StoryboardDraft, 'scenes'>): string {
  return draft.scenes.map((s) => s.narration.trim()).join(' ');
}
