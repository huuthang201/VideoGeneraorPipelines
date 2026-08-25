import { z } from 'zod';
import { baseSceneFields } from '../../../domain/scene';

/**
 * Longest line a scene may hold, in characters.
 *
 * Roughly twelve seconds of Vietnamese speech, which is already a long time to
 * hold one photograph inside a forty-five second video. Past that the fix is to
 * split the thought into two scenes rather than to hold the picture longer -
 * and a scene running a quarter of the whole video is usually a sign the script
 * has drifted into an explanation rather than a fact.
 */
export const MAX_NARRATION_CHARS = 260;

/**
 * Longest an image query may be.
 *
 * Short queries find photographs; long ones find nothing. A stock library is
 * indexed on what is visibly *in* a picture, so "deep sea jellyfish" returns
 * hundreds of results and "a Turritopsis dohrnii reverting to its polyp stage"
 * returns none - and a scene with no picture is a scene that has to borrow one.
 */
export const MAX_IMAGE_QUERY_CHARS = 60;

/**
 * A fact-short scene as authored by Claude.
 *
 * One backdrop, one optional title, one or two spoken sentences. The model's
 * creative work is writing the script and describing - in words, before it has
 * seen anything - what that part of it should be shot against.
 */
export const SceneSchema = z.strictObject({
  ...baseSceneFields({
    maxNarrationChars: MAX_NARRATION_CHARS,
    /**
     * Shorter here than anywhere else: the title shares a vertical frame with a
     * subtitle that is doing the actual work. Empty is normal - most scenes
     * should carry no title at all.
     */
    maxTitleChars: 40,
    maxDurationSec: 30,
  }),
  /**
   * Which of the storyboard's image queries this scene is shot against.
   *
   * A search phrase rather than a filename, because there is no library to name
   * a file in: the engine searches for it and downloads what comes back. It has
   * to be one of `content.imageQueries` - the structural check enforces that -
   * so a whole video costs two to four searches rather than one per scene.
   *
   * English, always. Every openly-licensed stock library is indexed in English,
   * and a Vietnamese query returns almost nothing.
   */
  imageQuery: z.string().min(1).max(MAX_IMAGE_QUERY_CHARS),
});

export type Scene = z.infer<typeof SceneSchema>;
