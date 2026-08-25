import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import type { ModuleContext } from '../lib/moduleContext';
import { jobPaths, type AppConfig } from '../../src/config/env';

import { activateStoryboardVersion, listStoryboardVersions } from '../../src/pipeline/storyboard-store';
import { readLock } from '../../src/pipeline/lock';
import { isRunning, runTracked } from '../lib/pipelineRunner';

/**
 * One router per module.
 *
 * A factory rather than a singleton because the server hosts both pipelines at
 * once, and each needs its own `config` - different job directory, different
 * cache, different YouTube credentials. Mounting the same instance under both
 * prefixes would have given whichever module loaded first to both.
 */
export function createStoryboardRouter(ctx: ModuleContext) {
  const { config, module } = ctx;
  const router = Router({ mergeParams: true });

router.get<{ id: string }>('/versions', async (req, res) => {
  const paths = jobPaths(config.jobsDir, req.params.id);
  res.json(await listStoryboardVersions(paths));
});

/**
 * Fire-and-forget: the client follows progress over /api/events, the same way
 * "generate video" does, rather than blocking a request for the several minutes
 * writing a full script takes.
 */
router.post<{ id: string }>('/', async (req, res) => {
  const id = req.params.id;
  const paths = jobPaths(config.jobsDir, id);

  if (isRunning(module.id, id) || (await readLock(paths))) {
    return res.status(409).json({ error: 'Dự án đang chạy' });
  }

  void runTracked(module.id, id, 'storyboard', ['generate-storyboard', id]);
  res.status(202).json({ started: true });
});

router.post<{ id: string; filename: string }>('/versions/:filename/activate', async (req, res) => {
  const paths = jobPaths(config.jobsDir, req.params.id);

  try {
    await activateStoryboardVersion(paths, req.params.filename);
    const raw = await readFile(paths.storyboardJson, 'utf8');
    res.json({ storyboard: JSON.parse(raw) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

  return router;
}
