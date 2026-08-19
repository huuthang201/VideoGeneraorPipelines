import { readFile, rm, writeFile } from 'node:fs/promises';
import type { JobPaths } from '../config/env';

/**
 * `.lock` marks a job directory as currently being processed by some
 * `runPipeline()` call. It exists so a UI orchestrating several jobs at once
 * (or a person re-running a command while an earlier one is still going) can
 * tell a job is busy instead of racing another process on the same directory.
 * The pipeline itself does not read or enforce this file - it only writes and
 * removes it, on a best-effort basis, around its own run.
 */
export interface LockInfo {
  pid: number;
  startedAt: string;
}

export async function acquireLock(paths: JobPaths): Promise<void> {
  const info: LockInfo = { pid: process.pid, startedAt: new Date().toISOString() };
  await writeFile(paths.lockFile, JSON.stringify(info), 'utf8');
}

export async function releaseLock(paths: JobPaths): Promise<void> {
  await rm(paths.lockFile, { force: true });
}

export async function readLock(paths: JobPaths): Promise<LockInfo | null> {
  const raw = await readFile(paths.lockFile, 'utf8').catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LockInfo;
  } catch {
    return null;
  }
}
