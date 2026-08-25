import type { VideoModule } from '../contract';
import { FACT_PACING } from './pacing';
import { BriefSchema, targetSecondsOf, type Brief } from './domain/brief';
import { OVERRUN_TOLERANCE, StoryboardSchema, type Storyboard } from './domain/storyboard';
import type { Scene } from './domain/scene';
import { generateStoryboard } from './storyboard-provider';
import { resolveBackdrops } from './backdrops';
import { buildCaptions } from './captions';
import { SHORTS_MAX_SECONDS } from '../../domain/config';
import { ERROR_CODES, PipelineError } from '../../domain/errors';
import { isVietnameseVoice } from '../../tts/types';

/**
 * The fact-shorts pipeline: a sentence about a fact becomes a thirty-to-sixty
 * second 9:16 video with Vietnamese narration, shot against photographs the
 * engine finds itself.
 */
export const factModule: VideoModule<Brief, Scene, Storyboard> = {
  id: 'fact',
  label: 'Fact Shorts',
  description: 'Vietnamese fact shorts, 30-60s, 9:16, photographs searched automatically',

  pacing: FACT_PACING,

  /**
   * Generous on purpose: a 16:9 stock photograph has to fill a 9:16 frame, and
   * cropping a backdrop heavily costs nothing. At 1.35 every scene of every
   * video came out as a band across the middle with blurred grey around it.
   */
  coverTolerance: 4,

  /** Five minutes, well above the sixty-second Shorts ceiling on purpose: a video
   * that overshoots the format is still a video, and saying so is the brief's
   * job rather than the validator's. */
  outputDurationGuard: { minSeconds: 8, maxSeconds: 300 },

  /** Two minutes, far above the tail for forty-five seconds of speech, and still
   * bounded - the queue here is dozens of videos long, so a hung call parking it
   * is the risk worth guarding. */
  ttsTimeoutMs: 120_000,

  parseBrief: (raw) => BriefSchema.parse(raw),
  parseStoryboard: (raw) => StoryboardSchema.parse(raw),
  targetSecondsOf,

  /**
   * Keeps the *requested* length far enough under the ceiling that an accepted
   * script cannot cross it.
   *
   * Sixty seconds is a cliff, not a preference: past it YouTube stops serving
   * the upload in the Shorts feed, so a video that overruns is not a long short
   * - it is an ordinary video nobody is shown.
   *
   * Note that the clamp is to 52 seconds, not 60, and that gap is the whole
   * point. The word budget is a target rather than a limit:
   * `checkStoryboardStructure` accepts anything within `OVERRUN_TOLERANCE` of
   * it, and the model routinely uses that allowance. So asking for sixty really
   * means asking for up to sixty-nine, and the video stops being a Short
   * without a single check having failed. Clamping the request instead of
   * tightening the tolerance keeps the slack that lets a good script finish its
   * last sentence.
   *
   * Only when the frame is actually vertical - a fact video deliberately
   * rendered 16:9 is not a Short and has no ceiling to respect.
   */
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
   * The narrator has to be Vietnamese, and only the Edge engine can get this
   * wrong: `vieneu` names its voices by preset ("Thanh Bình"), which carries no
   * locale to check, and every one of them is Vietnamese by construction.
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
  resolveBackdrops: ({ storyboard, config, logger }) =>
    resolveBackdrops({ storyboard, config, logger }),
  buildCaptions,

  /**
   * Nothing extra.
   *
   * No image paths go into the key and they cannot: the pictures are searched
   * for using queries that live *inside* the storyboard, so they do not exist
   * yet when the hash is computed. The storyboard covers them by proxy - change
   * a query and the hash changes - and the search cache means an unchanged
   * storyboard resolves to the same photographs anyway.
   */
  hashInputs: () => ({}),
};
