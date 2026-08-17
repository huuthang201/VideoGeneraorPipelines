import { z } from 'zod';
import { ERROR_CODES } from './errors';

/**
 * job.json (spec §48-49). With no database in V1, this file *is* the job state.
 *
 * It also carries the input hash, which is what makes re-runs idempotent and
 * lets the cache skip a Claude call when nothing about the input changed
 * (spec §54, §34).
 */
export const JOB_STATUSES = [
  'PENDING',
  'DOWNLOADING',
  'VALIDATING',
  'ANALYZING',
  'STORYBOARD_READY',
  'TTS_GENERATING',
  'IMAGE_PROCESSING',
  'RENDERING',
  'VALIDATING_OUTPUT',
  'UPLOADING',
  'DONE',
  'FAILED',
] as const;

export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobErrorSchema = z.strictObject({
  stage: z.string(),
  code: z.enum(Object.values(ERROR_CODES) as [string, ...string[]]),
  message: z.string(),
  timestamp: z.string(),
});

export const JobSchema = z.strictObject({
  projectId: z.string().min(1),
  status: JobStatusSchema,
  stage: z.string(),
  createdAt: z.string(),
  completedAt: z.string().nullable().default(null),
  durationSeconds: z.number().nonnegative().nullable().default(null),
  voice: z.string().nullable().default(null),
  scenes: z.number().int().nonnegative().nullable().default(null),
  /**
   * True when the narration came from MockTTSProvider rather than a real voice.
   * Stamped so a placeholder render can never be mistaken for a publishable
   * video - see plan §2.3.
   */
  devMock: z.boolean().default(false),
  inputHash: z.string().nullable().default(null),
  error: JobErrorSchema.nullable().default(null),
});

export type Job = z.infer<typeof JobSchema>;

export function createJob(projectId: string): Job {
  return {
    projectId,
    status: 'PENDING',
    stage: 'pending',
    createdAt: new Date().toISOString(),
    completedAt: null,
    durationSeconds: null,
    voice: null,
    scenes: null,
    devMock: false,
    inputHash: null,
    error: null,
  };
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'DONE' || status === 'FAILED';
}
