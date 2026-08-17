import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { JobSchema, createJob, type Job, type JobStatus } from '../domain/job';
import type { JobPaths } from '../config/env';

/**
 * job.json read/write (spec §45, §49).
 *
 * With no database in V1 this file is the state. Spec §45 offers a choice
 * between physically moving folders between 01_INPUT/02_PROCESSING and marking
 * state in job.json; marking is what this implements. Moving a folder that
 * holds the only copy of the source photos, while Drive may be syncing it, puts
 * user data at risk for a status indicator - and a crash mid-move leaves the
 * input stranded somewhere neither stage expects.
 */

export async function readJob(paths: JobPaths): Promise<Job | null> {
  const raw = await readFile(paths.jobJson, 'utf8').catch(() => null);
  if (raw === null) return null;

  try {
    return JobSchema.parse(JSON.parse(raw));
  } catch {
    // A corrupt job file must not wedge a project permanently - treat it as
    // absent so the next run rebuilds it.
    return null;
  }
}

export async function writeJob(paths: JobPaths, job: Job): Promise<void> {
  await mkdir(path.dirname(paths.jobJson), { recursive: true });
  await writeFile(paths.jobJson, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
}

export async function loadOrCreateJob(paths: JobPaths, projectId: string): Promise<Job> {
  return (await readJob(paths)) ?? createJob(projectId);
}

export async function updateJob(
  paths: JobPaths,
  job: Job,
  patch: Partial<Job> & { status?: JobStatus },
): Promise<Job> {
  const next: Job = { ...job, ...patch };
  await writeJob(paths, next);
  return next;
}

export async function markFailed(
  paths: JobPaths,
  job: Job,
  error: { stage: string; code: string; message: string },
): Promise<Job> {
  return updateJob(paths, job, {
    status: 'FAILED',
    stage: error.stage,
    error: { ...error, timestamp: new Date().toISOString() },
  });
}

/**
 * Fingerprint of everything that should force a rebuild.
 *
 * Used for both idempotency (spec §34) and cache lookups (spec §54): if this is
 * unchanged and the output exists, there is nothing to do and - importantly -
 * no reason to spend a Claude call.
 */
export async function computeInputHash(input: {
  imagePaths: readonly string[];
  infoJson: string | null;
  storyboardJson: string | null;
  /** Bump when prompt or pipeline changes should invalidate prior output. */
  pipelineVersion: string;
}): Promise<string> {
  const hash = createHash('sha256');
  hash.update(input.pipelineVersion);

  for (const filePath of [...input.imagePaths].sort()) {
    hash.update(path.basename(filePath));
    const content = await readFile(filePath).catch(() => Buffer.alloc(0));
    hash.update(content);
  }

  hash.update(input.infoJson ?? '');
  hash.update(input.storyboardJson ?? '');

  return `sha256:${hash.digest('hex')}`;
}

/**
 * Whether a completed job can be reused (spec §34).
 *
 * Both conditions matter: a DONE status with different inputs is stale, and
 * matching inputs with no output file means the video was deleted or the run
 * died after writing state.
 */
export function canSkip(job: Job | null, currentHash: string, outputExists: boolean): boolean {
  if (!job) return false;
  if (job.status !== 'DONE') return false;
  if (!outputExists) return false;
  return job.inputHash === currentHash;
}
