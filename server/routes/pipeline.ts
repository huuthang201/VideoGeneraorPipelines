import path from 'node:path';
import { access } from 'node:fs/promises';
import { Router } from 'express';
import type { ModuleContext } from '../lib/moduleContext';
import { jobPaths, type AppConfig } from '../../src/config/env';
import { readLock } from '../../src/pipeline/lock';
import {
  isRunning,
  readLog,
  readRunState,
  runAuto,
  runGenerate,
  runUpload,
} from '../lib/pipelineRunner';
import { readStepDetail } from '../lib/stepDetail';
import { STEP_IDS, type StepId } from '../lib/runState';

/**
 * One router per module.
 *
 * A factory rather than a singleton because the server hosts both pipelines at
 * once, and each needs its own `config` - different job directory, different
 * cache, different YouTube credentials. Mounting the same instance under both
 * prefixes would have given whichever module loaded first to both.
 */
export function createPipelineRouter(ctx: ModuleContext) {
  const { config, module } = ctx;
  const router = Router({ mergeParams: true });

/**
 * The whole pipeline from one button.
 *
 * Everything `generate` does, plus drafting a brief first when the project has
 * none, plus the upload the project was already configured for. See `runAuto`.
 */
router.post<{ id: string }>('/start', async (req, res) => {
  const id = req.params.id;
  const force = req.body?.force === true;
  const paths = jobPaths(config.jobsDir, id);

  if (isRunning(module.id, id) || (await readLock(paths))) {
    return res.status(409).json({ error: 'Dự án đang chạy' });
  }

  // Fire and forget: the screen follows the boxes over /api/<module>/events.
  void runAuto(module.id, id, { force });
  res.status(202).json({ started: true });
});

/** The row of boxes for this project, for the screen's first paint. */
router.get<{ id: string }>('/run', async (req, res) => {
  res.json(await readRunState(module.id, req.params.id));
});

/**
 * Everything behind one box: the artefact it produced, and the lines the run
 * printed while it was in that step.
 *
 * One request per opened step rather than everything up front - the storyboard
 * and the subtitles are large, and a screen that loads all seven whether or not
 * anyone opens them is a screen that takes a second to appear.
 */
router.get<{ id: string; step: string }>('/steps/:step', async (req, res) => {
  const step = STEP_IDS.find((s) => s === req.params.step) as StepId | undefined;
  if (!step) return res.status(404).json({ error: `Không có bước "${req.params.step}"` });

  const [detail, log] = [
    await readStepDetail(module.id, config, req.params.id, step),
    readLog(module.id, req.params.id).filter((line) => line.step === step),
  ];
  res.json({ ...detail, log });
});

/** The whole run's output, for the log panel. */
router.get<{ id: string }>('/log', (req, res) => {
  res.json(readLog(module.id, req.params.id));
});

router.post<{ id: string }>('/generate', async (req, res) => {
  const id = req.params.id;
  const force = req.body?.force === true;
  const paths = jobPaths(config.jobsDir, id);

  if (isRunning(module.id, id) || (await readLock(paths))) {
    return res.status(409).json({ error: 'Dự án đang chạy' });
  }

  // Fire and forget: the client follows progress over /api/events.
  void runGenerate(module.id, id, { force });
  res.status(202).json({ started: true });
});

/**
 * Upload to YouTube.
 *
 * Refuses up front on the two things that are certain to fail rather than
 * letting the CLI discover them: no credentials, and no listing to upload -
 * both of which would otherwise surface as a stack trace two minutes into a
 * hundred-megabyte transfer.
 */
router.post<{ id: string }>('/youtube', async (req, res) => {
  const id = req.params.id;
  const paths = jobPaths(config.jobsDir, id);

  if (!config.youtube.clientId || !config.youtube.clientSecret) {
    return res.status(400).json({
      error:
        'Chưa cấu hình YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET trong .env — xem hướng dẫn ở .env.example',
    });
  }

  const hasKit = await access(path.join(paths.output, 'youtube.json')).then(
    () => true,
    () => false,
  );
  if (!hasKit) {
    return res.status(400).json({ error: 'Chưa có video đã dựng xong để tải lên' });
  }

  if (isRunning(module.id, id) || (await readLock(paths))) {
    return res.status(409).json({ error: 'Dự án đang chạy' });
  }

  const privacy = typeof req.body?.privacy === 'string' ? req.body.privacy : null;
  const thumbnail = typeof req.body?.thumbnail === 'string' ? req.body.thumbnail : null;
  const schedule = req.body?.schedule === true;

  const args = ['youtube-upload', id];
  // Scheduling and an explicit privacy are mutually exclusive: a scheduled
  // video must be uploaded private, so passing both would be asking for two
  // different things.
  if (schedule) args.push('--schedule');
  else if (privacy) args.push('--privacy', privacy);
  if (thumbnail) args.push('--thumbnail', thumbnail);

  const { position, done } = runUpload(module.id, id, args);
  void done;

  // "Started" is a lie when it is fourth in line, and the UI can only say so if
  // it is told.
  res.status(202).json({ started: true, position });
});

  return router;
}
