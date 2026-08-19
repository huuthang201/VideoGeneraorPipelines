import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { Router } from 'express';
import multer from 'multer';
import { loadConfig, jobPaths } from '../../src/config/env';
import { MINIMUM_IMAGES, SUPPORTED_IMAGE_EXTENSIONS } from '../../src/domain/project';
import { listStoryboardVersions } from '../../src/pipeline/storyboard-store';
import { readLock } from '../../src/pipeline/lock';
import { exists, listProjectIds, readProjectSummary } from '../lib/projectStatus';
import { writeProjectMeta } from '../lib/projectMeta';
import { isValidProjectId, slugify, uniqueProjectId } from '../lib/slug';
import { runCli } from '../lib/processRunner';

const config = loadConfig();
const uploadDir = path.join(config.runtimeDir, 'uploads');
// multer does not create its `dest` directory itself.
mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 30 * 1024 * 1024 } });

export const projectsRouter = Router();

projectsRouter.get('/', async (_req, res) => {
  const ids = await listProjectIds(config);
  const summaries = await Promise.all(ids.map((id) => readProjectSummary(config, id)));
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(summaries);
});

projectsRouter.get<{ id: string }>('/:id', async (req, res) => {
  const id = req.params.id;
  if (!isValidProjectId(id)) return res.status(400).json({ error: 'Id dự án không hợp lệ' });

  const paths = jobPaths(config.jobsDir, id);
  if (!(await exists(paths.root))) return res.status(404).json({ error: 'Không tìm thấy dự án' });

  const [summary, briefRaw, storyboardRaw, versions, previewFilenames] = await Promise.all([
    readProjectSummary(config, id),
    readFile(paths.briefJson, 'utf8').catch(() => null),
    readFile(paths.storyboardJson, 'utf8').catch(() => null),
    listStoryboardVersions(paths),
    readdir(paths.preview)
      .then((files) => files.filter((f) => f.toLowerCase().endsWith('.jpg')).sort())
      .catch(() => []),
  ]);

  res.json({
    ...summary,
    brief: briefRaw ? JSON.parse(briefRaw) : null,
    storyboard: storyboardRaw ? JSON.parse(storyboardRaw) : null,
    versions,
    previewFilenames,
  });
});

/**
 * Creating a project only needs a name. Images are a separate step
 * (`POST /:id/images`) so a folder can exist - and be seen in the grid -
 * before anyone has picked photos for it; nothing that needs the photos
 * (suggest-brief, generate-storyboard, generate) can run until enough exist.
 */
projectsRouter.post('/', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Thiếu tên dự án' });

  const id = await uniqueProjectId(config, slugify(name));
  await mkdir(jobPaths(config.jobsDir, id).root, { recursive: true });
  await writeProjectMeta(jobPaths(config.jobsDir, id).root, {
    displayName: name,
    createdAt: new Date().toISOString(),
  });

  res.status(201).json(await readProjectSummary(config, id));
});

projectsRouter.post<{ id: string }>('/:id/images', upload.array('images'), async (req, res) => {
  const id = req.params.id;
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  if (!isValidProjectId(id)) {
    await cleanupTempFiles(files);
    return res.status(400).json({ error: 'Id dự án không hợp lệ' });
  }

  const paths = jobPaths(config.jobsDir, id);
  if (!(await exists(paths.root))) {
    await cleanupTempFiles(files);
    return res.status(404).json({ error: 'Không tìm thấy dự án' });
  }
  if (await readLock(paths)) {
    await cleanupTempFiles(files);
    return res.status(409).json({ error: 'Dự án đang chạy' });
  }

  const validFiles = files.filter((f) =>
    (SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(
      path.extname(f.originalname).toLowerCase(),
    ),
  );
  await cleanupTempFiles(files.filter((f) => !validFiles.includes(f)));

  if (validFiles.length === 0) {
    return res.status(400).json({ error: 'Không có ảnh hợp lệ trong lần tải lên này' });
  }

  const stagingDir = path.join(uploadDir, `stage-${id}-${Date.now()}`);
  await mkdir(stagingDir, { recursive: true });

  try {
    await Promise.all(
      validFiles.map((f) => rename(f.path, path.join(stagingDir, path.basename(f.originalname)))),
    );

    const result = await runCli(['prepare', stagingDir, '--id', id]);
    const summary = await readProjectSummary(config, id);

    // `prepare` fails the whole call below MINIMUM_IMAGES, but every image
    // that *did* process successfully was already written to preview/images -
    // report the running total instead of a scary raw CLI error.
    if (result.code !== 0 && !summary.hasEnoughImages) {
      return res.status(200).json({
        ...summary,
        error: `Đã lưu ${summary.imageCount}/${MINIMUM_IMAGES} ảnh — cần thêm ít nhất ${MINIMUM_IMAGES - summary.imageCount} ảnh nữa.`,
      });
    }
    if (result.code !== 0) {
      return res
        .status(500)
        .json({ error: result.stderr.trim() || result.stdout.slice(-500) || 'Xử lý ảnh thất bại' });
    }

    res.status(200).json(summary);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
});

projectsRouter.delete<{ id: string }>('/:id', async (req, res) => {
  const id = req.params.id;
  if (!isValidProjectId(id)) return res.status(400).json({ error: 'Id dự án không hợp lệ' });

  const paths = jobPaths(config.jobsDir, id);
  if (await readLock(paths)) return res.status(409).json({ error: 'Dự án đang chạy, không thể xoá' });

  await rm(paths.root, { recursive: true, force: true });
  res.status(204).end();
});

async function cleanupTempFiles(files: Express.Multer.File[]): Promise<void> {
  await Promise.all(files.map((f) => rm(f.path, { force: true })));
}
