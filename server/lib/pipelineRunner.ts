import path from 'node:path';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { jobPaths } from '../../src/config/env';
import type { ModuleId } from '../../src/domain/config';
import type { JobStatus } from '../../src/domain/job';
import { configFor } from './moduleContext';
import { readProjectSummary } from './projectStatus';
import { readProjectMeta } from './projectMeta';
import { runCli, spawnCli } from './processRunner';
import {
  STEP_BY_STAGE,
  activeStepFor,
  deriveRunState,
  recordTiming,
  type RunPhase,
  type RunState,
  type StepId,
  type StepTimings,
} from './runState';

/**
 * Tracks any long-running CLI action the server itself started (generate the
 * video, generate the storyboard) so the UI can watch it live over SSE
 * instead of a request that just blocks for a minute or two with no feedback.
 * Short one-shot actions (prepare, suggest-brief) don't need this - the
 * caller just awaits `runCli` directly and the client shows an elapsed timer.
 */
export type TrackedKind = 'generate' | 'storyboard' | 'upload' | 'auto';

/**
 * Every tracked run names its module.
 *
 * Not decoration: the two pipelines keep separate job directories, and a
 * project id is only unique inside one of them. Keying the "is it running?"
 * set on the id alone would let a podcast episode called `love-story` block a
 * fact short of the same name - and, worse, report the wrong one's progress.
 */
export interface TrackedRun {
  module: ModuleId;
  projectId: string;
}

const runKey = (module: ModuleId, projectId: string): string => `${module}:${projectId}`;

export const events = new EventEmitter();
events.setMaxListeners(50);

const running = new Set<string>();

/**
 * What each in-flight run is doing, so the pipeline screen can draw it.
 *
 * Held in memory rather than on disk on purpose. It describes *this process's*
 * activity, and a restart genuinely ends every run it was driving - persisting
 * it would only let the screen show a step as "running" under a server that is
 * no longer running it. What survives a restart is `job.json`, which is enough
 * to redraw a finished or failed project correctly.
 */
interface LiveRun {
  phase: RunPhase;
  /** Whether the project already had a brief when this run started. */
  hadBrief: boolean;
  willUpload: boolean;
  details: Partial<Record<StepId, string>>;
  queuePosition: number | null;
  timings: StepTimings;
  /** The step lines are attributed to as they arrive. See `appendLog`. */
  currentStep: StepId | null;
  /**
   * The status `job.json` held when this run started, and whether we have seen
   * it change since.
   *
   * `job.json` is the previous run's until the CLI overwrites it, and the
   * previous run usually ended `DONE` - which maps to the *last* step. Trusting
   * it immediately filed the first minute of every run under "Kiểm tra". So the
   * file is ignored until it reads something other than what it read at the
   * start; from that moment it is this run's and is trusted.
   */
  staleStatus: JobStatus | null;
  sawFreshJob: boolean;
}

const live = new Map<string, LiveRun>();

/** One line of a run's output, tagged with the step it belongs to. */
export interface LogLine {
  at: string;
  step: StepId | null;
  level: 'info' | 'warn' | 'error';
  text: string;
}

/**
 * The last run's output, per project.
 *
 * Separate from `live` so it survives the run: the most useful moment to read a
 * log is right after something failed, which is exactly when the live entry is
 * gone. Bounded, because a long render prints a line a second and nobody is
 * going to scroll back through an hour of them.
 *
 * In memory only. A restart genuinely ends every run this process was driving,
 * and the durable record of what happened is `job.json` plus the engine's own
 * JSONL under `runtime/<module>/logs/`.
 */
const MAX_LOG_LINES = 400;
const logs = new Map<string, LogLine[]>();

export function readLog(module: ModuleId, projectId: string): LogLine[] {
  return logs.get(runKey(module, projectId)) ?? [];
}

