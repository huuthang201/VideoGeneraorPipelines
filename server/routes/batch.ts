import { Router } from 'express';
import { events, isRunning, runGenerate } from '../lib/pipelineRunner';
import { isValidProjectId } from '../lib/slug';

export const batchRouter = Router();

interface BatchBody {
  projectIds?: unknown;
  mode?: unknown;
  concurrency?: unknown;
  force?: unknown;
}

batchRouter.post('/', (req, res) => {
  const body = req.body as BatchBody;
  const projectIds = Array.isArray(body.projectIds)
    ? body.projectIds.filter((id): id is string => typeof id === 'string' && isValidProjectId(id))
    : [];

  if (projectIds.length === 0) {
    return res.status(400).json({ error: 'Chưa chọn dự án hợp lệ nào' });
  }

  const mode = body.mode === 'parallel' ? 'parallel' : 'sequential';
  const concurrency = Math.max(1, Math.min(Number(body.concurrency) || 2, projectIds.length));
  const force = body.force === true;
  const runnable = projectIds.filter((id) => !isRunning(id));

  res.status(202).json({ started: true, count: runnable.length, skipped: projectIds.length - runnable.length });

  void runBatch(runnable, mode, concurrency, force);
});

async function runBatch(
  projectIds: string[],
  mode: 'parallel' | 'sequential',
  concurrency: number,
  force: boolean,
): Promise<void> {
  const results: Array<{ projectId: string; ok: boolean; message: string }> = [];

  if (mode === 'sequential') {
    for (const id of projectIds) {
      results.push({ projectId: id, ...(await runGenerate(id, { force })) });
    }
  } else {
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const id = projectIds[cursor];
        cursor += 1;
        if (id === undefined) return;
        results.push({ projectId: id, ...(await runGenerate(id, { force })) });
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  }

  const succeeded = results.filter((r) => r.ok).length;
  events.emit('batch-done', { total: results.length, succeeded, failed: results.length - succeeded, results });
}
