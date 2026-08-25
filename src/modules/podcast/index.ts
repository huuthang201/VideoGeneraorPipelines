import type { VideoModule } from '../contract';
import { PODCAST_PACING } from './pacing';
import { BriefSchema, targetSecondsOf, type Brief } from './domain/brief';
import { StoryboardSchema, type Storyboard } from './domain/storyboard';
import type { Scene } from './domain/scene';
import { generateStoryboard as generate } from './storyboard-provider';
import { resolveBackdrops, resolveEnvironments } from './backdrops';
import { buildCaptions } from './captions';
import { readLibrary, assertLibraryReady } from './image/library';
import { COMFORTABLE_ENVIRONMENTS } from '../../domain/project';
import { ERROR_CODES, PipelineError } from '../../domain/errors';
import { libraryPaths } from '../../config/env';
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
   * A landscape frame and a landscape library, so this is rarely exercised - and
   * when it is, the interface has promised the user that an off-ratio photograph
   * is blurred at the sides rather than cropped into.
   */
  coverTolerance: 1.35,

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
  async generateStoryboard(input, config, logger) {
    const paths = libraryPaths(config.libraryDir);
    const library = await readLibrary(paths);
    assertLibraryReady(library);

    const chosen = resolveEnvironments(library.environment, input.brief, logger);

    logger.done(
      `Library ready (${chosen.length} backdrop(s) in play` +
        `${chosen.length === library.counts.environment ? '' : ` of ${library.counts.environment}`})`,
    );

    // Not fatal: a small library still renders, it just shows the same
    // photograph several times over a ten minute episode. Said before the
    // Claude call rather than after the render, since that is when it can still
    // be acted on.
    if (chosen.length < COMFORTABLE_ENVIRONMENTS) {
      logger.warn(
        `Only ${chosen.length} backdrop(s) available to this episode; ${COMFORTABLE_ENVIRONMENTS} ` +
          'or more keeps a long one from looking like the same picture on repeat.',
      );
    }

    return generate(
      { ...input, assets: { environment: chosen }, previewDir: paths.preview },
      config,
      logger,
    );
  },

  resolveBackdrops,
  buildCaptions,

  /**
   * The chosen backdrops go into the hash.
   *
   * Without them, narrowing a project's selection would change which
   * photographs the next script may use while leaving the hash untouched - so
   * the run would report "already up to date" and leave the old video in place.
   */
  hashInputs: ({ brief }) => ({ environments: (brief?.environments ?? []).join(',') }),
};
