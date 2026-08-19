import { readFile, writeFile } from 'node:fs/promises';
import { Router } from 'express';
import { loadConfig, jobPaths } from '../../src/config/env';
import { BriefSchema } from '../../src/domain/brief';
import { runCli } from '../lib/processRunner';

const config = loadConfig();
export const briefRouter = Router({ mergeParams: true });

briefRouter.put<{ id: string }>('/', async (req, res) => {
  const parsed = BriefSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Dữ liệu bối cảnh/hook không hợp lệ' });

  const paths = jobPaths(config.jobsDir, req.params.id);
  await writeFile(paths.briefJson, `${JSON.stringify(parsed.data, null, 2)}\n`, 'utf8');
  res.json(parsed.data);
});

briefRouter.post<{ id: string }>('/suggest', async (req, res) => {
  const id = req.params.id;
  const paths = jobPaths(config.jobsDir, id);

  const result = await runCli(['suggest-brief', id]);
  if (result.code !== 0) {
    return res
      .status(500)
      .json({ error: result.stderr.trim() || result.stdout.slice(-500) || 'Gợi ý thất bại' });
  }

  const raw = await readFile(paths.briefJson, 'utf8').catch(() => null);
  res.json(raw ? JSON.parse(raw) : null);
});
