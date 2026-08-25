import path from 'node:path';
import { Router } from 'express';
import type { ModuleContext } from '../lib/moduleContext';
import { jobPaths, libraryPaths, type AppConfig } from '../../src/config/env';
import { isValidProjectId } from '../lib/slug';
import { isImageFilename, libraryPreviewPath } from './library';

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
 * Library previews are served from one path per module rather than from under a
 * project, because that is where they live: the same file backs every episode
 * that uses it.
 *
 * Registered only for the podcast module - the fact module's photographs are
 * staged into the render bundle and never previewed here.
 */
  if (module.id === 'podcast') {
    router.get('/library/environment/:filename', (req, res) => {
      const { filename } = req.params;
      if (!isImageFilename(filename)) return res.status(404).end();

      res.sendFile(path.resolve(libraryPreviewPath(config, filename)), (err) => {
        if (err) res.status(404).end();
      });
    });
  }

/**
 * One scene's photograph, by filename.
 *
 * The timeline's `background.src` points into the Remotion bundle, which is
 * deleted when the render finishes - so the picture a finished project shows
 * has to come from wherever the module actually *keeps* it. Two stores, one
 * per module, and neither is under the job directory:
 *
 *   podcast → the uploaded library's render-ready copies
 *   fact    → the shared search cache
 *
 * The filename is checked against a strict pattern before it is joined to
 * either root: this takes a name from a URL, and `../` in one would otherwise
 * read any file the server can reach.
 */
router.get('/:id/scene/:filename', (req, res) => {
  const { id, filename } = req.params;
  if (!isValidProjectId(id) || !isImageFilename(filename)) return res.status(404).end();

  const root =
    module.id === 'podcast'
      ? libraryPaths(config.libraryDir).imagesFor('environment')
      : path.join(config.stock.cacheDir, 'images');

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
