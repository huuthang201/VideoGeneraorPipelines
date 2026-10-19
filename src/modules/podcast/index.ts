import { suggestBrief } from './suggest-brief';
import { registerPodcastCommands } from './cli';
import type { VideoModule } from '../contract';
import { PODCAST_PACING } from './pacing';
import { BriefSchema, targetSecondsOf, type Brief } from './domain/brief';
import { StoryboardSchema, type Storyboard } from './domain/storyboard';
import type { Scene } from './domain/scene';
import { generateStoryboard } from './storyboard-provider';
import { resolveBackdrops } from './backdrops';
import { buildCaptions } from './captions';
import { ERROR_CODES, PipelineError } from '../../domain/errors';
import { isEnglishVoice } from '../../tts/types';

/**
 * The podcast pipeline: a shared library of uploaded photographs becomes a
 * five-to-ten minute 16:9 video with gentle English narration and bilingual
 * subtitles.
 */
export const podcastModule: VideoModule<Brief, Scene, Storyboard> = {
  id: 'podcast',
  label: 'Podcast',
  description: 'English podcast episodes, 5-10 min, 16:9, backdrops from the shared library',

  pacing: PODCAST_PACING,

  /**
   * Raised from 1.35 when this module started searching for its backdrops.
   *
   * 1.35 was right for a hand-uploaded library of landscape photographs, where
   * an off-ratio picture was rare and the interface had promised to letterbox
   * it rather than crop into it. There is no interface promising that any more,
   * and searched results are off-ratio constantly - the first episode rendered
   * this way had two scenes showing a portrait photograph shrunk into the middle
   * of the frame with grey either side, which reads as a broken video.
   *
   * Lower than the shorts modules' 4.0, because the ranking now prefers
   * landscape photographs for a landscape frame (see `cropCost`), so this only
   * has to catch what is left rather than carry the whole problem.
   */
  coverTolerance: 2.4,

  /** An hour. Purely a runaway guard - a ten minute episode is the point here. */
  outputDurationGuard: { minSeconds: 30, maxSeconds: 3600 },

  /** Fifteen minutes: one call carries a whole ten-minute episode. */
  ttsTimeoutMs: 900_000,

  parseBrief: (raw) => BriefSchema.parse(raw),
  parseStoryboard: (raw) => StoryboardSchema.parse(raw),
  targetSecondsOf,

  /**
   * No ceiling.
   *
   * Length here is purely an editorial decision - "a five minute one about
   * rain" - and the brief's own schema already bounds it at twenty minutes. The
   * fact module clamps because sixty seconds is a platform cliff; there is no
   * equivalent for an ordinary video.
   */
  resolveTargetSeconds: (requestedSec) => requestedSec,

  /**
   * The narrator is always an English voice.
   *
   * The service's multilingual voices from other locales read English perfectly
   * well, with their own colour; they were auditioned and ruled out. Refused
   * before TTS runs rather than after a whole ten-minute episode has been
   * spoken in one.
   */
  assertVoiceUsable(voice) {
    if (!isEnglishVoice(voice)) {
      throw new PipelineError(
        ERROR_CODES.TTS_GENERATION_FAILED,
        'generate-tts',
        `TTS_VOICE "${voice}" is not an English voice. The episodes are narrated in English; ` +
          'voices from other locales were auditioned and ruled out.',
      );
    }
  },

  /**
   * Reads the library before calling Claude, because the model has to be told
   * which photographs it may choose from - and shown them.
   *
   * This is the ordering that most distinguishes the two modules. Here the
   * pictures exist first and the script is written to them; in the fact module
   * the script is written first and the pictures are found to match.
   */
  generateStoryboard,

  /**
   * Proposes a subject from the project's name, not from a shelf of pictures.
   *
   * This is the change that most distinguishes the module from what it was.
   * The library used to be read *before* anything was written, because the
   * photographs were what an episode could be about; every other module writes
   * first and finds pictures afterwards, and now this one does too.
   */
  suggestBrief,

  registerCommands: registerPodcastCommands,

  resolveBackdrops,
  buildCaptions,

  /**
   * Nothing extra.
   *
   * The backdrop selection used to live here: narrowing a project's shortlist
   * changed which photographs the next script could use without changing the
   * storyboard, so the hash had to carry it or a re-run would report "already
   * up to date". There is no shortlist any more - the queries live inside the
   * storyboard, so the storyboard's own hash covers them.
   */
  hashInputs: () => ({}),
};
