import path from 'node:path';
import { Router } from 'express';
import { loadConfig, jobPaths } from '../../src/config/env';
import { isValidProjectId } from '../lib/slug';

const config = loadConfig();
export const mediaRouter = Router();

const ROOT_FILES: Record<string, (jobDir: ReturnType<typeof jobPaths>) => string> = {
  'thumbnail.jpg': (p) => p.thumbnailJpg,
  'video.mp4': (p) => p.videoMp4,
};

mediaRouter.get('/:id/preview/:filename', (req, res) => {
  const { id, filename } = req.params;
  if (!isValidProjectId(id) || !/^[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(filename)) {
    return res.status(404).end();
  }
  const paths = jobPaths(config.jobsDir, id);
  res.sendFile(path.resolve(path.join(paths.preview, filename)), (err) => {
    if (err) res.status(404).end();
  });
});

mediaRouter.get('/:id/:file', (req, res) => {
  const { id, file } = req.params;
  const resolver = ROOT_FILES[file];
  if (!isValidProjectId(id) || !resolver) return res.status(404).end();

  const paths = jobPaths(config.jobsDir, id);
  res.sendFile(path.resolve(resolver(paths)), (err) => {
    if (err) res.status(404).end();
  });
});
