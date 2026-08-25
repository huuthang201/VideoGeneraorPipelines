import type { ModuleId } from '../../src/domain/config';
import type { JobStatus } from '../../src/domain/job';

/**
 * The pipeline as the screen draws it: a row of boxes joined by arrows.
 *
 * This file is the single definition of what those boxes are and which one is
 * lit, and it exists because the answer comes from two places that do not know
 * about each other. The middle of the run is inside `runPipeline`, which
 * reports itself through `job.json`'s status; the ends - drafting a brief and
 * uploading - are driven by the server, which knows them directly. Deriving the
 * boxes in one function keeps the two from disagreeing on screen, which is
 * exactly the sort of bug nobody notices until a step sits "running" forever.
 *
 * The labels are not here. They belong to the interface, they are per module
 * (the podcast picks a photograph from a library, the fact short searches for
 * one), and putting Vietnamese UI copy in the server would only mean two places
 * to change it.
 */

export const STEP_IDS = [
  'brief',
  'storyboard',
  'images',
  'voice',
  'render',
  'check',
  'upload',
] as const;

export type StepId = (typeof STEP_IDS)[number];

/**
 * `skipped` is a real outcome, not a failure.
 *
 * A project that already has a brief skips drafting one; a project set to "no
 * upload" skips the last box. Drawing those as pending forever, or as done when
 * nothing ran, are both lies - and the second is the dangerous one, because it
 * reads as "published".
 */
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface RunStep {
  id: StepId;
  status: StepStatus;
  /** One line of what actually happened - "9 cảnh · 242 từ", "Thanh Bình · 51s". */
  detail: string | null;
  /** ISO timestamps, set once a step has actually been entered. */
  startedAt: string | null;
  endedAt: string | null;
  /** Wall-clock time in the step. Live while it runs, fixed once it ends. */
  durationMs: number | null;
}

/** When each step was entered and left, gathered as a run progresses. */
export type StepTimings = Partial<Record<StepId, { startedAt: string; endedAt?: string }>>;

export type RunStatus = 'idle' | 'running' | 'done' | 'failed';

export interface RunState {
  module: ModuleId;
  projectId: string;
  status: RunStatus;
  /** Which box is lit, or null when nothing is running. */
  active: StepId | null;
  steps: RunStep[];
  /** Only while rendering; the one stage long enough to be worth a bar. */
  progress: { rendered: number; total: number } | null;
  /** Set when `status` is 'failed'. */
  error: string | null;
  /** Position in the upload queue, when this run is waiting for the uplink. */
  queuePosition: number | null;
}

/**
 * Which phase of the run the *server* is driving.
 *
 * `generate` covers everything inside `runPipeline` - the phase is only enough
 * to say "the CLI owns this now", and `job.json` says which part of it.
 */
export type RunPhase = 'brief' | 'generate' | 'upload';

/**
 * Where each job status sits on the row of boxes.
 *
 * `PENDING`, `VALIDATING` and `DOWNLOADING` all map to `storyboard`: they are
 * the moments before the first interesting thing happens, and lighting an
 * eighth box called "checking inputs" would add a step nobody is waiting on.
 */
const STEP_BY_JOB_STATUS: Record<JobStatus, StepId> = {
  PENDING: 'storyboard',
  DOWNLOADING: 'storyboard',
  VALIDATING: 'storyboard',
  ANALYZING: 'storyboard',
  STORYBOARD_READY: 'storyboard',
  IMAGE_PROCESSING: 'images',
  TTS_GENERATING: 'voice',
  RENDERING: 'render',
  VALIDATING_OUTPUT: 'check',
  UPLOADING: 'upload',
  DONE: 'check',
  FAILED: 'storyboard',
};

/**
 * Which box a failure belongs to.
 *
 * From `job.stage` rather than `job.status`, because a failed job's status is
 * `FAILED` and says nothing about where it got to. The stage does.
 */
export const STEP_BY_STAGE: Record<string, StepId> = {
  validate: 'storyboard',
  'suggest-brief': 'brief',
  'generate-storyboard': 'storyboard',
  'process-images': 'images',
  'generate-tts': 'voice',
  'generate-captions': 'voice',
  'calculate-timeline': 'render',
  'build-props': 'render',
  render: 'render',
  'validate-output': 'check',
  thumbnail: 'check',
  publish: 'upload',
};

export interface DeriveInput {
  module: ModuleId;
  projectId: string;
  /** The phase the server is driving, or null when nothing is running. */
  phase: RunPhase | null;
  /** Parsed `job.json`, or null before the first run. */
  job: { status: JobStatus; stage: string; error?: { message: string } | null } | null;
  /** Whether the project already had a brief when the run started. */
  hadBrief: boolean;
  /** Whether this project uploads at all. `none` means the last box is skipped. */
  willUpload: boolean;
  /** Live render progress, when rendering. */
  progress: { rendered: number; total: number } | null;
  /** Per-step one-liners gathered during the run. */
  details: Partial<Record<StepId, string>>;
  /** Set once an upload has actually finished for this project. */
  uploaded: boolean;
  queuePosition: number | null;
  /** When each step was entered and left. See `recordTiming`. */
  timings: StepTimings;
}

