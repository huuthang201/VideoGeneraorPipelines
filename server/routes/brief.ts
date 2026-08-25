import { readFile, writeFile } from 'node:fs/promises';
import { Router } from 'express';
import type { ModuleContext } from '../lib/moduleContext';
import { jobPaths, type AppConfig } from '../../src/config/env';
import { runCli } from '../lib/processRunner';
import { readProjectMeta } from '../lib/projectMeta';

/**
 * One router per module.
 *
 * A factory rather than a singleton because the server hosts both pipelines at
 * once, and each needs its own `config` - different job directory, different
 * cache, different YouTube credentials. Mounting the same instance under both
 * prefixes would have given whichever module loaded first to both.
 */
export function createBriefRouter(ctx: ModuleContext) {
  const { config, module } = ctx;
  const router = Router({ mergeParams: true });

router.put<{ id: string }>('/', async (req, res) => {
  /*
   * Validated by the module, not by one shared schema.
   *
   * The two briefs are `strictObject` and genuinely incompatible - one asks for
   * a length in minutes and names the backdrops the episode may use, the other
   * asks for seconds - so a podcast brief posted to a fact URL has to be
   * rejected here rather than written to disk and discovered at render time.
   */
  let brief: unknown;
  try {
    brief = module.parseBrief(req.body);
  } catch {
    return res.status(400).json({ error: 'Dữ liệu bối cảnh/hook không hợp lệ' });
  }

  const paths = jobPaths(config.jobsDir, req.params.id);
  await writeFile(paths.briefJson, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
  res.json(brief);
});

router.post<{ id: string }>('/suggest', async (req, res) => {
  const id = req.params.id;
  const paths = jobPaths(config.jobsDir, id);

  /*
   * The display name, not the id.
   *
   * They differ in exactly the way that matters here: the id is a slug, so
   * "con chuột" is stored as "con-chuot" and the tones are gone. Vietnamese
   * without diacritics is still readable, but the name is what the user
   * actually typed and the server is the only layer that still has it.
   */
  const meta = await readProjectMeta(paths.root, id);
  const result = await runCli(module.id, ['suggest-brief', id, '--topic', meta.displayName]);
  if (result.code !== 0) {
    return res
      .status(500)
      .json({ error: result.stderr.trim() || result.stdout.slice(-500) || 'Gợi ý thất bại' });
  }

  const raw = await readFile(paths.briefJson, 'utf8').catch(() => null);
  res.json(raw ? JSON.parse(raw) : null);
});

  return router;
}
