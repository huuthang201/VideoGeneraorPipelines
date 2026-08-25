import path from 'node:path';
import { exec } from '../utils/exec';

/**
 * Media inspection (spec §37).
 *
 * No system ffmpeg is required: Remotion ships a statically-linked ffprobe 7.1
 * built with the codecs this pipeline uses (H.264, AAC, mp3, mp4). A system
 * ffprobe is preferred when present purely because spawning it is faster than
 * going through Remotion's CLI wrapper - the output is identical either way.
 */

export interface MediaStream {
  codec_type: 'video' | 'audio' | string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  sample_rate?: string;
  channels?: number;
}

export interface MediaInfo {
  format: { duration?: string; size?: string; format_name?: string };
  streams: MediaStream[];
}

let cachedBinary: { cmd: string; args: string[] } | null = null;

async function resolveFfprobe(): Promise<{ cmd: string; args: string[] }> {
  if (cachedBinary) return cachedBinary;

  const system = await exec('which', ['ffprobe']).catch(() => null);
  if (system && system.code === 0 && system.stdout.trim()) {
    cachedBinary = { cmd: system.stdout.trim(), args: [] };
    return cachedBinary;
  }

  cachedBinary = {
    cmd: path.join(process.cwd(), 'node_modules', '.bin', 'remotion'),
    args: ['ffprobe'],
  };
  return cachedBinary;
}

export async function probe(filePath: string): Promise<MediaInfo> {
  const { cmd, args } = await resolveFfprobe();
  const result = await exec(
    cmd,
    [...args, '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeoutMs: 60_000 },
  );

  if (result.code !== 0) {
    throw new Error(`ffprobe failed for ${filePath} (exit ${result.code}): ${result.stderr.trim()}`);
  }

  // Remotion's wrapper prefixes its own banner before the JSON payload.
  const start = result.stdout.indexOf('{');
  if (start === -1) {
    throw new Error(`ffprobe returned no JSON for ${filePath}`);
  }

  try {
    return JSON.parse(result.stdout.slice(start)) as MediaInfo;
  } catch (err) {
    throw new Error(`Could not parse ffprobe output for ${filePath}`, { cause: err });
  }
}

/** Duration in seconds. Throws rather than returning 0 for an unreadable file. */
export async function getDurationSeconds(filePath: string): Promise<number> {
  const info = await probe(filePath);

  const fromFormat = info.format?.duration ? Number.parseFloat(info.format.duration) : NaN;
  if (Number.isFinite(fromFormat) && fromFormat > 0) return fromFormat;

  // Some mp3s written incrementally lack a format-level duration; fall back to
  // the longest stream.
  const streamDurations = info.streams
    .map((s) => (s.duration ? Number.parseFloat(s.duration) : NaN))
    .filter((d) => Number.isFinite(d) && d > 0);

  if (streamDurations.length > 0) return Math.max(...streamDurations);

  throw new Error(`Could not determine duration of ${filePath}`);
}

export function findStream(info: MediaInfo, type: 'video' | 'audio'): MediaStream | undefined {
  return info.streams.find((s) => s.codec_type === type);
}

/**
 * Fraction of the file's duration that is silence, or NaN if it could not be
 * measured.
 *
 * Needed because Remotion emits an AAC track even for a composition with no
 * <Audio> at all (verified in M0), so "an audio stream exists" says nothing
 * about whether the narration actually made it into the file. Spec §7 makes
 * Narration is mandatory, so the output gate has to check the content
 * of the track and not merely its presence.
 */
export async function detectSilenceRatio(filePath: string, totalSeconds: number): Promise<number> {
  if (totalSeconds <= 0) return 1;

  const { cmd, args } = await resolveFfprobe();
  // The bundled build enables the silencedetect filter, so this works on the
  // Remotion binary as well as a system ffmpeg.
  const ffmpegCmd = args.length > 0 ? { cmd, args: ['ffmpeg'] } : { cmd: cmd.replace(/ffprobe$/, 'ffmpeg'), args: [] };

  const result = await exec(
    ffmpegCmd.cmd,
    [
      ...ffmpegCmd.args,
      '-hide_banner',
      '-nostats',
      '-i',
      filePath,
      // Dropping the video stream is required, not an optimisation: writing to
      // the null muxer otherwise needs the wrapped_avframe encoder, which
      // Remotion's stripped ffmpeg build does not include. Without -vn the
      // command fails, and a failure here would silently report "not silent"
      // and wave a voiceless video through the gate.
      '-vn',
      '-af',
      'silencedetect=noise=-50dB:d=0.5',
      '-f',
      'null',
      '-',
    ],
    { timeoutMs: 120_000 },
  ).catch(() => null);

  // Distinguish "measured no silence" from "could not measure". Reporting 0 for
  // a failed probe would defeat the mandatory-narration gate, so an unusable
  // result is surfaced as NaN for the caller to treat as inconclusive.
  if (!result || result.code !== 0) return Number.NaN;

  // silencedetect reports on stderr as `silence_duration: <seconds>`.
  const durations = [...result.stderr.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) =>
    Number.parseFloat(m[1]!),
  );
  const silent = durations.reduce((sum, d) => sum + d, 0);
  return Math.min(1, silent / totalSeconds);
}
