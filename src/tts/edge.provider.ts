import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { TTSInput, TTSProvider, TTSResult, WordTiming } from './types';
import { serializeSrt, wordsToCues } from './srt';
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
 * Vietnamese narration via Microsoft Edge's read-aloud service (spec §13).
 *
 * The actual protocol work is delegated to scripts/edge_tts_synth.py rather
 * than reimplemented in Node. That is deliberate: the endpoint is unofficial
 * and Microsoft periodically changes its handshake (the Sec-MS-GEC token being
 * the recurring example). The Python `edge-tts` package is where those changes
 * get fixed first and fastest, so tracking it costs one subprocess call and
 * buys the shortest path to a working voice when the service shifts.
 */
export class EdgeTTSProvider implements TTSProvider {
  readonly name = 'edge';

  constructor(private readonly pythonBin: string) {}

  async synthesize(input: TTSInput): Promise<TTSResult> {
    if (!input.text.trim()) {
      throw new PipelineError(
        ERROR_CODES.TTS_GENERATION_FAILED,
        'generate-tts',
        'Refusing to synthesize empty text; Vietnamese narration is mandatory (spec §7)',
      );
    }

    await mkdir(input.outDir, { recursive: true });

    const textPath = path.join(input.outDir, 'narration.txt');
    const audioPath = path.join(input.outDir, 'voice.mp3');
    await writeFile(textPath, input.text, 'utf8');

    const script = path.join(process.cwd(), 'scripts', 'edge_tts_synth.py');
    const args = [script, '--text-file', textPath, '--voice', input.voice, '--out', audioPath];
    if (input.rate) args.push('--rate', input.rate);

    let result;
    try {
      result = await exec(this.pythonBin, args, { timeoutMs: 180_000 });
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

    const words = payload.words ?? [];

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
