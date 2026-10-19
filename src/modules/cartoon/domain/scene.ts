import { z } from 'zod';
import { SceneTypeSchema, TransitionNameSchema } from '../../../domain/scene';
import { CAST } from '../../../remotion/characters/palette';
import { EXPRESSIONS, POSES } from '../../../remotion/characters/draw';
import { SCENERY_IDS } from '../../../remotion/characters/scenery';

/**
 * A scene here is one character saying one thing.
 *
 * That is a smaller unit than the other modules use, and it falls out of how
 * the timeline already works rather than being a new idea: a scene carries
 * exactly one `narration`, and its duration is derived from the measured audio
 * of that narration. A line of dialogue *is* one narration by one voice, so
 * "one scene, one line, one speaker" needs no new machinery - it just means
 * scenes are shorter and there are more of them.
 *
 * What is genuinely new is the stage. A photo backdrop needed one field; a
 * stage needs to say who is standing on it, where, in what pose, wearing what
 * expression - and which of them is talking.
 */

/**
 * Longest a single line may be.
 *
 * Shorter than the shorts module's 260, and for a different reason than
 * length: this is dialogue. A character who says a hundred and ninety
 * characters without the other one answering is not in a conversation, they
 * are lecturing, and the format collapses back into a narrator with a picture
 * of a cat. Splitting a long thought across two lines - one each - is almost
 * always the better script anyway.
 */
export const MAX_LINE_CHARS = 190;

/**
 * Where a character stands. Three slots, and no more.
 *
 * A 9:16 frame is 1080 wide, so every character added shrinks all of them. Two
 * is the comfortable number and three is the ceiling: at four, the expression -
 * which is the entire performance - stops being legible on a phone.
 *
 * The third slot is the *middle* rather than another end, because a row of
 * three has to stay centred on the frame. It also sits slightly further back,
 * which is what makes three read as a group rather than as a police line-up.
 */
export const POSITIONS = ['trai', 'giua', 'phai'] as const;
export const PositionSchema = z.enum(POSITIONS);
export type Position = (typeof POSITIONS)[number];

const CHARACTER_IDS = Object.keys(CAST) as [string, ...string[]];

/** One character, placed. */
export const StagedCharacterSchema = z.strictObject({
  character: z.enum(CHARACTER_IDS),
  position: PositionSchema,
  pose: z.enum(POSES as [string, ...string[]]),
  expression: z.enum(EXPRESSIONS as [string, ...string[]]),
});

export type StagedCharacter = z.infer<typeof StagedCharacterSchema>;

export const SceneSchema = z.strictObject({
  id: z.string().min(1),
  type: SceneTypeSchema,

  /**
   * Where the scene happens.
   *
   * Named from a fixed set of drawn backdrops rather than described in prose.
   * The model cannot ask for a place that has not been drawn, which is the same
   * discipline the expression list follows - and it means a backdrop is a
   * lookup rather than an image search that might return nothing.
   */
  background: z.enum(SCENERY_IDS as [string, ...string[]]),

  /**
   * Who is on screen. One or two.
   *
   * Note this is the *stage*, not the speaker - a character who says nothing in
   * this scene still has to be drawn, and still has an expression. Reacting
   * while the other one talks is most of what makes two characters read as a
   * conversation rather than as alternating monologues.
   */
  cast: z.array(StagedCharacterSchema).min(1).max(3),

  /** Which of `cast` is speaking. The structural check enforces membership. */
  speaker: z.enum(CHARACTER_IDS),

  /** The line. Non-empty: a scene with no speech has no duration to derive. */
  narration: z.string().min(1).max(MAX_LINE_CHARS),

  /**
   * On-screen text, and almost always empty.
   *
   * The subtitle is already carrying every word being spoken. A title on top of
   * it is a third layer of text in a vertical frame, so this is for the opening
   * card and nothing else.
   */
  title: z.string().max(40),

  /**
   * A sound effect at the top of this scene, or nothing.
   *
   * Not enumerated in the schema, deliberately, and this is the one place the
   * closed-vocabulary rule bends: which effects exist depends on which files
   * are in `assets/sfx/`, and a zod enum baked at import time cannot know that.
   * The prompt offers only what is on disk and the structural check rejects
   * anything else, so the vocabulary is still closed - it is just closed at run
   * time against the filesystem rather than at compile time against a list.
   */
  sfx: z
    .string()
    .nullable()
    .optional()
    /*
     * An empty string means "no sound", because that is what the model writes.
     *
     * It was `.min(1).nullable()`, which is correct and useless: asked for an
     * optional string the model returns `""` on the scenes that have none, and
     * a whole draft was rejected with `scenes.2.sfx: expected string to have
     * >=1 characters` - after a web search, on the first real run. Normalising
     * here costs nothing; rejecting cost a retry and a second search.
     */
    .transform((value) => (value && value.trim() ? value.trim() : null)),

  /** Claude's guess in seconds. Advisory - the real length comes from audio. */
  duration: z.number().positive().max(20),

  transition: TransitionNameSchema,
});

export type Scene = z.infer<typeof SceneSchema>;
