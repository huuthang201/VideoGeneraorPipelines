import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { TTSInput, TTSProvider, TTSResult, WordTiming } from './types';
import { serializeSrt, wordsToCues } from './srt';
import { exec } from '../utils/exec';
import { encodeVoice } from '../video/ffmpeg';
import { getDurationSeconds } from '../video/ffprobe';
import { ERROR_CODES, PipelineError } from '../domain/errors';

interface SynthPayload {
  ok: boolean;
  error?: string;
  audioPath?: string;
  durationMs?: number;
  sentences?: number;
  words?: WordTiming[];
}

/**
 * Vietnamese narration through VieNeu-TTS, running locally.
 *
 * Chosen over Edge for three reasons, in order of how much they matter here:
 *
 * 1. **Nineteen voices instead of two.** Microsoft's Vietnamese locale has one
 *    male voice, full stop; VieNeu has male and female voices in northern,
 *    central and southern accents, and in reading styles - news, natural,
 *    storytelling - that are audibly different from each other.
 * 2. **It is not an unofficial endpoint.** Edge TTS is Microsoft's read-aloud
 *    service reached through a handshake it does not document, and it
 *    periodically starts refusing clients. VieNeu is a model on disk.
 * 3. **Non-verbal cues.** `[cười]`, `[thở dài]` and `[hắng giọng]` are spoken
 *    as reactions rather than read out, which is the closest thing this format
 *    has to a sound effect inside a sentence.
 *
 * The cost is word timings, which VieNeu does not report - see
 * `scripts/vieneu_synth.py` for how they are reconstructed and how accurate
 * that is. `EdgeTTSProvider` is kept alongside this one rather than deleted,
 * because it is the fallback when a model download is not an option and the
 * only provider that reports real per-word boundaries.
 */
export class VieNeuTTSProvider implements TTSProvider {
  readonly name = 'vieneu';

  constructor(
    private readonly pythonBin: string,
    /** Playback speed applied after synthesis. See `encodeVoice`. */
    private readonly speed: number,
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
    // The model writes a 48kHz WAV; the MP3 beside it is what gets staged into
    // the render. The WAV is removed afterwards - it is ten times the size and
    // nothing reads it once the MP3 exists.
    const wavPath = path.join(input.outDir, 'voice.raw.wav');
    const audioPath = path.join(input.outDir, 'voice.mp3');
    await writeFile(textPath, input.text, 'utf8');

    const script = path.join(process.cwd(), 'scripts', 'vieneu_synth.py');
    const args = [script, '--text-file', textPath, '--out', wavPath];
    if (input.voice) args.push('--voice', input.voice);

    let result;
    try {
      result = await exec(this.pythonBin, args, { timeoutMs: TIMEOUT_MS });
    } catch (err) {
      throw new PipelineError(
        ERROR_CODES.TTS_PYTHON_MISSING,
        'generate-tts',
        `Could not run ${this.pythonBin}. Run "npm run setup:vieneu" first.`,
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
        `VieNeu TTS failed: ${detail}`,
        { exitCode: result.code, voice: input.voice },
      );
    }

    await encodeVoice({ sourcePath: wavPath, outputPath: audioPath, speed: this.speed });
    await rm(wavPath, { force: true });

    const duration = await getDurationSeconds(audioPath);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new PipelineError(
        ERROR_CODES.TTS_EMPTY_AUDIO,
        'generate-tts',
        `VieNeu produced a file with no measurable duration (${duration}s)`,
      );
    }

    /*
     * The timings come back at natural speed, so they are divided by it here.
     *
     * Scaled rather than re-derived because `atempo` is linear: every position
     * in the track moves by the same factor, so a timing that was right before
     * the stretch is right after it once divided. Getting this wrong would not
     * fail anything - it would just put every subtitle progressively further
     * out of step with the voice, which is the failure this pipeline is built
     * to make impossible.
     */
    const words = (payload.words ?? []).map((word) => ({
      text: word.text,
      fromMs: word.fromMs / this.speed,
      toMs: word.toMs / this.speed,
    }));

    const captionsPath = path.join(input.outDir, 'captions.srt');
    await writeFile(captionsPath, serializeSrt(wordsToCues(words)), 'utf8');

    return { audioPath, captionsPath, duration, words, isMock: false, voice: input.voice };
  }
}

/**
 * Ceiling for one synthesis call.
 *
 * Generous because the first call of all is not just synthesis: VieNeu
 * downloads its model from Hugging Face, which on a cold machine is a few
 * hundred megabytes. Afterwards a forty-five second script takes about fifteen
 * seconds including model load, so this only ever fires on a genuinely stuck
 * run.
 */
const TIMEOUT_MS = 900_000;

/**
 * The helper prints one JSON object on stdout. Scanning for the last line that
 * parses keeps this robust against the model loader's own progress output,
 * which is written to stdout on the first run.
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

/** The engine's preset voices, with the label that names accent and style. */
export async function listVieNeuVoices(
  pythonBin: string,
): Promise<{ name: string; label: string }[]> {
  const script = path.join(process.cwd(), 'scripts', 'vieneu_synth.py');
  const result = await exec(pythonBin, [script, '--list-voices'], { timeoutMs: TIMEOUT_MS });

  const payload = parsePayload(result.stdout) as
    | (SynthPayload & { voices?: { name: string; label: string }[] })
    | null;

  if (result.code !== 0 || !payload?.ok || !payload.voices) {
    throw new PipelineError(
      ERROR_CODES.TTS_GENERATION_FAILED,
      'generate-tts',
      `Could not list VieNeu voices: ${payload?.error ?? result.stderr.trim() ?? 'unknown error'}`,
    );
  }

  return payload.voices;
}