/**
 * Which step a line belongs to, asked at the moment the line arrives.
 *
 * Not by matching the text - the engine's messages are prose and change with
 * every edit, so a keyword table would rot silently and file lines under the
 * wrong box. And not from the polled cursor either, which was the first attempt
 * and is not good enough: with warm caches the engine goes from loading a
 * storyboard to starting a render in twenty milliseconds, so eleven lines
 * spanning four steps all landed under whichever step the last poll had seen.
 *
 * `job.json` carries the exact stage and the engine writes it *before* printing
 * the lines for that stage, so reading it synchronously here is both correct
 * and correctly ordered. It is a few hundred bytes and a run prints tens of
 * lines, so the sync read costs nothing worth measuring.
 *
 * The two ends of the run are not in job.json at all - drafting a brief and
 * uploading are the server's own work - so the phase wins for those.
 */
function stepForLine(module: ModuleId, projectId: string, entry: LiveRun | undefined): StepId | null {
  if (!entry) return null;
  if (entry.phase === 'brief') return 'brief';
  if (entry.phase === 'upload') return 'upload';

  /*
   * Read twice before giving up.
   *
   * `job.json` is written with a plain writeFile, so a read can land while the
   * file is truncated and the parse throws. The write finishes in microseconds,
   * so an immediate second attempt almost always succeeds - and when it does
   * not, the polled cursor is a reasonable answer rather than a wrong one.
   */
  const file = jobPaths(configFor(module).jobsDir, projectId).jobJson;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const job = JSON.parse(readFileSync(file, 'utf8')) as { stage?: string };
      const step = job.stage ? STEP_BY_STAGE[job.stage] : undefined;
      if (step) return step;
      break;
    } catch {
      // Half-written, or not there yet.
    }
  }
  return entry.currentStep;
}

/**
 * What to tell someone when a child exits non-zero.
 *
 * This used to quote stderr alone, and the engine's logger writes *everything*
 * through `console.log` - failures included. So stderr was empty on almost
 * every real failure and the fallback took over: every upload that YouTube
 * refused, whatever the reason, was reported as "Thoát mã 1". The reason was
 * sitting in stdout, and the only place it survived was the in-memory log panel
 * - which is gone the moment the server restarts.
 *
 * `✗` is the prefix `logger.error` puts on a line, so a marked line is the
 * engine naming its own failure rather than the last thing it happened to print
 * on the way down.
 */
/**
 * The last `✗` line *and its continuation*.
 *
 * Taking the marked line alone was not enough, and the way it failed was
 * particularly unhelpful: YouTube's refusal is one line ending in `{` followed
 * by the JSON that says why, so the interface reported
 * `YouTube refused the upload session (400): {` - a brace - while the sentence
 * "The user has exceeded the number of videos they may upload" sat three lines
 * below, unread. A multi-line message is one message; it ends where the next
 * marked line begins, not at the first newline.
 */
function markedFailure(lines: string[]): string | null {
  const start = lines.findLastIndex((line) => line.startsWith('✗'));
  if (start === -1) return null;

  const rest = lines.slice(start + 1);
  const nextMark = rest.findIndex((line) => /^[✓✗!→]/u.test(line));
  const body = nextMark === -1 ? rest : rest.slice(0, nextMark);

  const whole = [lines[start], ...body].join(' ').replace(/\s+/gu, ' ').trim();

  // Capped, because a zod rejection lists every field and runs to two thousand
  // characters - which is a toast covering the screen. The full text is never
  // lost: the step's log panel has it verbatim, and this is the summary.
  return whole.length > MAX_MESSAGE_CHARS ? `${whole.slice(0, MAX_MESSAGE_CHARS)}…` : whole;
}

/** Long enough for a sentence and a reason, short enough for a toast. */
const MAX_MESSAGE_CHARS = 400;

function failureMessage(stdout: string, stderr: string, code: number | null): string {
  const clean = (text: string) =>
    text
      .split('\n')
      .map((line) => line.trimEnd().replace(/^\[[^\]]+\]\s?/, ''))
      .filter((line) => line.trim());

  const errLines = clean(stderr);
  const outLines = clean(stdout);

  const marked = markedFailure(errLines) ?? markedFailure(outLines);
  if (marked) return marked;
  if (errLines.length > 0) return errLines.slice(-3).join(' ');
  return outLines.slice(-3).join(' ') || `Thoát mã ${code}`;
}

/**
 * Appends a chunk of the child's output to this run's log.
 */
