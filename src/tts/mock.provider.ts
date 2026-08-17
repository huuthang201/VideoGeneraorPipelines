import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { TTSInput, TTSProvider, TTSResult, WordTiming } from './types';
import { serializeSrt, wordsToCues } from './srt';
import { exec } from '../utils/exec';
import { getDurationSeconds } from '../video/ffprobe';

/**
 * Placeholder narration: silence of a plausible length, with synthetic word
 * timings spread across it.
 *
 * This exists because Edge TTS is the pipeline's single point of failure. It is
 * an unofficial Microsoft endpoint that has repeatedly started rejecting
 * clients, and Vietnamese narration is a hard requirement (spec §7) - so
 * without a stand-in, one upstream outage would make the whole system
 * untestable and unrenderable, not merely voiceless.
 *
 * It is written before the real provider on purpose: every downstream stage can
 * then be built and tested offline, and the Edge integration becomes one
 * swappable piece rather than a prerequisite for all the others.
 *
 * Any job that uses it is stamped `devMock` so a placeholder render can never
 * be mistaken for something publishable.
 */
export class MockTTSProvider implements TTSProvider {
  readonly name = 'mock';

  /**
   * Vietnamese is syllable-timed and written with syllables separated by
   * spaces, so token count is a good proxy for length. ~5.2 syllables/second
   * matches the measured pace of vi-VN-HoaiMyNeural at +5%.
   */
  private static readonly SYLLABLES_PER_SECOND = 5.2;
  private static readonly LEAD_IN_MS = 120;

  async synthesize(input: TTSInput): Promise<TTSResult> {
    const tokens = input.text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      throw new Error('MockTTSProvider received empty text; narration is mandatory');
    }

    const speechMs = (tokens.length / MockTTSProvider.SYLLABLES_PER_SECOND) * 1000;
    const totalMs = MockTTSProvider.LEAD_IN_MS + speechMs + 300;

    await mkdir(input.outDir, { recursive: true });
    const audioPath = path.join(input.outDir, 'voice.mp3');
    await writeSilentMp3(audioPath, totalMs / 1000);

    const perToken = speechMs / tokens.length;
    const words: WordTiming[] = tokens.map((text, i) => ({
      text,
      fromMs: Math.round(MockTTSProvider.LEAD_IN_MS + i * perToken),
      // A small inter-word gap keeps the highlight from looking glued together
      // and makes the mock behave like the real thing for caption tests.
      toMs: Math.round(MockTTSProvider.LEAD_IN_MS + (i + 1) * perToken - perToken * 0.12),
    }));

    const captionsPath = path.join(input.outDir, 'captions.srt');
    await writeFile(captionsPath, serializeSrt(wordsToCues(words)), 'utf8');

    // Measured, not assumed - the encoder rounds to a frame boundary and the
    // rest of the pipeline must work from the real file length.
    const duration = await getDurationSeconds(audioPath);

    return {
      audioPath,
      captionsPath,
      duration,
      words,
      isMock: true,
      voice: input.voice,
    };
  }
}

/**
 * Writes a silent mp3 using the ffmpeg bundled with Remotion, so this works on
 * a machine with no system ffmpeg (as verified during M0).
 */
async function writeSilentMp3(outPath: string, seconds: number): Promise<void> {
  const remotionBin = path.join(process.cwd(), 'node_modules', '.bin', 'remotion');

  const result = await exec(
    remotionBin,
    [
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=24000:cl=mono`,
      '-t',
      seconds.toFixed(3),
      '-c:a',
      'libmp3lame',
      '-b:a',
      '48k',
      '-y',
      outPath,
    ],
    { timeoutMs: 60_000 },
  );

  if (result.code !== 0) {
    throw new Error(`Could not write silent mp3: ${result.stderr.trim() || result.stdout.trim()}`);
  }
}
