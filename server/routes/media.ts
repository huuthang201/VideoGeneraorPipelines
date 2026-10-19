import path from 'node:path';
import { Router } from 'express';
import type { ModuleContext } from '../lib/moduleContext';
import { jobPaths, type AppConfig } from '../../src/config/env';
import { isValidProjectId } from '../lib/slug';


/**
 * One router per module.
 *
 * A factory rather than a singleton because the server hosts both pipelines at
 * once, and each needs its own `config` - different job directory, different
 * cache, different YouTube credentials. Mounting the same instance under both
 * prefixes would have given whichever module loaded first to both.
 */
export function createMediaRouter(ctx: ModuleContext) {
  const { config, module } = ctx;
  const router = Router();

const ROOT_FILES: Record<string, (jobDir: ReturnType<typeof jobPaths>) => string> = {
  'thumbnail.jpg': (p) => p.thumbnailJpg,
  'video.mp4': (p) => p.videoMp4,
  // So the voice step can be listened to rather than only described.
  'voice.mp3': (p) => p.voiceMp3,
};

/** The alternative cover images, thumbnail-2.jpg upwards. */
const ALTERNATE_THUMBNAIL = /^thumbnail-([2-9])\.jpg$/u;

/**
 * A filename safe to join onto a directory root.
 *
 * Strict rather than merely stripping `..`: this value comes from a URL, and an
 * allowlist of what a filename may contain is the only version of this check
 * that cannot be talked around.
 */
const isImageFilename = (name: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpe?g|png|webp)$/u.test(name) && !name.includes('..');

/**
 * One scene's photograph, by filename.
 *
 * The timeline's `background.src` points into the Remotion bundle, which is
 * deleted when the render finishes - so the picture a finished project shows
 * has to come from where the module actually *keeps* it: the shared search
 * cache, one per module and none of them under a job directory.
 *
 * There used to be two stores, because the podcast served render-ready copies
 * out of an uploaded library. Every module searches now, so there is one.
 *
 * The filename is checked against a strict pattern before it is joined to the
 * root: this takes a name from a URL, and `../` in one would otherwise read any
 * file the server can reach.
 */
router.get('/:id/scene/:filename', (req, res) => {
  const { id, filename } = req.params;
  if (!isValidProjectId(id) || !isImageFilename(filename)) return res.status(404).end();

  const root = path.join(config.stock.cacheDir, 'images');

  res.sendFile(path.resolve(root, filename), (err) => {
    if (err) res.status(404).end();
  });
});

router.get('/:id/:file', (req, res) => {
  const { id, file } = req.params;
  if (!isValidProjectId(id)) return res.status(404).end();

  const paths = jobPaths(config.jobsDir, id);
  const resolver = ROOT_FILES[file];
  const target = resolver
    ? resolver(paths)
    : ALTERNATE_THUMBNAIL.test(file)
      ? path.join(paths.output, file)
      : null;

  if (!target) return res.status(404).end();

  res.sendFile(path.resolve(target), (err) => {
    if (err) res.status(404).end();
  });
});

  return router;
}