function appendLog(
  module: ModuleId,
  projectId: string,
  text: string,
  level: LogLine['level'] = 'info',
): void {
  const key = runKey(module, projectId);
  const buffer = logs.get(key) ?? [];
  const step = stepForLine(module, projectId, live.get(key));

  for (const raw of text.split('\n')) {
    // The engine prefixes every line with the project id, which is the one
    // thing a per-project panel does not need repeated on all four hundred.
    const line = raw.trimEnd().replace(/^\[[^\]]+\]\s?/, '');
    if (!line.trim()) continue;
    buffer.push({
      at: new Date().toISOString(),
      step,
      // The engine prefixes its own warnings and failures, which is a more
      // reliable signal than which stream a line came down: tsx and Remotion
      // both write ordinary progress to stderr.
      level: /^\s*[!✗]|error|failed|thất bại|lỗi/i.test(line) ? (/^\s*!/.test(line) ? 'warn' : 'error') : level,
      text: line,
    });
  }
  logs.set(key, buffer.slice(-MAX_LOG_LINES));
}

function patchLive(module: ModuleId, projectId: string, patch: Partial<LiveRun>): void {
  const key = runKey(module, projectId);
  const current = live.get(key);
  if (current) live.set(key, { ...current, ...patch });
}

/**
 * Uploads run one at a time, whoever asks.
 *
 * Rendering is CPU-bound and the machine can be trusted to schedule several;
 * uploading is bandwidth-bound and cannot. Twenty-four shorts - a day of them -
 * launched together are a few hundred megabytes competing for one uplink: every
 * one crawls, each chunk request edges towards its timeout, and a failure
 * part-way through wastes the bytes already sent. Serialised, the same
 * twenty-four take exactly as long in total and the first is finished - and
 * schedulable - in seconds.
 *
 * A promise chain rather than a worker pool because the desired concurrency is
 * one; anything more elaborate would be machinery for a number that is not
 * going to change.
 */
let uploadChain: Promise<unknown> = Promise.resolve();
let uploadsWaiting = 0;

export function uploadQueueLength(): number {
  return uploadsWaiting;
}

export function runUpload(
  module: ModuleId,
  projectId: string,
  args: string[],
): { position: number; done: Promise<{ ok: boolean; message: string }> } {
  const position = uploadsWaiting;
  uploadsWaiting += 1;

  // One queue across *both* modules, deliberately. The constraint is the
  // machine's uplink, and it does not care which pipeline produced the file.
  const done = uploadChain.then(() => runTracked(module, projectId, 'upload', args));
  // The chain must survive a rejection or one failed upload would stall every
  // later one for the life of the process.
  uploadChain = done.catch(() => undefined).finally(() => {
    uploadsWaiting -= 1;
  });

  return { position, done };
}

/**
 * Whether anything is in flight for this project.
 *
 * Counts an auto-run even between its steps: `runAuto` holds no child process
 * while it moves from drafting a brief to generating, and a second press in
 * that gap would start a competing run.
 */
export function isRunning(module: ModuleId, projectId: string): boolean {
  const key = runKey(module, projectId);
  return running.has(key) || live.has(key);
}

interface ProgressFile {
  renderedFrames: number;
  totalFrames: number;
  updatedAt: string;
}

async function readProgress(module: ModuleId, projectId: string): Promise<ProgressFile | null> {
  const paths = jobPaths(configFor(module).jobsDir, projectId);
  const raw = await readFile(paths.progressJson, 'utf8').catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProgressFile;
  } catch {
    return null;
  }
}

const DONE_MESSAGE: Record<TrackedKind, string> = {
  generate: 'Tạo video thành công',
  storyboard: 'Đã tạo kịch bản mới',
  upload: 'Đã tải lên YouTube',
  auto: 'Chạy xong toàn bộ pipeline',
};

