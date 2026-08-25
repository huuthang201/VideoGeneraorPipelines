import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { TTSInput, TTSProvider, TTSResult, WordTiming } from './types';
import { serializeSrt, wordsToCues } from './srt';
import { restorePunctuation } from './punctuation';
import { exec } from '../utils/exec';
import { getDurationSeconds } from '../video/ffprobe';
import { ERROR_CODES, PipelineError } from '../domain/errors';

interface SynthPayload {
  ok: boolean;
  error?: string;
  audioPath?: string;
  bytes?: number;
  speechEndMs?: number;
  words?: WordTiming[];
}

/**
 * Ceiling for one synthesis call, when the caller names none.
 *
 * One call carries a whole script, so the right ceiling depends entirely on how
 * long that script is - and the two modules are an order of magnitude apart.
 * Forty-five seconds of speech comes back in a few seconds on a healthy
 * connection; ten minutes of it does not, and a two-minute ceiling would fail
 * every podcast episode without anything being wrong.
 *
 * Two minutes is the default because it suits the short, whose queue is dozens
 * of videos long and where a hung call parking the queue is the real risk. The
 * podcast module passes its own.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Vietnamese narration via Microsoft Edge's read-aloud service.
 *
 * The actual protocol work is delegated to scripts/edge_tts_synth.py rather
 * than reimplemented in Node. That is deliberate: the endpoint is unofficial
 * and Microsoft periodically changes its handshake (the Sec-MS-GEC token being
 * the recurring example). The Python `edge-tts` package is where those changes
 * get fixed first and fastest, so tracking it costs one subprocess call and
 * buys the shortest path to a working voice when the service shifts.
 *
 * One call synthesises the whole script. The service streams a single
 * utterance of any length and reports a boundary event per word throughout -
 * for Vietnamese one per syllable, which is exactly the granularity the
 * subtitles want - so splitting the script up would buy nothing and would
 * introduce seams in the audio.
 */
export class EdgeTTSProvider implements TTSProvider {
  readonly name = 'edge';

  constructor(
    private readonly pythonBin: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async synthesize(input: TTSInput): Promise<TTSResult> {
    if (!input.text.trim()) {
      throw new PipelineError(
        ERROR_CODES.TTS_GENERATION_FAILED,
        'generate-tts',
        'Refusing to synthesize empty text; narration is mandatory',
      );
    }

    await mkdir(input.outDir, { recursive: true });

    const textPath = path.join(input.outDir, 'narration.txt');
    const audioPath = path.join(input.outDir, 'voice.mp3');
    await writeFile(textPath, input.text, 'utf8');

    const script = path.join(process.cwd(), 'scripts', 'edge_tts_synth.py');
    const args = [script, '--text-file', textPath, '--voice', input.voice, '--out', audioPath];

    // `--pitch=-10Hz`, not `--pitch -10Hz`. Passed as two arguments, argparse
    // reads a leading minus as the start of another option and rejects the
    // call, which made every negative value - that is, every deeper or slower
    // delivery - impossible to request.
    if (input.rate) args.push(`--rate=${input.rate}`);
    if (input.pitch) args.push(`--pitch=${input.pitch}`);
    if (input.volume) args.push(`--volume=${input.volume}`);

    let result;
    try {
      result = await exec(this.pythonBin, args, { timeoutMs: this.timeoutMs });
    } catch (err) {
      throw new PipelineError(
        ERROR_CODES.TTS_PYTHON_MISSING,
        'generate-tts',
        `Could not run ${this.pythonBin}. Run "npm run setup:python" first.`,
        { pythonBin: this.pythonBin },
        { cause: err },
      );
    }

    const payload = parsePayload(result.stdout);

    if (result.code !== 0 || !payload?.ok) {
      const detail = payload?.error ?? result.stderr.trim() ?? 'unknown error';
      throw new PipelineError(
        ERROR_CODES.TTS_GENERATION_FAILED,
        'generate-tts',
        `Edge TTS failed: ${detail}`,
        { exitCode: result.code, voice: input.voice },
      );
    }

    const duration = await getDurationSeconds(audioPath);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new PipelineError(
        ERROR_CODES.TTS_EMPTY_AUDIO,
        'generate-tts',
        `Edge TTS produced a file with no measurable duration (${duration}s)`,
      );
    }

    // The service reports spoken words, stripped of punctuation; the captions
    // are built from these timings, so they get the script's own tokens back.
    const words = restorePunctuation(input.text, payload.words ?? []);

    const captionsPath = path.join(input.outDir, 'captions.srt');
    await writeFile(captionsPath, serializeSrt(wordsToCues(words)), 'utf8');

    return { audioPath, captionsPath, duration, words, isMock: false, voice: input.voice };
  }
}

/**
 * The helper prints one JSON object on stdout. Scanning for the last line that
 * parses keeps this robust against any library that writes a stray warning
 * ahead of it.
 */
function parsePayload(stdout: string): SynthPayload | null {
  const lines = stdout.trim().split('\n').reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      return JSON.parse(trimmed) as SynthPayload;
    } catch {
      continue;
    }
  }
  return null;
}
