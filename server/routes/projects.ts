import path from 'node:path';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { Router } from 'express';
import type { ModuleContext } from '../lib/moduleContext';
import { jobPaths, type AppConfig } from '../../src/config/env';
import { listStoryboardVersions } from '../../src/pipeline/storyboard-store';
import { readLock } from '../../src/pipeline/lock';
import { exists, listProjectIds, readProjectSummary } from '../lib/projectStatus';
import { readLibrarySummary } from '../lib/librarySummary';
import { readProjectMeta, writeProjectMeta } from '../lib/projectMeta';
import { storedChannel } from '../../src/publish/youtube';
import { isValidProjectId, slugify, uniqueProjectId } from '../lib/slug';


/**
 * One router per module.
 *
 * A factory rather than a singleton because the server hosts both pipelines at
 * once, and each needs its own `config` - different job directory, different
 * cache, different YouTube credentials. Mounting the same instance under both
 * prefixes would have given whichever module loaded first to both.
 */
export function createProjectsRouter(ctx: ModuleContext) {
  const { config, module } = ctx;
  const router = Router();

router.get('/', async (_req, res) => {
  const ids = await listProjectIds(config);
  const summaries = await Promise.all(ids.map((id) => readProjectSummary(config, id)));
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(summaries);
});

router.get<{ id: string }>('/:id', async (req, res) => {
  const id = req.params.id;
  if (!isValidProjectId(id)) return res.status(400).json({ error: 'Id dự án không hợp lệ' });

  const paths = jobPaths(config.jobsDir, id);
  if (!(await exists(paths.root))) return res.status(404).json({ error: 'Không tìm thấy dự án' });

  const [summary, briefRaw, storyboardRaw, versions, publishRaw, uploadRaw, channel, library] =
    await Promise.all([
    readProjectSummary(config, id),
    readFile(paths.briefJson, 'utf8').catch(() => null),
    readFile(paths.storyboardJson, 'utf8').catch(() => null),
    listStoryboardVersions(paths),
    // Written by the pipeline after a successful render; absent until then.
    readFile(path.join(paths.output, 'youtube.json'), 'utf8').catch(() => null),
    readFile(path.join(paths.output, 'youtube-upload.json'), 'utf8').catch(() => null),
    // Recorded at consent time, so naming the channel costs no API call.
    storedChannel({
      clientId: config.youtube.clientId,
      clientSecret: config.youtube.clientSecret,
      tokenPath: config.youtube.tokenPath,
    }).catch(() => null),
    /*
     * The shared library, echoed here so the project screen can draw its
     * backdrop picker - and refuse to generate when there is nothing - without
     * a second request. The project owns none of it.
     *
     * Podcast only: the fact module searches for its photographs, so there is
     * no library to pick from and the field is absent rather than empty.
     */
    module.id === 'podcast' ? readLibrarySummary(config).catch(() => null) : Promise.resolve(null),
  ]);

  res.json({
    ...summary,
    brief: briefRaw ? JSON.parse(briefRaw) : null,
    publish: publishRaw ? JSON.parse(publishRaw) : null,
    upload: uploadRaw ? JSON.parse(uploadRaw) : null,
    // The button is pointless without credentials, and saying so on the screen
    // beats a 400 after the click.
    youtubeReady: Boolean(config.youtube.clientId && config.youtube.clientSecret),
    youtubeChannel: channel,
    storyboard: storyboardRaw ? JSON.parse(storyboardRaw) : null,
    versions,
    /*
     * What VIDEO_TARGET_DURATION is set to, so the length box can show a real
     * number instead of an empty field with a placeholder explaining where the
     * number would have come from. The page has no other way to know it - it is
     * server configuration, and there is no build step to bake it in.
     */
    defaultTargetSeconds: config.video.targetDuration,
    ...(library ? { library } : {}),
  });
});

/**
 * A project is a name, a brief and a storyboard - no images of its own. The
 * components come from the shared libraries, so there is nothing to upload
 * here; what a project cannot do is generate while those libraries are empty.
 */
router.post('/', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Thiếu tên dự án' });

  const id = await uniqueProjectId(config, slugify(name));
  await mkdir(jobPaths(config.jobsDir, id).root, { recursive: true });
  await writeProjectMeta(jobPaths(config.jobsDir, id).root, {
    displayName: name,
    createdAt: new Date().toISOString(),
    /*
     * Scheduled, matching `readProjectMeta`'s own fallback.
     *
     * These two disagreed, and the create path won: every project made through
     * the UI was written as `none` while a project with no meta.json at all
     * defaulted to `schedule`. The effect was that the tool's whole purpose -
     * a queue that publishes on its own cadence - was off by default, and
     * every project needed the same click before it did the thing it was for.
     */
    autoPublish: 'schedule',
  });

  res.status(201).json(await readProjectSummary(config, id));
});

/**
 * What should happen when this project finishes rendering.
 *
 * Its own route rather than part of the brief: the brief describes the video
 * and is read by the engine, while this is a workflow choice the UI acts on
 * afterwards.
 */
router.put<{ id: string }>('/:id/auto-publish', async (req, res) => {
  const id = req.params.id;
  if (!isValidProjectId(id)) return res.status(400).json({ error: 'Id dự án không hợp lệ' });

  /*
   * `autoPublish`, not `mode`.
   *
   * This route read `mode` while the only caller had always sent
   * `autoPublish`, so every change to the dropdown was answered with a 400 and
   * nothing was ever saved. It went unnoticed because the call had no error
   * branch at all: the rejection went to the console and the control carried on
   * showing the value it had failed to store. Naming the field after the thing
   * it sets is also what stops that drifting apart again.
   */
  const autoPublish = req.body?.autoPublish;
  if (autoPublish !== 'none' && autoPublish !== 'now' && autoPublish !== 'schedule') {
    return res.status(400).json({ error: 'Giá trị không hợp lệ' });
  }

  const paths = jobPaths(config.jobsDir, id);
  const meta = await readProjectMeta(paths.root, id);
  await writeProjectMeta(paths.root, { ...meta, autoPublish });

  res.json(await readProjectSummary(config, id));
});

router.delete<{ id: string }>('/:id', async (req, res) => {
  const id = req.params.id;
  if (!isValidProjectId(id)) return res.status(400).json({ error: 'Id dự án không hợp lệ' });

  const paths = jobPaths(config.jobsDir, id);
  if (await readLock(paths)) return res.status(409).json({ error: 'Dự án đang chạy, không thể xoá' });

  await rm(paths.root, { recursive: true, force: true });
  res.status(204).end();
});

  return router;
}
