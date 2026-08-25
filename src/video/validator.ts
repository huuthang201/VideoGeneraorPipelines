import { stat } from 'node:fs/promises';
import { detectSilenceRatio, findStream, getDurationSeconds, probe } from './ffprobe';
import { ERROR_CODES, type ErrorCode } from '../domain/errors';

/**
 * Output validation (spec §39).
 *
 * Runs against the encoded file rather than against what the pipeline believes
 * it produced, because the point is to catch the cases where those two differ.
 */

export interface ValidateOutputOptions {
  expectedWidth: number;
  expectedHeight: number;
  /** Minimum plausible length; anything shorter is a broken render. */
  minDurationSec?: number;
  maxDurationSec?: number;
  /** Voice track length, to check the narration was not truncated. */
  expectedVoiceDurationSec?: number;
  /**
   * Set for a mock-narration render so the silence check reports rather than
   * fails. Never set for anything intended for publication.
   */
  allowSilentAudio?: boolean;
}

export interface ValidationProblem {
  code: ErrorCode;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  problems: ValidationProblem[];
  warnings: string[];
  measured: {
    sizeBytes: number;
    width?: number;
    height?: number;
    videoCodec?: string;
    audioCodec?: string;
    durationSec: number;
    silenceRatio: number;
  };
}

const MIN_PLAUSIBLE_BYTES = 50_000;

export async function validateOutput(
  videoPath: string,
  options: ValidateOutputOptions,
): Promise<ValidationReport> {
  const problems: ValidationProblem[] = [];
  const warnings: string[] = [];

  const stats = await stat(videoPath).catch(() => null);
  if (!stats) {
    return {
      ok: false,
      problems: [{ code: ERROR_CODES.OUTPUT_MISSING, message: `No file at ${videoPath}` }],
      warnings,
      measured: { sizeBytes: 0, durationSec: 0, silenceRatio: Number.NaN },
    };
  }

  if (stats.size < MIN_PLAUSIBLE_BYTES) {
    problems.push({
      code: ERROR_CODES.OUTPUT_TOO_SMALL,
      message: `File is ${stats.size} bytes, below the ${MIN_PLAUSIBLE_BYTES} byte floor`,
    });
  }

  let info;
  try {
    info = await probe(videoPath);
  } catch (err) {
    return {
      ok: false,
      problems: [
        {
          code: ERROR_CODES.OUTPUT_UNREADABLE,
          message: `ffprobe could not read the file: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      warnings,
      measured: { sizeBytes: stats.size, durationSec: 0, silenceRatio: Number.NaN },
    };
  }

  const video = findStream(info, 'video');
  const audio = findStream(info, 'audio');
  const durationSec = await getDurationSeconds(videoPath).catch(() => 0);

  if (!video) {
    problems.push({ code: ERROR_CODES.OUTPUT_NO_VIDEO_STREAM, message: 'No video stream' });
  } else if (video.width !== options.expectedWidth || video.height !== options.expectedHeight) {
    problems.push({
      code: ERROR_CODES.OUTPUT_WRONG_RESOLUTION,
      message: `Expected ${options.expectedWidth}x${options.expectedHeight}, got ${video.width}x${video.height}`,
    });
  }

  // Narration is mandatory, so a missing or empty audio track is a hard failure
  // rather than a cosmetic issue.
  if (!audio) {
    problems.push({ code: ERROR_CODES.OUTPUT_NO_AUDIO_STREAM, message: 'No audio stream' });
  }

  const minDuration = options.minDurationSec ?? 8;
  // Five minutes. Only a runaway guard - the length people actually want is a
  // preference expressed in the brief and enforced by the word budget, not
  // something to fail a finished render over. The Shorts ceiling is sixty
  // seconds, and this sits well above it on purpose: a video that overshoots
  // the format is still a video, and telling someone their render is unusable
  // is the brief's job, not the validator's.
  const maxDuration = options.maxDurationSec ?? 300;

  if (durationSec < minDuration) {
    problems.push({
      code: ERROR_CODES.OUTPUT_BAD_DURATION,
      message: `Duration ${durationSec.toFixed(2)}s is under the ${minDuration}s minimum`,
    });
  } else if (durationSec > maxDuration) {
    problems.push({
      code: ERROR_CODES.OUTPUT_BAD_DURATION,
      message: `Duration ${durationSec.toFixed(2)}s exceeds the ${maxDuration}s ceiling`,
    });
  }

  const silenceRatio = audio ? await detectSilenceRatio(videoPath, durationSec) : 1;

  if (Number.isNaN(silenceRatio)) {
    // Inconclusive rather than clean. Saying nothing here is how a voiceless
    // video slips through, so it is surfaced explicitly.
    warnings.push('Could not measure audio content; the narration check did not run');
  } else if (silenceRatio > 0.9) {
    if (options.allowSilentAudio) {
      warnings.push(`Audio is ${(silenceRatio * 100).toFixed(0)}% silent (mock narration)`);
    } else {
      problems.push({
        code: ERROR_CODES.OUTPUT_SILENT_AUDIO,
        message:
          `Audio track is ${(silenceRatio * 100).toFixed(0)}% silent. ` +
          'Remotion writes an AAC track even with no audio, so a present stream does not mean narration was included.',
      });
    }
  }

  // A video much shorter than its narration means speech was cut off - the
  // exact defect found during M2.
  if (options.expectedVoiceDurationSec && options.expectedVoiceDurationSec > 0) {
    const shortfall = options.expectedVoiceDurationSec - durationSec;
    if (shortfall > 0.5) {
      problems.push({
        code: ERROR_CODES.OUTPUT_BAD_DURATION,
        message:
          `Video is ${durationSec.toFixed(2)}s but the narration runs ${options.expectedVoiceDurationSec.toFixed(2)}s; ` +
          `${shortfall.toFixed(2)}s of speech would be cut off`,
      });
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    measured: {
      sizeBytes: stats.size,
      width: video?.width,
      height: video?.height,
      videoCodec: video?.codec_name,
      audioCodec: audio?.codec_name,
      durationSec,
      silenceRatio,
    },
  };
}
