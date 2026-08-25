import { Router } from 'express';
import type { ModuleContext } from '../lib/moduleContext';
import { events, isRunning, runAuto } from '../lib/pipelineRunner';
import { isValidProjectId } from '../lib/slug';

/**
 * One router per module.
 *
 * A factory rather than a singleton because the server hosts both pipelines at
 * once, and each needs its own `config` - different job directory, different
 * cache, different YouTube credentials. Mounting the same instance under both
 * prefixes would have given whichever module loaded first to both.
 */
export function createBatchRouter(ctx: ModuleContext) {
  const { config, module } = ctx;
  const router = Router();

interface BatchBody {
  projectIds?: unknown;
  mode?: unknown;
  concurrency?: unknown;
  force?: unknown;
}

router.post('/', (req, res) => {
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
  const runnable = projectIds.filter((id) => !isRunning(module.id, id));

  res.status(202).json({ started: true, count: runnable.length, skipped: projectIds.length - runnable.length });

  void runBatch(runnable, mode, concurrency, force);
});

/**
 * A batch is the same full pipeline, several projects at a time.
 *
 * `runAuto` rather than `runGenerate`, so a batch behaves exactly like pressing
 * start on each project in turn - including drafting a brief for the ones that
 * have none. Anything else would make "run all" quietly skip the projects that
 * most needed the run.
 */
async function runBatch(
  projectIds: string[],
  mode: 'parallel' | 'sequential',
  concurrency: number,
  force: boolean,
): Promise<void> {
  const results: Array<{ projectId: string; ok: boolean; message: string }> = [];

  if (mode === 'sequential') {
    for (const id of projectIds) {
      results.push({ projectId: id, ...(await runAuto(module.id, id, { force })) });
    }
  } else {
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const id = projectIds[cursor];
        cursor += 1;
        if (id === undefined) return;
        results.push({ projectId: id, ...(await runAuto(module.id, id, { force })) });
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  }

  const succeeded = results.filter((r) => r.ok).length;
  events.emit('batch-done', {
    module: module.id,
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  });
}

  return router;
}
