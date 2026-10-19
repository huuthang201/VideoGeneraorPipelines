import type { VideoModule } from '../contract';
import { FACTLONG_PACING } from './pacing';
import { BriefSchema, permittedArticlesOf, targetSecondsOf, type Brief } from './domain/brief';
import { StoryboardSchema, type Storyboard } from './domain/storyboard';
import type { Scene } from './domain/scene';
import { generateStoryboard } from './storyboard-provider';
import { suggestBrief } from './suggest-brief';
import { resolveBackdrops } from './backdrops';
import { buildCaptions } from '../shorts/captions';
import { ERROR_CODES, PipelineError } from '../../domain/errors';
import { isVietnameseVoice } from '../../tts/types';

/**
 * "Ủa Thật À?" long-form: fifteen to twenty minutes, 16:9, Vietnamese.
 *
 * ## Why this is a module and not a setting
 *
 * Everything else in this repository is a module because it is a *channel* -
 * its own runtime directory, its own cache, and above all its own YouTube
 * refresh token, because the token is the channel. This one is the exception
 * that proves the rule: it publishes to the same channel the `fact` shorts do,
 * and says so with `YOUTUBE_TOKEN_FROM=fact`.
 *
 * What makes it separate is the other half - the machine. A thirty-second short
 * and a seventeen-minute explainer differ in the one way `contract.ts` says a
 * module may: in *behaviour*, not in a number. One is written in a single
 * Claude call; the other cannot be, and its provider does a web research pass
 * and then a call per section. Collapsing that into a flag on the shorts module
 * would put a branch through the middle of every gate it has.
 *
 * ## What it borrows
 *
 * Almost everything else, and deliberately. The photograph search is the shared
 * one; the caption pager is the shorts' own, unchanged, because a single heavy
 * Vietnamese subtitle is right in both frames and a second copy would be a
 * second copy to fix. The pace constant is imported from the shorts rather than
 * re-measured, because it is the same voice at the same speed.
 */
export const factlongModule: VideoModule<Brief, Scene, Storyboard> = {
  id: 'factlong',
  label: 'Ủa Thật À? (dài)',
  description: 'Vietnamese long-form fact videos, 15-20 min, 16:9, funny and detailed, same channel as fact',

  pacing: FACTLONG_PACING,

  /**
   * Between the podcast's 2.4 and the shorts' 4.0, and closer to the podcast
   * because the frame is the podcast's.
   *
   * A landscape frame is the easy case: most searched photographs are landscape
   * already, and the ranking now prefers them (see `cropCost`). What this has to
   * catch is the occasional portrait result, which at a low tolerance becomes a
   * tall picture with grey either side - and over seventeen minutes that will
   * happen several times rather than once.
   */
  coverTolerance: 2.6,

  /** Forty minutes. A runaway guard, not a length preference. */
  outputDurationGuard: { minSeconds: 300, maxSeconds: 2400 },

  /**
   * Twenty-five minutes.
   *
   * One call carries the whole script, and here that is five and a half
   * thousand syllables through a local model - minutes of real work rather than
   * the seconds a short takes. The podcast's fifteen was sized for a
   * ten-minute English episode through a network service.
   */
  ttsTimeoutMs: 1_500_000,

  parseBrief: (raw) => BriefSchema.parse(raw),
  parseStoryboard: (raw) => StoryboardSchema.parse(raw),
  targetSecondsOf,

  /**
   * No ceiling.
   *
   * The shorts clamp because sixty seconds is a platform cliff. An ordinary
   * landscape video has no equivalent, and the brief's own schema already
   * bounds the request at forty minutes.
   */
  resolveTargetSeconds: (requestedSec) => requestedSec,

  /**
   * The narrator has to be Vietnamese, and only the Edge engine can get this
   * wrong: `vieneu` names its voices by preset, which carries no locale to
   * check, and every one of them is Vietnamese by construction.
   */
  assertVoiceUsable(voice, engine) {
    if (engine === 'edge' && !isVietnameseVoice(voice)) {
      throw new PipelineError(
        ERROR_CODES.TTS_GENERATION_FAILED,
        'generate-tts',
        `TTS_VOICE "${voice}" is not a Vietnamese voice. The scripts are written in Vietnamese, ` +
          'and a multilingual voice from another locale reads them as a foreigner reading ' +
          'phonetically - wrong tones, wrong everything.',
      );
    }
  },

  generateStoryboard,
  suggestBrief,

  resolveBackdrops,

  /**
   * The shorts' caption pager, unchanged.
   *
   * It pages on where the *voice* breaks rather than on a word count, which is
   * a property of Vietnamese speech and of this narrator, not of the frame. The
   * podcast's version is the one that could not be reused: it divides a
   * translation across the pages, and there is no second language here.
   */
  buildCaptions,

  /**
   * The press photographs, and nothing else.
   *
   * No image queries and no research: both live inside the storyboard - the
   * queries as `content.imageQueries`, the facts as `content.facts` - so the
   * storyboard's own hash already covers them. The permission does not: it is
   * on the brief, it changes most of the pictures in the video, and without it
   * here, ticking the box and pressing start answered "already up to date".
   *
   * Empty when nothing is permitted, so every project that never used it keeps
   * the hash it had.
   */
  hashInputs: ({ brief }): Record<string, string> => {
    const articles = permittedArticlesOf(brief);
    return articles.length > 0 ? { pressPhotos: articles.join(' ') } : {};
  },
};
