import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import type { TTSInput, TTSProvider, TTSResult, WordTiming } from './types';
import { serializeSrt, wordsToCues } from './srt';
import { ERROR_CODES, PipelineError } from '../domain/errors';
import { distributeWordsAcrossChunks, type SynthesisChunk } from './chunk-timing';

/**
 * Vietnamese narration via VieNeu-TTS v3 Turbo, running on-device.
 *
 * The engine is a neural model that has to be loaded before it can speak, which
 * makes it a poor fit for the one-process-per-call shape the previous Edge
 * provider used: startup would dominate every job, and a batch of ten videos
 * would pay for it ten times. Instead a single worker process is kept alive and
 * fed requests over stdin, so the model is loaded once per run.
 *
 * The worker is a module-level singleton rather than per-provider-instance
 * because the pipeline constructs a provider per job; sharing it is what lets a
 * `generate-all` batch reuse one loaded model across every video.
 */

interface WorkerResponse {
  ok: boolean;
  id?: string;
  code?: string;
  error?: string;
  audioPath?: string;
  durationSec?: number;
  sampleRate?: number;
  chunks?: SynthesisChunk[];
  engine?: string;
  voice?: string;
  device?: string;
  presetVoices?: string[];
}

export interface VieNeuOptions {
  pythonBin: string;
  /** Reference clip for a cloned voice, or null to use a built-in preset. */
  referenceAudio: string | null;
  voice: string;
  onLog?: (message: string) => void;
}

/** Sample rate v3 Turbo produces natively. Never resampled by this pipeline. */
export const VIENEU_SAMPLE_RATE = 48_000;

let sharedWorker: VieNeuWorker | null = null;

/** Shuts the shared worker down. Called by the CLI so the process can exit. */
export async function shutdownVieNeu(): Promise<void> {
  await sharedWorker?.shutdown();
  sharedWorker = null;
}

class VieNeuWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private ready: Promise<WorkerResponse> | null = null;
  private pending = new Map<string, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>();
  private nextId = 0;
  private fatal: Error | null = null;

  constructor(private readonly options: VieNeuOptions) {}

  async start(): Promise<WorkerResponse> {
    if (this.ready) return this.ready;

    this.ready = new Promise<WorkerResponse>((resolve, reject) => {
      const script = path.join(process.cwd(), 'scripts', 'vieneu_tts.py');
      const args = [script, '--serve', '--voice', this.options.voice];
      if (this.options.referenceAudio) args.push('--reference', this.options.referenceAudio);

      const child = spawn(this.options.pythonBin, args, {
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
      this.child = child;

      // The worker logs progress on stderr; only stdout carries the protocol.
      child.stderr.on('data', (d: Buffer) => {
        for (const line of d.toString('utf8').split('\n')) {
          if (line.trim()) this.options.onLog?.(line.trim());
        }
      });

      child.stdout.on('data', (d: Buffer) => this.consume(d.toString('utf8'), resolve, reject));

      child.on('error', (err) => {
        this.fatal = new Error(
          `Could not start ${this.options.pythonBin}: ${err.message}. Run "npm run setup:python".`,
        );
        reject(this.fatal);
        this.failAllPending();
      });

      child.on('close', (code) => {
        this.child = null;
        if (!this.fatal && code !== 0) {
          this.fatal = new Error(`VieNeu worker exited with code ${code}`);
        }
        this.failAllPending();
      });
    });

    return this.ready;
  }

  private consume(
    text: string,
    onReady: (r: WorkerResponse) => void,
    onReadyError: (e: Error) => void,
  ): void {
    this.buffer += text;

    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;

      let message: WorkerResponse;
      try {
        message = JSON.parse(line) as WorkerResponse;
      } catch {
        // Not protocol traffic - most likely a library writing to stdout.
        this.options.onLog?.(line);
        continue;
      }

      if (message.id !== undefined && this.pending.has(message.id)) {
        this.pending.get(message.id)!.resolve(message);
        this.pending.delete(message.id);
        continue;
      }

      // Startup either announces readiness or reports why it could not start.
      if (message.ok) onReady(message);
      else onReadyError(new Error(message.error ?? 'VieNeu failed to start'));
    }
  }

  private failAllPending(): void {
    const error = this.fatal ?? new Error('VieNeu worker stopped');
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  async request(payload: Record<string, unknown>, timeoutMs: number): Promise<WorkerResponse> {
    await this.start();
    if (!this.child) throw this.fatal ?? new Error('VieNeu worker is not running');

    const id = String(this.nextId++);

    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`VieNeu did not respond within ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      this.child!.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    });
  }

  async shutdown(): Promise<void> {
    if (!this.child) return;
    try {
      await this.request({ op: 'shutdown' }, 5_000);
    } catch {
      this.child?.kill('SIGTERM');
    }
    this.child = null;
    this.ready = null;
  }
}

export class VieNeuTTSProvider implements TTSProvider {
  readonly name = 'vieneu';

  constructor(private readonly options: VieNeuOptions) {}

  async synthesize(input: TTSInput): Promise<TTSResult> {
    if (!input.text.trim()) {
      throw new PipelineError(
        ERROR_CODES.TTS_GENERATION_FAILED,
        'generate-tts',
        'Refusing to synthesize empty text; Vietnamese narration is mandatory (spec §7)',
      );
    }

    await this.assertReferenceAudio();
    await mkdir(input.outDir, { recursive: true });

    const audioPath = path.join(input.outDir, 'voice.wav');
    await writeFile(path.join(input.outDir, 'narration.txt'), input.text, 'utf8');

    if (!sharedWorker) sharedWorker = new VieNeuWorker(this.options);

    let response: WorkerResponse;
    try {
      response = await sharedWorker.request(
        { op: 'synthesize', text: input.text, voice: input.voice, out: audioPath },
        600_000,
      );
    } catch (err) {
      // A worker that died takes its model with it; drop the singleton so the
      // next attempt starts cleanly rather than writing into a dead pipe.
      sharedWorker = null;
      throw new PipelineError(
        ERROR_CODES.TTS_GENERATION_FAILED,
        'generate-tts',
        `VieNeu synthesis failed: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        { cause: err },
      );
    }

    if (!response.ok) {
      throw new PipelineError(
        ERROR_CODES.TTS_GENERATION_FAILED,
        'generate-tts',
        `VieNeu synthesis failed (${response.code ?? 'unknown'}): ${response.error ?? 'no detail'}`,
      );
    }

    const durationSec = response.durationSec ?? 0;
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new PipelineError(
        ERROR_CODES.TTS_EMPTY_AUDIO,
        'generate-tts',
        `VieNeu produced audio with no measurable duration (${durationSec}s)`,
      );
    }

    // VieNeu reports where each sentence sits but not where each word does, so
    // word positions are interpolated inside their sentence. Sentence
    // boundaries stay exact, which is what scene cuts and caption pages need.
    const words: WordTiming[] = distributeWordsAcrossChunks(response.chunks ?? []);

    const captionsPath = path.join(input.outDir, 'captions.srt');
    await writeFile(captionsPath, serializeSrt(wordsToCues(words)), 'utf8');

    return {
      audioPath,
      captionsPath,
      duration: durationSec,
      words,
      isMock: false,
      voice: input.voice,
    };
  }

  /**
   * Spec §14: a missing reference clip is an error, never a quiet substitution.
   * Falling back to another voice would change how every video in a series
   * sounds, and nothing downstream would notice.
   */
  private async assertReferenceAudio(): Promise<void> {
    const reference = this.options.referenceAudio;
    if (!reference) return;

    const exists = await access(reference).then(
      () => true,
      () => false,
    );
    if (exists) return;

    throw new PipelineError(
      ERROR_CODES.TTS_GENERATION_FAILED,
      'generate-tts',
      `Adam Vietnamese reference voice not found:\n  ${reference}\n\n` +
        'Place a clean 3-8 second WAV clip of the target voice there, or set ' +
        'TTS_VOICE to one of the built-in preset voices and leave ' +
        'TTS_REFERENCE_AUDIO empty.',
      { referenceAudio: reference },
    );
  }
}
