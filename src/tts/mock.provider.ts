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
 * clients, and narration is a hard requirement - so without a stand-in, one
 * upstream outage would make the whole system untestable and unrenderable, not
 * merely voiceless. It is also how a layout change gets checked in seconds
 * rather than by waiting on ten minutes of speech.
 *
 * Any job that uses it is stamped `devMock` so a placeholder render can never
 * be mistaken for something publishable.
 */
export class MockTTSProvider implements TTSProvider {
  readonly name = 'mock';

  /**
   * Words per second, taken from the module's own measured pace.
   *
   * It has to be the module's, and the gap is not small: the podcast reads 139
   * words a minute in English and a fact short 318 syllables a minute in
   * Vietnamese, so one shared number would make every mock render of one of
   * them come out at roughly half or double its real length - and a mock render
   * exists precisely to check the layout at the length the real thing will be.
   *
   * A whitespace token is a word in English and a syllable in Vietnamese, which
   * is why the two figures are not comparable but each is a fair proxy: within
   * one language the variation between short and long tokens averages out over
   * a paragraph.
   */
  private readonly wordsPerSecond: number;

  private static readonly LEAD_IN_MS = 120;

  constructor(wordsPerMinute: number) {
    this.wordsPerSecond = wordsPerMinute / 60;
  }

  async synthesize(input: TTSInput): Promise<TTSResult> {
    const tokens = input.text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      throw new Error('MockTTSProvider received empty text; narration is mandatory');
    }

    const speechMs = (tokens.length / this.wordsPerSecond) * 1000;
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