/**
 * Which step the server is currently in, from the phase it is driving and what
 * `job.json` says about the part the CLI owns.
 *
 * Exported because the caller needs the answer *before* deriving the boxes, to
 * stamp the clock on a step that has just been entered.
 */
export function activeStepFor(
  phase: RunPhase | null,
  job: { status: JobStatus } | null,
): StepId | null {
  if (phase === 'brief') return 'brief';
  if (phase === 'upload') return 'upload';
  if (phase === 'generate' && job) return STEP_BY_JOB_STATUS[job.status];
  return null;
}

/**
 * Moves the clock along as the run enters a new step.
 *
 * Called on every poll rather than at each transition, because there is no
 * transition event to hook - the run's position is discovered by reading
 * `job.json`, so "we have moved on" is something noticed rather than announced.
 * Idempotent: re-reporting the same step does nothing.
 */
export function recordTiming(timings: StepTimings, active: StepId | null, now: string): void {
  for (const [id, span] of Object.entries(timings) as [StepId, { startedAt: string; endedAt?: string }][]) {
    if (id !== active && !span.endedAt) span.endedAt = now;
  }
  if (active && !timings[active]) timings[active] = { startedAt: now };
}

/**
 * Turns "what the server is doing" plus "what job.json says" into the row of
 * boxes.
 *
 * There is one cursor - the step the run is *at*, or the one it died at - and
 * everything before it is done, everything after is pending. That single rule
 * is what keeps the screen honest without the server having to keep a history:
 * the boxes are a position, not a log.
 *
 * `skipped` is reserved for a step this run is deliberately not doing, and only
 * while it is running. Once a run is over the boxes describe *what exists*: a
 * project with a brief shows that box done, whether the brief was typed months
 * ago or drafted ninety seconds ago. Showing it as skipped after the fact was
 * the first thing this got wrong - a run that had just written a brief redrew
 * it as "not done" the moment it finished.
 */
export function deriveRunState(input: DeriveInput): RunState {
  const { phase, job } = input;

  const idle = phase === null;
  const failed = job?.status === 'FAILED';
  const finished = job?.status === 'DONE';

  const active = activeStepFor(phase, job);
  const nowMs = Date.now();

  // Where the row stops: the running step, or the step a failure happened in.
  // From `job.stage` for a failure, because a failed job's *status* is FAILED
  // and says nothing about how far it got.
  const failedStep: StepId | null = failed ? (STEP_BY_STAGE[job.stage] ?? 'storyboard') : null;
  const cursor = failedStep ?? active;
  const cursorIndex = cursor ? STEP_IDS.indexOf(cursor) : -1;

  const steps: RunStep[] = STEP_IDS.map((id, index) => {
    const detail = input.details[id] ?? null;
    const span = input.timings[id];
    const startedAt = span?.startedAt ?? null;
    const endedAt = span?.endedAt ?? null;
    // Live while the step runs, fixed the moment it ends - so a box that is
    // working counts up and a box that is done stops.
    const durationMs = startedAt
      ? (endedAt ? Date.parse(endedAt) : nowMs) - Date.parse(startedAt)
      : null;
    const clock = { startedAt, endedAt, durationMs };

    // A project that never uploads has no last box to light, ever.
    if (id === 'upload' && !input.willUpload) return { id, status: 'skipped', detail, ...clock };

    // Only while a run is in flight does "already had one" mean "not doing it".
    if (id === 'brief' && input.hadBrief && !idle) return { id, status: 'skipped', detail, ...clock };

    if (cursorIndex >= 0) {
      if (index < cursorIndex) return { id, status: 'done', detail, ...clock };
      if (index > cursorIndex) return { id, status: 'pending', detail, ...clock };
      return {
        id,
        status: failed ? 'failed' : 'running',
        detail: failed ? (job?.error?.message ?? detail) : detail,
        ...clock,
      };
    }

    // Nothing running and nothing failed: describe what exists on disk, so
    // opening a finished project shows it finished rather than untouched.
    if (id === 'upload') return { id, status: input.uploaded ? 'done' : 'pending', detail, ...clock };
    if (id === 'brief' && input.hadBrief) return { id, status: 'done', detail, ...clock };
    return { id, status: finished ? 'done' : 'pending', detail, ...clock };
  });

  const status: RunStatus = failed ? 'failed' : idle ? (finished ? 'done' : 'idle') : 'running';

  return {
    module: input.module,
    projectId: input.projectId,
    status,
    active: idle ? null : active,
    steps,
    progress: active === 'render' ? input.progress : null,
    error: failed ? (job?.error?.message ?? 'Chạy thất bại') : null,
    queuePosition: input.queuePosition,
  };
}
