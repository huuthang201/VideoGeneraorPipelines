import { access, readdir, readFile } from 'node:fs/promises';
import { jobPaths, type AppConfig } from '../../src/config/env';
import { MINIMUM_IMAGES } from '../../src/domain/project';
import { readLock } from '../../src/pipeline/lock';
import { readProjectMeta } from './projectMeta';

export type ProjectBadge = 'NEW' | 'HAS_STORYBOARD' | 'RUNNING' | 'DONE' | 'FAILED';

export interface ProjectSummary {
  id: string;
  displayName: string;
  createdAt: string;
  badge: ProjectBadge;
  /** Raw job.json fields, for showing a live stage instead of just the badge. */
  status: string | null;
  stage: string | null;
  imageCount: number;
  hasEnoughImages: boolean;
  hasStoryboard: boolean;
  hasVideo: boolean;
  scenes: number | null;
  durationSeconds: number | null;
  errorMessage: string | null;
  thumbnailUrl: string | null;
}

interface JobJsonShape {
  status: string;
  stage: string;
  scenes: number | null;
  durationSeconds: number | null;
  error: { message: string } | null;
}

export async function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

export async function listProjectIds(config: AppConfig): Promise<string[]> {
  const entries = await readdir(config.jobsDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Processed preview images are what every downstream action (brief, storyboard) needs. */
export async function countPreviewImages(previewDir: string): Promise<number> {
  const entries = await readdir(previewDir).catch(() => [] as string[]);
  return entries.filter((f) => f.toLowerCase().endsWith('.jpg')).length;
}

export async function readProjectSummary(config: AppConfig, projectId: string): Promise<ProjectSummary> {
  const paths = jobPaths(config.jobsDir, projectId);

  const [meta, jobRaw, lock, hasStoryboard, hasVideo, hasThumb, imageCount] = await Promise.all([
    readProjectMeta(paths.root, projectId),
    readFile(paths.jobJson, 'utf8').catch(() => null),
    readLock(paths),
    exists(paths.storyboardJson),
    exists(paths.videoMp4),
    exists(paths.thumbnailJpg),
    countPreviewImages(paths.preview),
  ]);

  let job: JobJsonShape | null = null;
  if (jobRaw) {
    try {
      job = JSON.parse(jobRaw) as JobJsonShape;
    } catch {
      job = null;
    }
  }

  let badge: ProjectBadge = 'NEW';
  if (lock) badge = 'RUNNING';
  else if (job?.status === 'DONE' && hasVideo) badge = 'DONE';
  else if (job?.status === 'FAILED') badge = 'FAILED';
  else if (hasStoryboard) badge = 'HAS_STORYBOARD';

  return {
    id: projectId,
    displayName: meta.displayName,
    createdAt: meta.createdAt,
    badge,
    status: lock ? (job?.status ?? 'PENDING') : (job?.status ?? null),
    stage: lock ? (job?.stage ?? null) : null,
    imageCount,
    hasEnoughImages: imageCount >= MINIMUM_IMAGES,
    hasStoryboard,
    hasVideo,
    scenes: job?.scenes ?? null,
    durationSeconds: job?.durationSeconds ?? null,
    errorMessage: badge === 'FAILED' ? (job?.error?.message ?? null) : null,
    thumbnailUrl: hasThumb ? `/media/${projectId}/thumbnail.jpg` : null,
  };
}