export function runTracked(
  module: ModuleId,
  projectId: string,
  kind: TrackedKind,
  args: string[],
  /**
   * Called on each poll, so a caller driving a longer sequence can refresh its
   * own view of the run on the same beat rather than polling separately.
   */
  onTick?: () => void | Promise<void>,
  /** Called with every line the child prints, for the run's log. */
  onLine?: (text: string, level: 'info' | 'warn' | 'error') => void,
): Promise<{ ok: boolean; message: string }> {
  const key = runKey(module, projectId);
  if (running.has(key)) {
    return Promise.resolve({ ok: false, message: 'Dự án đang chạy rồi' });
  }
  running.add(key);

  const config = configFor(module);

  return new Promise((resolve) => {
    const child = spawnCli(module, args);

    const poll = setInterval(() => {
      void readProjectSummary(config, projectId)
        .catch(() => null)
        .then(async (summary) => {
          if (!summary) return;
          // progress.json only means something while actually rendering -
          // outside that stage it may just be left over from a previous run.
          const progress =
            summary.status === 'RENDERING' ? await readProgress(module, projectId) : null;
          events.emit('update', { module, projectId, kind, summary, progress });
          await onTick?.();
        });
      /*
       * Twice a second, not once.
       *
       * This poll is the only thing that notices the run has moved on - the CLI
       * announces itself by writing job.json, and nobody tells the server. At a
       * one-second interval a stage that finished in under a second had all its
       * output filed under the previous step, which happens routinely when the
       * caches are warm. Reading a small JSON file twice a second costs
       * nothing; the log panel can also show the whole run, because no sampling
       * rate makes this exact.
       */
    }, 500);

    let stderr = '';
    let stdout = '';
    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString('utf8');
      stderr += text;
      // The engine writes its ordinary progress here, so this is the log rather
      // than an error channel; `appendLog` decides severity from the line.
      onLine?.(text, 'info');
    });
    child.stdout?.on('data', (d: Buffer) => {
      const text = d.toString('utf8');
      stdout += text;
      onLine?.(text, 'info');
    });

    const finish = async (ok: boolean, message: string) => {
      clearInterval(poll);
      running.delete(key);
      const summary = await readProjectSummary(config, projectId).catch(() => null);
      events.emit('done', { module, projectId, kind, ok, message, summary });
      resolve({ ok, message });
    };

    child.on('close', (code) => {
      const ok = code === 0;
      const message = ok ? DONE_MESSAGE[kind] : failureMessage(stdout, stderr, code);
      void finish(ok, message);
    });

    child.on('error', (err) => {
      void finish(false, err instanceof Error ? err.message : String(err));
    });
  });
}

/**
 * Renders, and then uploads if the project asked to be uploaded.
 *
 * Chained here rather than inside the pipeline because publishing is not part
 * of making a video: someone running `generate` in a terminal must never
 * discover afterwards that it went on the internet. The choice lives in the
 * UI's own meta.json, and only the UI acts on it.
 *
 * A failed render never uploads, and the upload's own failure is reported on
 * its own - the video is still rendered and still there, which is a different
 * situation from having no video at all.
 */
export async function runGenerate(
  module: ModuleId,
  projectId: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; message: string }> {
  const args = ['generate', projectId, '--no-publish'];
  if (opts.force) args.push('--force');

  const rendered = await runTracked(module, projectId, 'generate', args);
  if (!rendered.ok) return rendered;

  const paths = jobPaths(configFor(module).jobsDir, projectId);
  const meta = await readProjectMeta(paths.root, projectId).catch(() => null);
  if (!meta || meta.autoPublish === 'none') return rendered;

  const uploadArgs = ['youtube-upload', projectId];
  if (meta.autoPublish === 'schedule') uploadArgs.push('--schedule');

  const uploaded = await runUpload(module, projectId, uploadArgs).done;
  return uploaded.ok
    ? { ok: true, message: `${rendered.message}. ${uploaded.message}` }
    : { ok: false, message: `Đã dựng xong nhưng tải lên thất bại: ${uploaded.message}` };
}

/**
 * Whether a project has enough of a brief to write a script from.
 *
 * The presence of the file is not enough: the UI writes `brief.json` the moment
 * anyone blurs a text box, so an empty one is common and means "nothing typed
 * yet" rather than "ready to go".
 */
async function hasBrief(module: ModuleId, projectId: string): Promise<boolean> {
  const paths = jobPaths(configFor(module).jobsDir, projectId);
  const raw = await readFile(paths.briefJson, 'utf8').catch(() => null);
  if (!raw) return false;
  try {
    const brief = JSON.parse(raw) as { context?: string; hook?: string };
    return Boolean(brief.context?.trim() || brief.hook?.trim());
  } catch {
    return false;
  }
}

