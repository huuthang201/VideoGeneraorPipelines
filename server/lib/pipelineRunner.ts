import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { loadConfig, jobPaths } from '../../src/config/env';
import { readProjectSummary } from './projectStatus';
import { spawnCli } from './processRunner';

/**
 * Tracks any long-running CLI action the server itself started (generate the
 * video, generate the storyboard) so the UI can watch it live over SSE
 * instead of a request that just blocks for a minute or two with no feedback.
 * Short one-shot actions (prepare, suggest-brief) don't need this - the
 * caller just awaits `runCli` directly and the client shows an elapsed timer.
 */
const config = loadConfig();

export type TrackedKind = 'generate' | 'storyboard';

export const events = new EventEmitter();
events.setMaxListeners(50);

const running = new Set<string>();

export function isRunning(projectId: string): boolean {
  return running.has(projectId);
}

interface ProgressFile {
  renderedFrames: number;
  totalFrames: number;
  updatedAt: string;
}

async function readProgress(projectId: string): Promise<ProgressFile | null> {
  const paths = jobPaths(config.jobsDir, projectId);
  const raw = await readFile(paths.progressJson, 'utf8').catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProgressFile;
  } catch {
    return null;
  }
}

const DONE_MESSAGE: Record<TrackedKind, string> = {
  generate: 'Tạo video thành công',
  storyboard: 'Đã tạo kịch bản mới',
};

export function runTracked(
  projectId: string,
  kind: TrackedKind,
  args: string[],
): Promise<{ ok: boolean; message: string }> {
  if (running.has(projectId)) {
    return Promise.resolve({ ok: false, message: 'Dự án đang chạy rồi' });
  }
  running.add(projectId);

  return new Promise((resolve) => {
    const child = spawnCli(args);

    const poll = setInterval(() => {
      void readProjectSummary(config, projectId)
        .catch(() => null)
        .then(async (summary) => {
          if (!summary) return;
          // progress.json only means something while actually rendering -
          // outside that stage it may just be left over from a previous run.
          const progress = summary.status === 'RENDERING' ? await readProgress(projectId) : null;
          events.emit('update', { projectId, kind, summary, progress });
        });
    }, 1000);

    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });

    const finish = async (ok: boolean, message: string) => {
      clearInterval(poll);
      running.delete(projectId);
      const summary = await readProjectSummary(config, projectId).catch(() => null);
      events.emit('done', { projectId, kind, ok, message, summary });
      resolve({ ok, message });
    };

    child.on('close', (code) => {
      const ok = code === 0;
      const message = ok
        ? DONE_MESSAGE[kind]
        : stderr.trim().split('\n').slice(-3).join(' ') || `Thoát mã ${code}`;
      void finish(ok, message);
    });

    child.on('error', (err) => {
      void finish(false, err instanceof Error ? err.message : String(err));
    });
  });
}

export function runGenerate(
  projectId: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; message: string }> {
  const args = ['generate', projectId, '--no-publish'];
  if (opts.force) args.push('--force');
  return runTracked(projectId, 'generate', args);
}
