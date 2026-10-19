import type { VideoModule } from '../contract';
import { SCENE_DURATION_BOUNDS } from '../shorts/pacing';
import { CARTOON_WORDS_PER_MINUTE, CHARACTER_VOICES } from './voices';
import { BriefSchema, targetSecondsOf, type Brief } from './domain/brief';
import { OVERRUN_TOLERANCE, StoryboardSchema, type Storyboard } from './domain/storyboard';
import type { Scene } from './domain/scene';
import { generateStoryboard } from './storyboard-provider';
import { suggestBrief } from './suggest-brief';
import { resolveBackdrops } from './backdrops';
import { buildCaptions } from '../shorts/captions';
import { SHORTS_MAX_SECONDS } from '../../domain/config';
import type { CharacterId } from '../../remotion/characters/palette';

/**
 * The cartoon pipeline: four drawn animals reacting to something absurd.
 *
 * A third pipeline rather than a fourth channel, and the distinction is the one
 * `CLAUDE.md` already draws. `fact` and `psych` differ only in prose, so they
 * share `modules/shorts` entirely. This one differs in *behaviour*: it draws
 * its backdrops instead of searching for them, it synthesises four voices
 * instead of one, and its scenes carry a cast instead of an image query. By the
 * repository's own rule those are things a module owns.
 *
 * What it does reuse is everything that is genuinely the same: the Vietnamese
 * scene-duration bounds, the single-line caption layout, the timeline builder,
 * the renderer, the validator, the upload queue and the schedule.
 */
export const cartoonModule: VideoModule<Brief, Scene, Storyboard> = {
  id: 'cartoon',
  label: 'Hoạt hình vô tri',
  description: 'Hoạt hình hài tiếng Việt, 20-60s, 9:16, nhân vật và bối cảnh vẽ sẵn',

  pacing: {
    sceneDuration: SCENE_DURATION_BOUNDS,
    /**
     * Four voices, one number.
     *
     * The engine's own notes are emphatic that the voice is the largest factor
     * in pace, and this channel has four of them. A script cannot be budgeted
     * per voice because who says which line is not known until the script
     * exists, so this is a blend and the +-15% tolerance absorbs the rest.
     */
    wordsPerMinute: CARTOON_WORDS_PER_MINUTE,
  },

  /** Nothing is cropped: every frame is drawn to the frame. */
  coverTolerance: 1,

  /** A runaway guard, not a preference. Five minutes for a forty-second video. */
  outputDurationGuard: { minSeconds: 5, maxSeconds: 300 },

  /**
   * Per *line*, not per script.
   *
   * Every other module sends the whole narration in one call, so its timeout
   * has to cover the whole video. Here a call carries one line of dialogue -
   * a few seconds of speech - and the whole script is many such calls. Forty
   * seconds is generous for one line and keeps a hung call from parking a queue
   * that now has a dozen calls to make.
   */
  ttsTimeoutMs: 40_000,

  parseBrief: (raw) => BriefSchema.parse(raw),
  parseStoryboard: (raw) => StoryboardSchema.parse(raw),
  targetSecondsOf,

  /** The same sixty-second cliff, and the same reason for clamping under it. */
  resolveTargetSeconds(requestedSec, config, logger) {
    if (config.video.height <= config.video.width) return requestedSec;

    const ceiling = Math.floor(SHORTS_MAX_SECONDS / OVERRUN_TOLERANCE);
    if (requestedSec <= ceiling) return requestedSec;

    logger.warn(
      `Asked for ${requestedSec}s, writing to ${ceiling}s instead: a script is accepted up to ` +
        `${Math.round((OVERRUN_TOLERANCE - 1) * 100)}% over its budget, and ${requestedSec}s plus ` +
        `that allowance would pass the ${SHORTS_MAX_SECONDS}s Shorts ceiling.`,
    );
    return ceiling;
  },

  /**
   * Nothing to check.
   *
   * The other modules guard against a narrator from the wrong locale, because
   * their voice is configuration and configuration can be mistyped. Here the
   * voice is not configurable at all - it comes from `CHARACTER_VOICES`, keyed
   * by a character the schema already validated - so there is no wrong value
   * for this to catch.
   */
  assertVoiceUsable() {},

  generateStoryboard,
  suggestBrief,
  resolveBackdrops,
  buildCaptions,

  stageFor: (scene) => ({
    scenery: scene.background,
    cast: scene.cast,
    speaker: scene.speaker,
  }),

  voiceForScene: (scene) => CHARACTER_VOICES[scene.speaker as CharacterId],

  sfxForScene: (scene) => scene.sfx,

  /**
   * Nothing extra.
   *
   * The stage is inside the storyboard, so a change to who is on screen already
   * changes the storyboard hash. There is no library selection and no image
   * search to account for.
   */
  hashInputs: () => ({}),
};
