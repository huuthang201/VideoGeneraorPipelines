import { z } from 'zod';
import { baseSceneFields } from '../../../domain/scene';

/**
 * Longest line a scene may hold, in characters.
 *
 * Roughly twenty-five seconds of Vietnamese speech. Much larger than the
 * shorts' 260 because a scene here is a paragraph rather than a sentence: at
 * eleven seconds a scene it carries about sixty syllables, and the ceiling has
 * to leave room for the occasional long one without letting a whole section
 * arrive as a single scene.
 */
export const MAX_NARRATION_CHARS = 520;

/** Same rule as everywhere: short queries find photographs, long ones find none. */
export const MAX_IMAGE_QUERY_CHARS = 60;

/**
 * A scene of a long fact video.
 *
 * Identical in shape to a short's - one backdrop, one optional title, some
 * narration, one image query - and that is the point. The difference between
 * the two formats is scale and register, not structure, so the renderer, the
 * timeline builder and the caption pager all treat them the same.
 */
export const SceneSchema = z.strictObject({
  ...baseSceneFields({
    maxNarrationChars: MAX_NARRATION_CHARS,
    /**
     * Longer than a short's forty. A landscape frame has room for a real
     * section heading, and this format uses one: a title at the top of each
     * section is how a viewer fourteen minutes in knows where they are.
     */
    maxTitleChars: 70,
    maxDurationSec: 40,
  }),
  /**
   * Which of the video's image queries this scene is shot against.
   *
   * Must be one of `content.imageQueries` - the structural check enforces it -
   * so ninety scenes cost a dozen searches rather than ninety.
   */
  imageQuery: z.string().min(1).max(MAX_IMAGE_QUERY_CHARS),
});

export type Scene = z.infer<typeof SceneSchema>;
