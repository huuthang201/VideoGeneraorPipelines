import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import { loadConfig, jobPaths } from '../../src/config/env';
import { MINIMUM_IMAGES } from '../../src/domain/project';
import { activateStoryboardVersion, listStoryboardVersions } from '../../src/pipeline/storyboard-store';
import { readLock } from '../../src/pipeline/lock';
import { countPreviewImages } from '../lib/projectStatus';
import { isRunning, runTracked } from '../lib/pipelineRunner';

const config = loadConfig();
export const storyboardRouter = Router({ mergeParams: true });

storyboardRouter.get<{ id: string }>('/versions', async (req, res) => {
  const paths = jobPaths(config.jobsDir, req.params.id);
  res.json(await listStoryboardVersions(paths));
});

/**
 * Fire-and-forget: the client follows progress over /api/events, the same
 * way "generate video" does, rather than blocking a request for the 1-2
 * minutes a real Claude call can take.
 */
storyboardRouter.post<{ id: string }>('/', async (req, res) => {
  const id = req.params.id;
  const paths = jobPaths(config.jobsDir, id);

  if (isRunning(id) || (await readLock(paths))) {
    return res.status(409).json({ error: 'Dự án đang chạy' });
  }

  const imageCount = await countPreviewImages(paths.preview);
  if (imageCount < MINIMUM_IMAGES) {
    return res.status(400).json({ error: `Cần ít nhất ${MINIMUM_IMAGES} ảnh đã xử lý trước khi tạo kịch bản` });
  }

  void runTracked(id, 'storyboard', ['generate-storyboard', id]);
  res.status(202).json({ started: true });
});

storyboardRouter.post<{ id: string; filename: string }>('/versions/:filename/activate', async (req, res) => {
  const paths = jobPaths(config.jobsDir, req.params.id);

  try {
    await activateStoryboardVersion(paths, req.params.filename);
    const raw = await readFile(paths.storyboardJson, 'utf8');
    res.json({ storyboard: JSON.parse(raw) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
