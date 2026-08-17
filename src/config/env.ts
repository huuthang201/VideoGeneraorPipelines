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

  TTS_PROVIDER: z.enum(['edge', 'mock']).default('edge'),
  TTS_VOICE: z.string().default('vi-VN-HoaiMyNeural'),
  TTS_RATE: z.string().default('+5%'),
  PYTHON_BIN: z.string().default('./.venv/bin/python3'),

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

  tts: { provider: 'edge' | 'mock'; voice: string; rate: string; pythonBin: string };
  ai: { provider: 'claude-code'; claudeBin: string; model: string };
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
      provider: env.TTS_PROVIDER,
      voice: env.TTS_VOICE,
      rate: env.TTS_RATE,
      pythonBin: path.resolve(env.PYTHON_BIN),
    },
    ai: { provider: env.AI_PROVIDER, claudeBin: env.CLAUDE_BIN, model: env.CLAUDE_MODEL },
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
    output: path.join(root, 'output'),
    infoJson: path.join(root, 'info.json'),
    storyboardJson: path.join(root, 'storyboard.json'),
    timelineJson: path.join(root, 'timeline.json'),
    jobJson: path.join(root, 'job.json'),
    videoMp4: path.join(root, 'output', 'video.mp4'),
    thumbnailJpg: path.join(root, 'output', 'thumbnail.jpg'),
    scriptTxt: path.join(root, 'output', 'script.txt'),
    captionsSrt: path.join(root, 'audio', 'captions.srt'),
    voiceMp3: path.join(root, 'audio', 'voice.mp3'),
  };
}

export type JobPaths = ReturnType<typeof jobPaths>;
