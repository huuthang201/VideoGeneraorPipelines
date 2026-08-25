/**
 * Everything the screen knows about the server.
 *
 * Every path is scoped to a module, and there is no unscoped form - the two
 * pipelines are different collections of projects publishing to different
 * YouTube channels, so a request that forgot to say which one it meant should
 * fail rather than guess. The server agrees: `/api/projects` is a 404.
 */

export type ModuleId = 'podcast' | 'fact';

export const MODULE: ModuleId =
  (new URLSearchParams(location.search).get('m') as ModuleId | null) ?? 'fact';

export const isPodcast = () => MODULE === 'podcast';

export const apiPath = (suffix: string) => `/api/${MODULE}${suffix}`;
export const mediaPath = (suffix: string) => `/media/${MODULE}${suffix}`;

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiPath(path), init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // No JSON body (204 and friends) is fine.
  }
  if (!res.ok) {
    throw new Error((body as { error?: string } | null)?.error ?? `Lỗi ${res.status}`);
  }
  return body as T;
}

/**
 * The one endpoint that is *not* module-scoped.
 *
 * `/api/modules` lists which pipelines this build offers, which is the question
 * you ask before you know which module you are. Everything else goes through
 * `api()` and gets the prefix.
 */
export async function fetchModules(): Promise<ModuleInfo[]> {
  const res = await fetch('/api/modules');
  if (!res.ok) throw new Error(`Lỗi ${res.status}`);
  return (await res.json()) as ModuleInfo[];
}

export async function apiJson<T = unknown>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  return api<T>(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

// ---------------------------------------------------------------- shapes ----

export type StepId = 'brief' | 'storyboard' | 'images' | 'voice' | 'render' | 'check' | 'upload';
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';
export type RunStatus = 'idle' | 'running' | 'done' | 'failed';

export interface RunStep {
  id: StepId;
  status: StepStatus;
  detail: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
}

export interface LogLine {
  at: string;
  step: StepId | null;
  level: 'info' | 'warn' | 'error';
  text: string;
}

/** What `GET /pipeline/steps/:step` returns. `data` is shaped per step. */
export interface StepDetail {
  step: StepId;
  data: unknown;
  log: LogLine[];
}

// The `data` shapes, one per step. Narrowed at the point of use rather than
// with a discriminated union: the server keys them by step id, and a union
// would mean repeating that mapping here for no extra safety.

export interface BriefData {
  context?: string;
  hook?: string;
  targetMinutes?: number;
  targetSeconds?: number;
}

export interface StoryboardData {
  episodeTitle: string;
  summary: string;
  imageQueries: string[] | null;
  wordCount: number;
  scenes: StoryboardScene[];
}

export interface ImagesData {
  scenes: {
    sceneId: string;
    title: string;
    filename: string;
    url: string;
    width: number;
    height: number;
    fit: string;
    seconds: number;
    credit: { label: string; creator: string; license: string; sourceUrl: string } | null;
  }[];
}

export interface VoiceData {
  voice: string | null;
  devMock: boolean;
  wordTimings: number;
  seconds: number | null;
  narration: string | null;
  captionsHead: string | null;
  audioUrl: string;
}

export interface RenderData {
  width: number | null;
  height: number | null;
  fps: number | null;
  frames: number | null;
  scenes: number | null;
  seconds: number | null;
  renderSeconds: number | null;
  devMock: boolean;
  progress: { renderedFrames: number; totalFrames: number } | null;
  videoUrl: string;
}

export interface CheckData {
  status: string | null;
  error: { stage: string; code: string; message: string } | null;
  devMock: boolean;
  expected: { width: number; height: number; seconds: number } | null;
  thumbnails: { name: string; url: string }[];
}

export interface UploadData {
  kit: {
    title: string;
    description: string;
    tags: string[];
    chapters?: { label: string; timecode: string }[];
    images?: { creator: string; license: string; sourceUrl: string }[];
  } | null;
  upload: {
    url: string;
    privacyStatus: string;
    publishAt?: string;
    channel?: { title: string; url: string };
    thumbnailError?: string;
  } | null;
  autoPublish: string;
  configured: boolean;
}

export interface RunState {
  module: ModuleId;
  projectId: string;
  status: RunStatus;
  active: StepId | null;
  steps: RunStep[];
  progress: { rendered: number; total: number } | null;
  error: string | null;
  queuePosition: number | null;
}

export type ProjectBadge = 'NEW' | 'HAS_STORYBOARD' | 'RUNNING' | 'DONE' | 'FAILED';

export interface ProjectSummary {
  id: string;
  displayName: string;
  createdAt: string;
  badge: ProjectBadge;
  status: string | null;
  stage: string | null;
  hasStoryboard: boolean;
  hasVideo: boolean;
  scenes: number | null;
  durationSeconds: number | null;
  errorMessage: string | null;
  thumbnailUrl: string | null;
  youtubeUrl: string | null;
  autoPublish: 'none' | 'now' | 'schedule';
}

export interface LibraryIndex {
  environment: string[];
  counts: { environment: number };
  ready: boolean;
}

export interface Brief {
  context?: string;
  hook?: string;
  targetMinutes?: number;
  targetSeconds?: number;
  environments?: string[];
}

export interface StoryboardScene {
  id: string;
  type: 'intro' | 'segment' | 'outro';
  title: string;
  narration: string;
  narrationVi?: string;
  environment?: string;
  imageQuery?: string;
}

export interface Storyboard {
  project: { episodeTitle: string };
  content: { summary: string; imageQueries?: string[] };
  scenes: StoryboardScene[];
}

export interface ProjectDetail extends ProjectSummary {
  brief: Brief | null;
  storyboard: Storyboard | null;
  versions: { filename: string; createdAt: string }[];
  library?: LibraryIndex;
  defaultTargetSeconds?: number;
  publish: { title: string; description: string; tags: string[]; thumbnails?: string[] } | null;
  upload: { videoId?: string; url?: string; privacyStatus?: string; thumbnailError?: string } | null;
  youtubeChannel: { title: string } | null;
}

export interface ScheduleSlot {
  publishAt: string;
  intervalHours: number;
  wasStale: boolean;
  ready: boolean;
}

export interface ModuleInfo {
  id: ModuleId;
  label: string;
  description: string;
}
