import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { TTSInput, TTSProvider, TTSResult, WordTiming } from './types';
import { serializeSrt, wordsToCues } from './srt';
import { exec } from '../utils/exec';
import { getDurationSeconds } from '../video/ffprobe';
import { ERROR_CODES, PipelineError } from '../domain/errors';

/**
 * Narration through ElevenLabs.
 *
 * Chosen over the Edge endpoint for one reason: the voice. Edge offers 24
 * English female voices and none of them is both young and clearly articulated;
 * ElevenLabs has a library of thousands, so the character is picked rather than
 * settled for.
 *
 * The endpoint is `/with-timestamps`, never the plain one. This pipeline does
 * not merely play the audio - it cuts scenes on speech and highlights the word
 * being spoken - so an engine that returns audio alone is not usable here
 * without bolting on a forced-alignment model. The timestamps come back as
 * character-level spans over the *original* text, which is strictly better than
 * what Edge gives: the punctuation is already in them, so `restorePunctuation`
 * has nothing to repair.
 */

export interface ElevenLabsOptions {
  apiKey: string;
  modelId: string;
  /** 0.7 slowest to 1.2 fastest; 1.0 is the voice's own pace. */
  speed: number;
  /** Lower is more expressive and more variable between takes. */
  stability: number;
  /** Style exaggeration. 0 is the voice as recorded. */
  style: number;
  similarityBoost: number;
}

const API_ROOT = 'https://api.elevenlabs.io/v1';

/**
 * Characters per request.
 *
 * `eleven_multilingual_v2` accepts 10,000; the flash and turbo models accept far
 * more. 9,000 leaves headroom under the smallest of those, and a ten-minute
 * episode is around 8,000 - so in practice an episode is one request, one take,
 * and no seams. Longer scripts are split rather than refused; see `chunkText`.
 */
const MAX_CHARS_PER_REQUEST = 9_000;

/** A single call can take minutes for a long script. */
const REQUEST_TIMEOUT_MS = 600_000;

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface TimestampResponse {
  audio_base64: string;
  alignment: Alignment | null;
  normalized_alignment: Alignment | null;
}

export class ElevenLabsTTSProvider implements TTSProvider {
  readonly name = 'elevenlabs';

  constructor(private readonly options: ElevenLabsOptions) {}

  async synthesize(input: TTSInput): Promise<TTSResult> {
    if (!input.text.trim()) {
      throw new PipelineError(
        ERROR_CODES.TTS_GENERATION_FAILED,
        'generate-tts',
        'Refusing to synthesize empty text; narration is mandatory',
      );
    }

    if (!this.options.apiKey) {
      throw new PipelineError(
        ERROR_CODES.TTS_GENERATION_FAILED,
        'generate-tts',
        'ELEVENLABS_API_KEY is not set. Add it to .env, or set TTS_ENGINE=edge.',
      );
    }

    if (!input.voice) {
      throw new PipelineError(
        ERROR_CODES.TTS_GENERATION_FAILED,
        'generate-tts',
        'No voice id. Set ELEVENLABS_VOICE_ID to the id from the voice library URL.',
      );
    }

    await mkdir(input.outDir, { recursive: true });

    const chunks = chunkText(input.text, MAX_CHARS_PER_REQUEST);
    const partDir = path.join(input.outDir, 'parts');
    await rm(partDir, { recursive: true, force: true });
    await mkdir(partDir, { recursive: true });

    const words: WordTiming[] = [];
    const partPaths: string[] = [];
    let offsetMs = 0;

    try {
      for (const [index, chunk] of chunks.entries()) {
        const payload = await this.request(input.voice, {
          text: chunk,
          // Context for prosody: the model reads the seam as a continuation
          // rather than as a fresh paragraph.
          previous_text: chunks[index - 1],
          next_text: chunks[index + 1],
        });

        const partPath = path.join(partDir, `part-${String(index).padStart(3, '0')}.mp3`);
        await writeFile(partPath, Buffer.from(payload.audio_base64, 'base64'));
        partPaths.push(partPath);

        const alignment = payload.alignment ?? payload.normalized_alignment;
        if (alignment) words.push(...wordsFromAlignment(alignment, offsetMs));

        // The measured file, not the last character's end time: alignment stops
        // at the final consonant while the container carries the tail of the
        // decay, and a few tens of milliseconds per chunk would accumulate into
        // captions that drift by the end of a long episode.
        offsetMs += (await getDurationSeconds(partPath)) * 1000;
      }

      const audioPath = path.join(input.outDir, 'voice.mp3');
      await concatenate(partPaths, audioPath);

      const duration = await getDurationSeconds(audioPath);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new PipelineError(
          ERROR_CODES.TTS_EMPTY_AUDIO,
          'generate-tts',
          `ElevenLabs produced a file with no measurable duration (${duration}s)`,
        );
      }

      const captionsPath = path.join(input.outDir, 'captions.srt');
      await writeFile(captionsPath, serializeSrt(wordsToCues(words)), 'utf8');

      return { audioPath, captionsPath, duration, words, isMock: false, voice: input.voice };
    } finally {
      await rm(partDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async request(
    voiceId: string,
    body: { text: string; previous_text?: string; next_text?: string },
  ): Promise<TimestampResponse> {
    const url = `${API_ROOT}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.options.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...body,
        model_id: this.options.modelId,
        voice_settings: {
          speed: this.options.speed,
          stability: this.options.stability,
          style: this.options.style,
          similarity_boost: this.options.similarityBoost,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch((err) => {
      throw new PipelineError(
        ERROR_CODES.TTS_GENERATION_FAILED,
        'generate-tts',
        `Could not reach ElevenLabs: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        { cause: err },
      );
    });