async function readJobFile(
  module: ModuleId,
  projectId: string,
): Promise<{ status: JobStatus; stage: string; error?: { message: string } | null } | null> {
  const paths = jobPaths(configFor(module).jobsDir, projectId);
  const raw = await readFile(paths.jobJson, 'utf8').catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { status: JobStatus; stage: string; error?: { message: string } | null };
  } catch {
    return null;
  }
}

/**
 * The row of boxes for one project, live or at rest.
 *
 * Works for a project nobody has touched (every box pending), one mid-run (the
 * live entry says which phase), and one finished or failed weeks ago (`job.json`
 * alone). The screen asks for this on open and then follows the same shape over
 * SSE, so there is one rendering path rather than two.
 */
export async function readRunState(module: ModuleId, projectId: string): Promise<RunState> {
  const key = runKey(module, projectId);
  const entry = live.get(key);
  const config = configFor(module);

  const [job, meta, uploaded] = await Promise.all([
    readJobFile(module, projectId),
    readProjectMeta(jobPaths(config.jobsDir, projectId).root, projectId).catch(() => null),
    readFile(
      path.join(jobPaths(config.jobsDir, projectId).output, 'youtube-upload.json'),
      'utf8',
    ).then(
      () => true,
      () => false,
    ),
  ]);

  const progress =
    job?.status === 'RENDERING' ? await readProgress(module, projectId).catch(() => null) : null;

  /*
   * Stamp the clock before deriving.
   *
   * There is no transition event to hook - a run's position is *discovered* by
   * reading job.json - so "we have moved on" is noticed here, on whatever poll
   * first sees the new status. `recordTiming` is idempotent, so being called on
   * every read costs nothing.
   */
  if (entry) {
    if (job && job.status !== entry.staleStatus) entry.sawFreshJob = true;

    // Until job.json is demonstrably this run's, the generate phase is reported
    // as its first step rather than as whatever the last run finished on.
    const trustworthy = entry.sawFreshJob ? job : null;
    const active =
      entry.phase === 'generate' && !trustworthy
        ? 'storyboard'
        : activeStepFor(entry.phase, trustworthy);

    recordTiming(entry.timings, active, new Date().toISOString());
    entry.currentStep = active;
  }

  return deriveRunState({
    module,
    projectId,
    phase: entry?.phase ?? null,
    // Same reasoning as the cursor above: a live run must not draw its boxes
    // from the previous run's leftover status.
    job: entry && !entry.sawFreshJob && entry.phase === 'generate' ? null : job,
    hadBrief: entry ? entry.hadBrief : await hasBrief(module, projectId),
    willUpload: entry ? entry.willUpload : (meta?.autoPublish ?? 'none') !== 'none',
    progress: progress ? { rendered: progress.renderedFrames, total: progress.totalFrames } : null,
    details: entry?.details ?? {},
    uploaded,
    queuePosition: entry?.queuePosition ?? null,
    timings: entry?.timings ?? {},
  });
}

/** Pushes the current row of boxes to every open screen. */
async function emitRunState(module: ModuleId, projectId: string): Promise<void> {
  const [run, summary] = await Promise.all([
    readRunState(module, projectId).catch(() => null),
    readProjectSummary(configFor(module), projectId).catch(() => null),
  ]);
  if (run) events.emit('run', { module, projectId, run, summary });
}

/**
 * The whole pipeline, start to finish, from one button.
 *
 * The steps are exactly the ones already available separately - this adds no
 * new capability, only the sequencing a person was doing by hand. Two rules
 * shape it:
 *
 * **A missing brief is drafted, never overwritten.** Pressing start on an empty
 * project asks Claude for a topic; pressing it on one somebody has written into
 * uses what they wrote. Silently replacing typed text with a machine's guess
 * would be the worst possible reading of "do everything".
 *
 * **Uploading still obeys the project's own setting.** `runGenerate` already
 * chains it, and that choice lives in `meta.json` where a person set it. This
 * function does not decide to publish; it just does not stop before the step
 * that was already going to happen.
 */
