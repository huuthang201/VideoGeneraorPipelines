import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { StyleNameSchema } from '../domain/config';

/**
 * Runtime configuration, assembled from .env with typed defaults.
 *
 * Note what is absent: nothing here tells the engine where Google Drive is.
 * `DRIVE_ROOT` exists only for the Claude Code layer that moves files in and
 * out (spec §58); the engine itself never sees a path outside runtime/jobs,
 * which is what keeps it storage-agnostic (spec §50).
 */

loadDotenv({ quiet: true });

const EnvSchema = z.object({
  DRIVE_ROOT: z.string().default('./workspace/AI-Shorts'),

  /**
   * `vieneu` is the production engine (on-device, v3 Turbo). `edge` is kept as
   * a selectable fallback because it needs no model download and no Python
   * 3.10+, which makes it the only option on a machine where VieNeu will not
   * install. `mock` is silent audio for offline development.
   */
  TTS_ENGINE: z.enum(['vieneu', 'edge', 'mock']).default('vieneu'),
  TTS_VOICE: z.string().default('adam_vi'),
  /** Reference clip for a cloned voice. Empty means use a built-in preset. */
  TTS_REFERENCE_AUDIO: z.string().default('assets/voices/adam_vi.wav'),
  /** Python 3.10+ interpreter with `vieneu` installed. */
  VIENEU_PYTHON_BIN: z.string().default('./.venv-vieneu/bin/python3'),
  // Edge-only delivery controls; VieNeu takes its delivery from the voice.
  TTS_RATE: z.string().default('+15%'),
  TTS_PITCH: z.string().default('+25Hz'),
  PYTHON_BIN: z.string().default('./.venv/bin/python3'),

  /** `none` disables b-roll entirely; `comfyui` generates it locally. */
  IMAGE_ENGINE: z.enum(['comfyui', 'none']).default('none'),
  COMFYUI_SERVER: z.string().default('http://127.0.0.1:8188'),
  /**
   * Ceiling on the share of scenes that may be generated. Most of a product
   * video should be the actual product.
   */
  IMAGE_MAX_BROLL_RATIO: z.coerce.number().min(0).max(1).default(0.4),

  AI_PROVIDER: z.enum(['claude-code']).default('claude-code'),
  CLAUDE_BIN: z.string().default('claude'),
  CLAUDE_MODEL: z.string().default('sonnet'),

  VIDEO_WIDTH: z.coerce.number().int().positive().default(1080),
  VIDEO_HEIGHT: z.coerce.number().int().positive().default(1920),
  VIDEO_FPS: z.coerce.number().int().positive().default(30),
  VIDEO_STYLE: StyleNameSchema.default('tiktok-fast'),
  VIDEO_TARGET_DURATION: z.coerce.number().positive().default(25),
  VIDEO_DURATION_MIN: z.coerce.number().positive().default(15),
  VIDEO_DURATION_MAX: z.coerce.number().positive().default(35),

  FEATURE_REMOVE_BACKGROUND: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  FEATURE_AI_IMAGE_GENERATION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

export interface AppConfig {
  driveRoot: string;
  runtimeDir: string;
  jobsDir: string;

  tts: {
    engine: 'vieneu' | 'edge' | 'mock';
    voice: string;
    /** Absolute path to the reference clip, or null when using a preset. */
    referenceAudio: string | null;
    rate: string;
    pitch: string;
    pythonBin: string;
    vieneuPythonBin: string;
  };
  ai: { provider: 'claude-code'; claudeBin: string; model: string };
  image: { engine: 'comfyui' | 'none'; comfyuiServer: string; maxBrollRatio: number };
  video: {
    width: number;
    height: number;
    fps: number;
    style: import('../domain/config').StyleName;
    targetDuration: number;
    durationMin: number;
    durationMax: number;
  };
  features: { removeBackground: boolean; aiImageGeneration: boolean };
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  const parsed = EnvSchema.safeParse({ ...process.env, ...overrides });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  const env = parsed.data;
  const runtimeDir = path.resolve('runtime');

  return {
    driveRoot: path.resolve(env.DRIVE_ROOT),
    runtimeDir,
    jobsDir: path.join(runtimeDir, 'jobs'),

    tts: {
      engine: env.TTS_ENGINE,
      voice: env.TTS_VOICE,
      // Resolved here so nothing downstream depends on the working directory,
      // and so the same .env works on macOS, Linux and inside a container.
      referenceAudio: env.TTS_REFERENCE_AUDIO.trim()
        ? path.resolve(env.TTS_REFERENCE_AUDIO)
        : null,
      rate: env.TTS_RATE,
      pitch: env.TTS_PITCH,
      pythonBin: path.resolve(env.PYTHON_BIN),
      vieneuPythonBin: path.resolve(env.VIENEU_PYTHON_BIN),
    },
    ai: { provider: env.AI_PROVIDER, claudeBin: env.CLAUDE_BIN, model: env.CLAUDE_MODEL },
    image: {
      engine: env.IMAGE_ENGINE,
      comfyuiServer: env.COMFYUI_SERVER,
      maxBrollRatio: env.IMAGE_MAX_BROLL_RATIO,
    },
    video: {
      width: env.VIDEO_WIDTH,
      height: env.VIDEO_HEIGHT,
      fps: env.VIDEO_FPS,
      style: env.VIDEO_STYLE,
      targetDuration: env.VIDEO_TARGET_DURATION,
      durationMin: env.VIDEO_DURATION_MIN,
      durationMax: env.VIDEO_DURATION_MAX,
    },
    features: {
      removeBackground: env.FEATURE_REMOVE_BACKGROUND,
      aiImageGeneration: env.FEATURE_AI_IMAGE_GENERATION,
    },
    logLevel: env.LOG_LEVEL,
  };
}

/** Standard sub-paths inside a job directory (spec §41). */
export function jobPaths(jobsDir: string, projectId: string) {
  const root = path.join(jobsDir, projectId);
  return {
    root,
    source: path.join(root, 'source'),
    images: path.join(root, 'images'),
    preview: path.join(root, 'preview'),
    audio: path.join(root, 'audio'),
    generated: path.join(root, 'generated'),
    output: path.join(root, 'output'),
    infoJson: path.join(root, 'info.json'),
    briefJson: path.join(root, 'brief.json'),
    storyboardJson: path.join(root, 'storyboard.json'),
    storyboardVersions: path.join(root, 'storyboard-versions'),
    timelineJson: path.join(root, 'timeline.json'),
    jobJson: path.join(root, 'job.json'),
    progressJson: path.join(root, 'progress.json'),
    lockFile: path.join(root, '.lock'),
    videoMp4: path.join(root, 'output', 'video.mp4'),
    thumbnailJpg: path.join(root, 'output', 'thumbnail.jpg'),
    scriptTxt: path.join(root, 'output', 'script.txt'),
    captionsSrt: path.join(root, 'audio', 'captions.srt'),
    // VieNeu emits 48 kHz WAV natively; keeping it unconverted avoids a
    // resample the pipeline gains nothing from (spec §8).
    voiceWav: path.join(root, 'audio', 'voice.wav'),
    voiceMp3: path.join(root, 'audio', 'voice.mp3'),
  };
}

export type JobPaths = ReturnType<typeof jobPaths>;
