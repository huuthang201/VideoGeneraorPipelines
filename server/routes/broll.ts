import { Router } from 'express';
import { loadConfig, jobPaths } from '../../src/config/env';
import { readManifest, deleteBrollImage } from '../../src/cli/generate-broll';
import { readLock } from '../../src/pipeline/lock';
import { runCli } from '../lib/processRunner';
import { exists } from '../lib/projectStatus';

const config = loadConfig();
export const brollRouter = Router({ mergeParams: true });

/** Generating more than this in one go is a mistake, not a request. */
const MAX_PER_REQUEST = 6;

brollRouter.get<{ id: string }>('/', async (req, res) => {
  const paths = jobPaths(config.jobsDir, req.params.id);
  res.json(await readManifest(paths.generated));
});

brollRouter.post<{ id: string }>('/', async (req, res) => {
  const id = req.params.id;
  const paths = jobPaths(config.jobsDir, id);

  if (!(await exists(paths.root))) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  if (await readLock(paths)) return res.status(409).json({ error: 'Dự án đang chạy' });

  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  if (!description) return res.status(400).json({ error: 'Cần mô tả video để sinh ảnh' });

  const requested = Number.parseInt(String(req.body?.count ?? 3), 10);
  const count = Math.max(1, Math.min(MAX_PER_REQUEST, Number.isFinite(requested) ? requested : 3));

  // Each image is roughly a minute, so the ceiling here is generous rather than
  // tight; the request is held open for the whole run.
  const result = await runCli(['generate-broll', id, '--description', description, '--count', String(count)]);

  if (result.code !== 0) {
    return res.status(500).json({
      error: result.stderr.trim() || result.stdout.slice(-600) || 'Sinh ảnh thất bại',
    });
  }

  res.json(await readManifest(paths.generated));
});

brollRouter.delete<{ id: string; filename: string }>('/:filename', async (req, res) => {
  const { id, filename } = req.params;
  if (!/^broll-[\w-]+\.jpg$/i.test(filename)) return res.status(400).json({ error: 'Tên file không hợp lệ' });

  const paths = jobPaths(config.jobsDir, id);
  if (await readLock(paths)) return res.status(409).json({ error: 'Dự án đang chạy' });

  await deleteBrollImage(paths.generated, filename);
  res.json(await readManifest(paths.generated));
});
