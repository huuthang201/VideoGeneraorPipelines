import path from 'node:path';
import { exec } from '../utils/exec';
import { ERROR_CODES, PipelineError } from '../domain/errors';

/**
 * The one place that runs ffmpeg.
 *
 * Resolved exactly the way `ffprobe.ts` resolves its own binary, and for the
 * same reason: Remotion ships a statically-linked build with the codecs this
 * pipeline uses, so no system ffmpeg is required. A system one is preferred
 * when present only because spawning it directly is faster than going through
 * Remotion's CLI wrapper.
 */

let cachedBinary: { cmd: string; args: string[] } | null = null;

async function resolveFfmpeg(): Promise<{ cmd: string; args: string[] }> {
  if (cachedBinary) return cachedBinary;

  const system = await exec('which', ['ffmpeg']).catch(() => null);
  if (system && system.code === 0 && system.stdout.trim()) {
    cachedBinary = { cmd: system.stdout.trim(), args: [] };
    return cachedBinary;
  }

  cachedBinary = {
    cmd: path.join(process.cwd(), 'node_modules', '.bin', 'remotion'),
    args: ['ffmpeg'],
  };
  return cachedBinary;
}

/**
 * Re-encodes a voice track to MP3, optionally faster or slower.
 *
 * `atempo` is used rather than a resample because it stretches time without
 * moving pitch: a narrator sped up by resampling turns into a chipmunk, which
 * is the whole reason a speed control needs a filter at all. The filter accepts
 * 0.5 to 2.0 in one pass, which covers every speed anyone would ask a narrator
 * for; anything outside that is rejected here rather than silently producing an
 * ffmpeg error halfway through a job.
 *
 * MP3 rather than keeping the WAV because the file is staged into the render
 * bundle and read by a browser - a 48kHz mono WAV of forty-five seconds is
 * about eight megabytes, and the MP3 is a tenth of that with no audible
 * difference under music and a subtitle.
 */
export async function encodeVoice(input: {
  sourcePath: string;
  outputPath: string;
  /** 1 leaves the timing alone. See `atempo` above for the accepted range. */
  speed: number;
}): Promise<void> {
  const { speed } = input;
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    throw new PipelineError(
      ERROR_CODES.TTS_GENERATION_FAILED,
      'generate-tts',
      `TTS_SPEED is ${speed}, outside the 0.5-2.0 range ffmpeg's atempo filter accepts.`,
    );
  }

  const { cmd, args } = await resolveFfmpeg();
  const filter = speed === 1 ? [] : ['-filter:a', `atempo=${speed}`];

  const result = await exec(
    cmd,
    [...args, '-y', '-i', input.sourcePath, ...filter, '-q:a', '2', input.outputPath],
    { timeoutMs: 120_000 },
  );

  if (result.code !== 0) {
    throw new PipelineError(
      ERROR_CODES.TTS_GENERATION_FAILED,
      'generate-tts',
      `ffmpeg could not encode the voice track: ${result.stderr.trim().slice(-400)}`,
    );
  }
}