export async function runAuto(
  module: ModuleId,
  projectId: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; message: string }> {
  const key = runKey(module, projectId);
  if (running.has(key) || live.has(key)) {
    return { ok: false, message: 'Dự án đang chạy rồi' };
  }

  const config = configFor(module);
  const meta = await readProjectMeta(jobPaths(config.jobsDir, projectId).root, projectId).catch(
    () => null,
  );
  const alreadyHasBrief = await hasBrief(module, projectId);

  live.set(key, {
    phase: alreadyHasBrief ? 'generate' : 'brief',
    hadBrief: alreadyHasBrief,
    willUpload: (meta?.autoPublish ?? 'none') !== 'none',
    details: {},
    queuePosition: null,
    timings: {},
    currentStep: alreadyHasBrief ? 'storyboard' : 'brief',
    staleStatus: (await readJobFile(module, projectId))?.status ?? null,
    sawFreshJob: false,
  });
  // A new run starts a new log: keeping the previous run's lines above the new
  // ones is how someone reads a stale error and re-fixes a solved problem.
  logs.set(key, []);
  appendLog(module, projectId, `→ Bắt đầu chạy toàn bộ pipeline (${projectId})`);

  const finish = async (ok: boolean, message: string) => {
    live.delete(key);
    await emitRunState(module, projectId);
    events.emit('done', {
      module,
      projectId,
      kind: 'auto' as TrackedKind,
      ok,
      message,
      summary: await readProjectSummary(config, projectId).catch(() => null),
    });
    return { ok, message };
  };

  try {
    // ---- 1. A topic to write about ----------------------------------------
    if (!alreadyHasBrief) {
      await emitRunState(module, projectId);
      /*
       * The display name, not the id.
       *
       * They differ in exactly the way that matters: the id is a slug, so "Tại
       * sao mèo kêu grừ grừ" is stored as "tai-sao-meo-keu-gru-gru" and the
       * tones are gone. The name is what the user actually typed, and the
       * server is the only layer that still has it - the same reasoning as the
       * manual /brief/suggest route, which must not disagree with this one.
       */
      const topic = meta?.displayName?.trim() || projectId.replace(/-/gu, ' ');
      const suggested = await runCli(module, ['suggest-brief', projectId, '--topic', topic]);
      appendLog(module, projectId, suggested.stdout);
      if (suggested.stderr.trim()) appendLog(module, projectId, suggested.stderr, 'warn');
      if (suggested.code !== 0) {
        patchLive(module, projectId, {
          details: { brief: suggested.stderr.trim().split('\n').slice(-1)[0] ?? 'Thất bại' },
        });
        return finish(
          false,
          `Không nghĩ được đề tài: ${suggested.stderr.trim().split('\n').slice(-2).join(' ') || 'lỗi không rõ'}`,
        );
      }
      patchLive(module, projectId, { details: { brief: 'Claude tự nghĩ đề tài' } });
    }

    // ---- 2. Everything the engine does ------------------------------------
    patchLive(module, projectId, { phase: 'generate', currentStep: 'storyboard' });
    await emitRunState(module, projectId);

    const args = ['generate', projectId, '--no-publish'];
    if (opts.force) args.push('--force');

    const rendered = await runTracked(
      module,
      projectId,
      'generate',
      args,
      () => emitRunState(module, projectId),
      (text, level) => appendLog(module, projectId, text, level),
    );
    if (!rendered.ok) return finish(false, rendered.message);

    // ---- 3. Publishing, if this project asked for it ----------------------
    if ((meta?.autoPublish ?? 'none') === 'none') {
      return finish(true, 'Dựng xong (dự án này không tự đăng)');
    }

    patchLive(module, projectId, { phase: 'upload', currentStep: 'upload' });
    await emitRunState(module, projectId);

    const uploadArgs = ['youtube-upload', projectId];
    if (meta?.autoPublish === 'schedule') uploadArgs.push('--schedule');

    const { position, done } = runUpload(module, projectId, uploadArgs);
    patchLive(module, projectId, { queuePosition: position > 0 ? position : null });
    await emitRunState(module, projectId);

    const uploaded = await done;
    return uploaded.ok
      ? finish(true, `${rendered.message}. ${uploaded.message}`)
      : finish(false, `Đã dựng xong nhưng tải lên thất bại: ${uploaded.message}`);
  } catch (err) {
    return finish(false, err instanceof Error ? err.message : String(err));
  }
}
