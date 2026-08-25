import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { Router } from 'express';
import multer from 'multer';
import { libraryPaths, type AppConfig } from '../../src/config/env';
import type { ModuleContext } from '../lib/moduleContext';
import { SUPPORTED_IMAGE_EXTENSIONS } from '../../src/domain/project';
import { runCli } from '../lib/processRunner';
import { readLibrarySummary } from '../lib/librarySummary';

/**
 * The shared backdrop library.
 *
 * Not nested under a project on purpose: these photographs belong to the module
 * and every project draws from them, so adding one here makes it available to
 * every episode at once. A project's own routes carry only its brief,
 * storyboard and output.
 *
 * Podcast-only. The fact module has no library screen because it has no
 * library - it searches for its photographs and caches the results, and nobody
 * curates that.
 */
export function createLibraryRouter(ctx: ModuleContext) {
  const { config, module } = ctx;
  const uploadDir = path.join(config.runtimeDir, 'uploads');
  // multer does not create its `dest` directory itself.
  mkdirSync(uploadDir, { recursive: true });
  const upload = multer({ dest: uploadDir, limits: { fileSize: 30 * 1024 * 1024 } });

  const router = Router();

router.get('/', async (_req, res) => {
  res.json(await readLibrarySummary(config));
});

router.post('/environments', upload.array('images'), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  await withStagedUpload(ctx, uploadDir, res, files, (stagingDir) => ['library', 'add-environments', stagingDir]);
});

router.delete<{ filename: string }>('/environments/:filename', async (req, res) => {
  if (!isImageFilename(req.params.filename)) {
    return res.status(400).json({ error: 'Tên file không hợp lệ' });
  }
  await runRemoval(ctx, res, ['library', 'remove-environment', req.params.filename]);
});

/** Absolute path of one preview file, for the media route. */
  return router;
}

export function libraryPreviewPath(config: AppConfig, filename: string): string {
  return path.join(libraryPaths(config.libraryDir).previewFor('environment'), filename);
}

export function isImageFilename(filename: string): boolean {
  return /^[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(filename);
}

/**
 * Uploads land in a real directory first because the importer takes a folder,
 * not a list of files - the same entry point the CLI uses, so both routes into
 * the library behave identically.
 */
async function withStagedUpload(
  ctx: ModuleContext,
  uploadDir: string,
  res: import('express').Response,
  files: Express.Multer.File[],
  toArgs: (stagingDir: string) => string[],
): Promise<void> {
  const validFiles = files.filter((f) =>
    (SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(
      path.extname(f.originalname).toLowerCase(),
    ),
  );
  await cleanupTempFiles(files.filter((f) => !validFiles.includes(f)));

  if (validFiles.length === 0) {
    res.status(400).json({ error: 'Không có ảnh hợp lệ trong lần tải lên này' });
    return;
  }

  const stagingDir = path.join(uploadDir, `stage-${Date.now()}`);
  await mkdir(stagingDir, { recursive: true });

  try {
    await Promise.all(
      validFiles.map((f) => rename(f.path, path.join(stagingDir, path.basename(f.originalname)))),
    );

    const result = await runCli(ctx.module.id, toArgs(stagingDir));
    if (result.code !== 0) {
      res
        .status(500)
        .json({ error: result.stderr.trim() || result.stdout.slice(-500) || 'Xử lý ảnh thất bại' });
      return;
    }

    res.json(await readLibrarySummary(ctx.config));
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

async function runRemoval(
  ctx: ModuleContext,
  res: import('express').Response,
  args: string[],
): Promise<void> {
  const result = await runCli(ctx.module.id, args);
  if (result.code !== 0) {
    res
      .status(500)
      .json({ error: result.stderr.trim() || result.stdout.slice(-300) || 'Xoá thất bại' });
    return;
  }
  res.json(await readLibrarySummary(ctx.config));
}

async function cleanupTempFiles(files: Express.Multer.File[]): Promise<void> {
  await Promise.all(files.map((f) => rm(f.path, { force: true })));
}
