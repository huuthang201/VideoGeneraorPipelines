import { readFile, rm, writeFile } from 'node:fs/promises';
import type { JobPaths } from '../config/env';

/**
 * `.lock` marks a job directory as currently being processed by some
 * `runPipeline()` call. It exists so a UI orchestrating several jobs at once
 * (or a person re-running a command while an earlier one is still going) can
 * tell a job is busy instead of racing another process on the same directory.
 * The pipeline itself does not read or enforce this file - it only writes and
 * removes it, on a best-effort basis, around its own run.
 *
 * The pid in the file is not decoration: a run that is killed - the terminal
 * closed, the machine slept, the agent that started it torn down - never gets
 * to remove its own lock, and a lock nobody owns used to pin the project on
 * "đang tạo video" in the UI forever, with no button that would clear it. So a
 * lock is only believed while the process that wrote it is still alive.
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

  let info: LockInfo;
  try {
    info = JSON.parse(raw) as LockInfo;
  } catch {
    return null;
  }

  if (!isAlive(info.pid)) {
    // Swept rather than merely ignored, so the stale file does not sit there
    // being re-examined on every page load for the rest of the project's life.
    await rm(paths.lockFile, { force: true }).catch(() => {});
    return null;
  }

  return info;
}

/**
 * Whether a pid is still running.
 *
 * Signal 0 performs the permission and existence checks without delivering
 * anything, which is the standard way to ask this question. ESRCH means no such
 * process; EPERM means it exists but belongs to another user, which for our
 * purposes still counts as alive.
 */
function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