    if (!response.ok) {
      // The body carries the reason - a wrong voice id, an exhausted quota, a
      // key without permission - and none of those are guessable from 401 alone.
      const detail = await response.text().catch(() => '');
      throw new PipelineError(
        ERROR_CODES.TTS_GENERATION_FAILED,
        'generate-tts',
        `ElevenLabs returned ${response.status}: ${detail.slice(0, 400) || response.statusText}`,
        { status: response.status, voiceId },
      );
    }

    const payload = (await response.json()) as TimestampResponse;
    if (!payload.audio_base64) {
      throw new PipelineError(
        ERROR_CODES.TTS_EMPTY_AUDIO,
        'generate-tts',
        'ElevenLabs returned a response with no audio',
      );
    }
    return payload;
  }
}

/**
 * Character spans to word timings.
 *
 * Whitespace ends a word and belongs to no word; everything else - letters and
 * the punctuation stuck to them - is part of one. That is what makes these
 * timings carry "midnight," rather than "midnight", which is the whole reason
 * the subtitles read as prose.
 */
export function wordsFromAlignment(alignment: Alignment, offsetMs: number): WordTiming[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } =
    alignment;

  const words: WordTiming[] = [];
  let text = '';
  let fromMs = 0;
  let toMs = 0;

  const flush = () => {
    if (!text.trim()) {
      text = '';
      return;
    }
    words.push({ text, fromMs: offsetMs + fromMs, toMs: offsetMs + toMs });
    text = '';
  };

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i]!;

    if (/\s/u.test(char)) {
      flush();
      continue;
    }

    if (!text) fromMs = (starts[i] ?? 0) * 1000;
    text += char;
    toMs = (ends[i] ?? starts[i] ?? 0) * 1000;
  }
  flush();

  return words;
}

/**
 * Splits a script that exceeds the per-request ceiling.
 *
 * Sentence boundaries only. Splitting mid-sentence would put a seam inside a
 * clause, where the two halves are read with different intonation and the join
 * is audible; between sentences the model was going to pause anyway.
 */
export function chunkText(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return [trimmed];

  const sentences = trimmed.split(/(?<=[.!?])\s+/u);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > maxChars) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

/**
 * Joins the parts into one mp3.
 *
 * Stream copy rather than re-encode: the parts come back from the same model at
 * the same bitrate, so there is nothing to gain from decoding them and a
 * generation of quality to lose. ffmpeg comes from Remotion, so no system
 * install is required - the same arrangement `ffprobe.ts` documents.
 */
async function concatenate(parts: readonly string[], outputPath: string): Promise<void> {
  if (parts.length === 1) {
    await exec('cp', [parts[0]!, outputPath]);
    return;
  }

  const listPath = `${outputPath}.parts.txt`;
  await writeFile(listPath, parts.map((p) => `file '${p.replace(/'/gu, "'\\''")}'`).join('\n'), 'utf8');

  const result = await exec(
    path.join(process.cwd(), 'node_modules', '.bin', 'remotion'),
    ['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath],
    { timeoutMs: 120_000 },
  );

  await rm(listPath, { force: true }).catch(() => {});

  if (result.code !== 0) {
    throw new PipelineError(
      ERROR_CODES.TTS_GENERATION_FAILED,
      'generate-tts',
      `Could not join the ${parts.length} audio parts: ${result.stderr.trim().slice(0, 300)}`,
    );
  }
}
