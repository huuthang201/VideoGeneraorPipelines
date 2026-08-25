import path from 'node:path';
import { access, readdir, readFile } from 'node:fs/promises';
import { jobPaths, type AppConfig } from '../../src/config/env';
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
  hasStoryboard: boolean;
  hasVideo: boolean;
  scenes: number | null;
  durationSeconds: number | null;
  errorMessage: string | null;
  thumbnailUrl: string | null;
  /** Set once the video has been uploaded, so the grid can say so. */
  youtubeUrl: string | null;
  autoPublish: 'none' | 'now' | 'schedule';
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

export async function readProjectSummary(config: AppConfig, projectId: string): Promise<ProjectSummary> {
  const paths = jobPaths(config.jobsDir, projectId);

  const [meta, jobRaw, lock, hasStoryboard, hasVideo, hasThumb, uploadRaw] = await Promise.all([
    readProjectMeta(paths.root, projectId),
    readFile(paths.jobJson, 'utf8').catch(() => null),
    readLock(paths),
    exists(paths.storyboardJson),
    exists(paths.videoMp4),
    exists(paths.thumbnailJpg),
    readFile(path.join(paths.output, 'youtube-upload.json'), 'utf8').catch(() => null),
  ]);

  let youtubeUrl: string | null = null;
  if (uploadRaw) {
    try {
      youtubeUrl = (JSON.parse(uploadRaw) as { url?: string }).url ?? null;
    } catch {
      youtubeUrl = null;
    }
  }

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
    hasStoryboard,
    hasVideo,
    scenes: job?.scenes ?? null,
    durationSeconds: job?.durationSeconds ?? null,
    errorMessage: badge === 'FAILED' ? (job?.error?.message ?? null) : null,
    // Module-scoped, like every other URL the page uses: the two modules keep
    // separate job directories, so `/media/<id>/…` alone is ambiguous.
    thumbnailUrl: hasThumb ? `/media/${config.module}/${projectId}/thumbnail.jpg` : null,
    youtubeUrl,
    autoPublish: meta.autoPublish,
  };
}
