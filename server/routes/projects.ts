import path from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Router } from 'express';
import type { ModuleContext } from '../lib/moduleContext';
import { jobPaths, type AppConfig } from '../../src/config/env';
import { listStoryboardVersions } from '../../src/pipeline/storyboard-store';
import { readLock } from '../../src/pipeline/lock';
import { exists, listProjectIds, readProjectSummary } from '../lib/projectStatus';
import { PENDING_TOPIC_NAME, readProjectMeta, writeProjectMeta } from '../lib/projectMeta';
import { storedChannel } from '../../src/publish/youtube';
import { isValidProjectId, slugify, uniqueProjectId } from '../lib/slug';
import { runAuto } from '../lib/pipelineRunner';
import { parseBriefWithSources } from '../lib/briefSources';


/**
 * The first line of a prompt, short enough to be a project's name for the minute
 * before the brief step gives it a real one.
 */
function firstLine(text: string): string {
  const line = text.split(/\r?\n/u).find((l) => l.trim())?.trim() ?? text.trim();
  const withoutLinks = line.replace(/https?:\/\/\S+/gu, '').replace(/\s+/gu, ' ').trim();
  const base = withoutLinks || line;
  return base.length > 70 ? `${base.slice(0, 70).trimEnd()}…` : base;
}

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

  const [summary, briefRaw, storyboardRaw, versions, publishRaw, uploadRaw, channel] =
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
  });
});

/**
 * A project is a name, a brief and a storyboard - no images of its own. The
 * components come from the shared libraries, so there is nothing to upload
 * here; what a project cannot do is generate while those libraries are empty.
 */
router.post('/', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

  /*
   * Two ways in, and the difference is who chooses the subject.
   *
   * Named: somebody has a subject in mind and types it. The name steers both
   * the suggestion and the script, so it is required.
   *
   * Auto: somebody wants a video and has no particular one in mind, so the
   * whole pipeline starts here and its first step is choosing the subject.
   * That is not an extra capability - `runAuto` has always drafted a brief for
   * a project that has none - it is the same run, reached from the button that
   * created the project instead of from a second button afterwards.
   *
   * The response goes out before the run does. A pipeline takes minutes, and a
   * create dialog that waits for it reads as a hung app; the row of boxes on
   * the project's own card is where a run is meant to be watched.
   */
  const auto = req.body?.mode === 'auto';

  /*
   * A third way in: a prompt.
   *
   * Somebody who has more to say than a title - a description of the video
   * they want, and the pages it should be built from - writes it as one block
   * of text. It becomes the brief directly, so the pipeline starts from their
   * words instead of from a suggestion Claude drafts off a name, and it starts
   * immediately: a prompt is a complete instruction, and a person who has just
   * written one is not waiting to fill in anything else.
   *
   * The name is optional here because the prompt already says what the video
   * is. Its first line stands in until the brief step renames the project from
   * the hook, the same as it does for an auto project.
   */
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const fromPrompt = !auto && prompt.length > 0;

  if (!auto && !fromPrompt && !name) return res.status(400).json({ error: 'Thiếu tên dự án' });

  const displayName = name || (fromPrompt ? firstLine(prompt) : '');
  const id = await uniqueProjectId(config, auto ? 'du-an' : slugify(displayName));
  await mkdir(jobPaths(config.jobsDir, id).root, { recursive: true });
  await writeProjectMeta(jobPaths(config.jobsDir, id).root, {
    // Says what is happening rather than naming a subject nobody has chosen
    // yet. The pipeline's brief step replaces it with the subject Claude picks.
    displayName: auto ? PENDING_TOPIC_NAME : displayName,
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

  if (fromPrompt) {
    const written = await writePromptBrief(id, prompt);
    if (!written) {
      return res.status(400).json({ error: 'Prompt không hợp lệ cho loại video này' });
    }
  }

  const summary = await readProjectSummary(config, id);
  res.status(201).json(summary);

  // After the response: the screen gets its project immediately and watches
  // the run - and the name it settles on - arrive over the event stream.
  // `runAuto` sees the brief already on disk and uses it rather than drafting
  // one - "a missing brief is drafted, never overwritten".
  if (auto || fromPrompt) void runAuto(module.id, id);
});

/**
 * Writes a prompt as this project's brief.
 *
 * The whole prompt goes into `context`, links and all: it is what the video is
 * about in the person's own words, and the research call is better off seeing
 * the links in the sentences that explain why they are there.
 *
 * The links are also pulled out into `sources`, for the modules whose brief has
 * that field - which is how the research call knows to read them first rather
 * than treating them as prose. Detected by asking the module's own schema
 * rather than by naming a module here: a brief that rejects `sources` simply
 * gets the prompt as context, and a module that grows the field later picks
 * this up without an edit.
 */
async function writePromptBrief(id: string, prompt: string): Promise<boolean> {
  const paths = jobPaths(config.jobsDir, id);
  try {
    const brief = parseBriefWithSources(module, { context: prompt });
    await writeFile(paths.briefJson, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

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

/**
 * Deletes several projects, and reports what it would not touch.
 *
 * A route rather than the interface calling `DELETE /:id` in a loop, for one
 * reason: the answer is per-project. A project that is mid-render is locked and
 * must be left alone, and a loop on the client turns that into one refused
 * request among nine silent successes - so the person sees a toast saying it
 * worked and finds the project still there.
 *
 * What it deliberately does **not** do is touch `de-tai.json`. The topic ledger
 * outliving its project is the entire reason that file exists: the video may be
 * on YouTube, the channel has demonstrably covered the subject, and forgetting
 * it here is how the next suggestion proposes it again. Deleting a project frees
 * the disk, not the idea.
 *
 * Nor does it unpublish anything. A project whose video is already on YouTube
 * loses its local files and keeps its upload, which is why the interface says so
 * before asking.
 */
router.post('/bulk-delete', async (req, res) => {
  const body = req.body as { projectIds?: unknown };
  const ids = Array.isArray(body.projectIds)
    ? body.projectIds.filter((id): id is string => typeof id === 'string' && isValidProjectId(id))
    : [];

  if (ids.length === 0) return res.status(400).json({ error: 'Chưa chọn dự án hợp lệ nào' });

  const deleted: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const id of ids) {
    const paths = jobPaths(config.jobsDir, id);

    if (!(await exists(paths.root))) {
      skipped.push({ id, reason: 'không còn trên đĩa' });
      continue;
    }
    if (await readLock(paths)) {
      skipped.push({ id, reason: 'đang chạy' });
      continue;
    }

    try {
      await rm(paths.root, { recursive: true, force: true });
      deleted.push(id);
    } catch (err) {
      skipped.push({ id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  res.json({ deleted: deleted.length, deletedIds: deleted, skipped });
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
