import { z } from 'zod';
import { baseSceneFields } from '../../../domain/scene';

/**
 * Longest paragraph a scene may hold, in characters.
 *
 * Roughly forty-five seconds of speech. Past that the same still photograph has
 * been on screen long enough to feel like the video has frozen, and the fix is
 * to split the thought into two scenes rather than to hold the picture longer.
 */
export const MAX_NARRATION_CHARS = 700;

/**
 * A podcast scene as authored by Claude.
 *
 * One backdrop, one title, one paragraph. The model's creative work is writing
 * the script and choosing which photograph belongs under which part of it.
 */
export const SceneSchema = z.strictObject({
  ...baseSceneFields({
    maxNarrationChars: MAX_NARRATION_CHARS,
    maxTitleChars: 60,
    maxDurationSec: 120,
  }),
  /** Filename from the environment library. Every scene has a backdrop. */
  environment: z.string().min(1),
  /**
   * The same paragraph in Vietnamese, for the second subtitle line.
   *
   * A translation for reading, not a gloss: it carries the meaning of the
   * English rather than its word order, because it is read at speed under a
   * voice that is already talking. Defaulted so a storyboard written before
   * bilingual subtitles existed still parses - it simply renders one line.
   */
  narrationVi: z.string().max(MAX_NARRATION_CHARS * 1.5).default(''),
});

export type Scene = z.infer<typeof SceneSchema>;
