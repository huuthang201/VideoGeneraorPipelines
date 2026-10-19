import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { concatAudio } from '../video/ffmpeg';
import { getDurationSeconds } from '../video/ffprobe';
import { ERROR_CODES, PipelineError } from '../domain/errors';
import type { Logger } from '../utils/logger';
import type { TTSProvider, WordTiming } from './types';

/**
 * A script spoken by more than one voice.
 *
 * Every other pipeline here sends the whole narration in a single call, which
 * is why `ttsTimeoutMs` is documented as "one call carries the whole script".
 * A conversation cannot work that way: a synthesiser is given one voice, and
 * four characters means four voices, so the unit of synthesis has to become the
 * *line* rather than the script.
 *
 * Everything downstream still receives exactly what it received before - one
 * audio file, one duration, one flat list of word timings - because the
 * timeline, the captions and the validator have no business knowing how many
 * calls it took. The joining happens here and stops here.
 *
 * ## Why the timings are offset rather than re-measured
 *
 * Each line comes back with timings relative to its own file, starting at zero.
 * Laid end to end, line three's words are wrong by the length of lines one and
 * two - so each line's words are shifted by the running total *of the measured
 * audio*, never of the estimate. That is the same rule the timeline follows,
 * and for the same reason: an estimate that drifts by 200ms a line is a
 * subtitle a second late by the end.
 */

export interface DialogueLine {
  /** Scene id, for error messages that name the line that failed. */
  id: string;
  text: string;
  /** This character's fixed voice. See the module's `voiceForScene`. */
  voice: string;
}

export interface DialogueResult {
  audioPath: string;
  duration: number;
  words: WordTiming[];
  /** Which voices actually spoke, in first-heard order. For the log line. */
  voices: string[];
}

export async function synthesizeDialogue(input: {
  provider: TTSProvider;
  lines: readonly DialogueLine[];
  language: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  /** Where voice.mp3 lands. Per-line files go in a scratch dir beneath it. */
  outDir: string;
  outputPath: string;
  logger: Logger;
}): Promise<DialogueResult> {
  const spoken = input.lines.filter((l) => l.text.trim());
  if (spoken.length === 0) {
    throw new PipelineError(
      ERROR_CODES.TTS_GENERATION_FAILED,
      'generate-tts',
      'The script has no spoken lines. Narration is mandatory.',
    );
  }

  const scratch = path.join(input.outDir, 'lines');
  await rm(scratch, { recursive: true, force: true });

  const parts: string[] = [];
  const words: WordTiming[] = [];
  const voices: string[] = [];
  let offsetMs = 0;

  for (const [index, line] of spoken.entries()) {
    // One directory per line: the provider writes a fixed filename, so sharing
    // a directory would mean each line silently overwriting the last.
    const lineDir = path.join(scratch, String(index).padStart(2, '0'));
    await mkdir(lineDir, { recursive: true });

    const result = await input.provider
      .synthesize({
        text: line.text,
        language: input.language,
        voice: line.voice,
        rate: input.rate,
        pitch: input.pitch,
        volume: input.volume,
        outDir: lineDir,
      })
      .catch((err) => {
        throw new PipelineError(
          ERROR_CODES.TTS_GENERATION_FAILED,
          'generate-tts',
          `Could not speak line "${line.id}" as ${line.voice}: ` +
            (err instanceof Error ? err.message : String(err)),
          undefined,
          { cause: err },
        );
      });

    // The provider's own duration is trusted for the audio but not for the
    // offset: what matters downstream is where this file really ends, and only
    // ffprobe knows that once it is on disk.
    const measured = await getDurationSeconds(result.audioPath);

    for (const word of result.words) {
      words.push({ ...word, fromMs: word.fromMs + offsetMs, toMs: word.toMs + offsetMs });
    }

    offsetMs += Math.round(measured * 1000);
    parts.push(result.audioPath);
    if (!voices.includes(line.voice)) voices.push(line.voice);
  }

  await concatAudio({ sources: parts, outputPath: input.outputPath });
  const duration = await getDurationSeconds(input.outputPath);

  // The per-line files have served their purpose and are several megabytes of
  // duplication inside a job folder that is already large.
  await rm(scratch, { recursive: true, force: true });

  input.logger.step(
    `${spoken.length} lượt thoại, ${voices.length} giọng (${voices.join(', ')}), ` +
      `${duration.toFixed(2)}s`,
  );

  return { audioPath: input.outputPath, duration, words, voices };
}
