import { Router } from 'express';
import { loadConfig, jobPaths } from '../../src/config/env';
import { readLock } from '../../src/pipeline/lock';
import { isRunning, runGenerate } from '../lib/pipelineRunner';

const config = loadConfig();
export const pipelineRouter = Router({ mergeParams: true });

pipelineRouter.post<{ id: string }>('/generate', async (req, res) => {
  const id = req.params.id;
  const force = req.body?.force === true;
  const paths = jobPaths(config.jobsDir, id);

  if (isRunning(id) || (await readLock(paths))) {
    return res.status(409).json({ error: 'Dự án đang chạy' });
  }

  // Fire and forget: the client follows progress over /api/events.
  void runGenerate(id, { force });
  res.status(202).json({ started: true });
});
