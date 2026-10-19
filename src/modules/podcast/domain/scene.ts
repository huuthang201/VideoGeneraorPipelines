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
 * Longest an image query may be.
 *
 * Short queries find photographs; long ones find nothing. A stock library is
 * indexed on what is visibly *in* a picture, so "rain on a window" returns
 * hundreds of results and "the quiet melancholy of a Hanoi afternoon" returns
 * none - and a scene with no picture is a scene that has to borrow one.
 */
export const MAX_IMAGE_QUERY_CHARS = 60;

/**
 * A podcast scene as authored by Claude.
 *
 * One backdrop, one title, one paragraph. The model's creative work is writing
 * the script and describing - in words, before it has seen anything - what that
 * part of it should be shot against.
 */
export const SceneSchema = z.strictObject({
  ...baseSceneFields({
    maxNarrationChars: MAX_NARRATION_CHARS,
    maxTitleChars: 60,
    maxDurationSec: 120,
  }),
  /**
   * Which of the storyboard's image queries this scene is shot against.
   *
   * A search phrase rather than a filename. This module used to name a file in
   * an uploaded library, which meant an episode could only be about what
   * somebody had already photographed - and meant the model had to *read* the
   * library before it could write a word. Searching inverts that: the script
   * comes first and the pictures are found for it.
   *
   * English, always. Every openly-licensed stock library is indexed in English.
   */
  imageQuery: z.string().min(1).max(MAX_IMAGE_QUERY_CHARS),
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
