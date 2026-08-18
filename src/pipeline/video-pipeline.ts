import path from 'node:path';
import { mkdir, readFile, writeFile, access, cp, rm } from 'node:fs/promises';
import {
  StoryboardSchema,
  narrationFromScenes,
  withDerivedNarration,
  type Storyboard,
} from '../domain/storyboard';
import { ProductInfoSchema, type ProductInfo } from '../domain/project';
import { TimelineSchema, type Timeline } from '../domain/timeline';
import { ERROR_CODES, PipelineError } from '../domain/errors';
import type { Job } from '../domain/job';
import { jobPaths, type AppConfig, type JobPaths } from '../config/env';
import type { Logger } from '../utils/logger';
import { listImageFiles, processImages } from '../image/sharp.processor';
import { buildTimeline } from './build-timeline';
import { EdgeTTSProvider } from '../tts/edge.provider';
import { MockTTSProvider } from '../tts/mock.provider';
import type { TTSProvider, TTSResult } from '../tts/types';
import { getBundle } from '../video/bundler';
import { assetSrc, stageAssets } from '../video/asset-stage';
import { renderThumbnail, renderVideo } from '../video/renderer';
import { validateOutput } from '../video/validator';
import { computeInputHash, canSkip, loadOrCreateJob, markFailed, updateJob } from './job-store';
import { FileCache } from '../utils/cache';
import { LocalDriveStorageProvider } from '../storage/local-drive.provider';
import { RETRY_BUDGETS, withRetry } from '../utils/retry';

export const PIPELINE_VERSION = '1.0.0';

/** What a cached TTS entry stores alongside the audio and subtitle files. */
interface CachedVoice {
  duration: number;
  words: TTSResult['words'];
  isMock: boolean;
  voice: string;
}

/**
 * The deterministic pipeline (spec §12). Given a job folder it runs every stage
 * in order and produces the deliverables in spec §46.
 *
 * It contains no AI. Storyboard generation is injected, so the same code path
 * serves all three modes in spec §52 - AI, manual storyboard, and render-only -
 * differing only in which steps have work to do.
 */

export type PipelineMode = 'ai' | 'manual' | 'render-only';

export interface StoryboardSource {
  /** Called only when no storyboard.json exists. Supplied by the AI layer. */
  generate(input: {
    projectId: string;
    previewDir: string;
    info: ProductInfo | null;
    assetFilenames: string[];
  }): Promise<Storyboard>;
}

export interface RunPipelineOptions {
  projectId: string;
  config: AppConfig;
  logger: Logger;
  /** Re-runs every stage even when the inputs are unchanged (spec §34). */
  force?: boolean;
  /** Skips TTS when a voice track already exists: RENDER-ONLY mode. */
  reuseVoice?: boolean;
  /** Placeholder narration for offline work. Stamps job.devMock. */
  useMockTts?: boolean;
  /**
   * Copy the finished output to DRIVE_ROOT/03_OUTPUT when the job succeeds.
   * On by default: leaving the last hop to a human (or to an agent following a
   * checklist) is how a rendered video ends up sitting in runtime/ where nobody
   * looks for it.
   */
  publish?: boolean;
  /** Overrides the configured voice for this run, e.g. from --voice. */
  voiceOverride?: string;
  storyboardSource?: StoryboardSource;
}

export interface PipelineResult {
  status: 'completed' | 'skipped';
  /** Where the deliverables were published, or null when publishing was off. */
  publishedTo?: string | null;
  mode: PipelineMode;
  job: Job;
  paths: JobPaths;
  timeline?: Timeline;
}

export async function runPipeline(options: RunPipelineOptions): Promise<PipelineResult> {
  const { projectId, config, logger, force = false } = options;
  const paths = jobPaths(config.jobsDir, projectId);
  const startedAt = Date.now();

  let job = await loadOrCreateJob(paths, projectId);

  try {
    await assertExists(paths.root, `Job folder not found: ${paths.root}`);

    // ---- 1. Inputs -------------------------------------------------------
    const sourceDir = (await exists(paths.source)) ? paths.source : paths.root;
    const info = await readInfoJson(paths.infoJson);
    const existingStoryboardRaw = await readFile(paths.storyboardJson, 'utf8').catch(() => null);

    const mode: PipelineMode = existingStoryboardRaw
      ? options.reuseVoice
        ? 'render-only'
        : 'manual'
      : 'ai';

    // Idempotency runs before anything is written, and before the job status is
    // touched (spec §34). Checking it later would compare against a status this
    // very run had already overwritten, so it could never match - and hashing
    // the *source* rather than the processed images means a no-op run skips
    // Sharp too, instead of re-encoding every photo to decide it had nothing
    // to do.
    const sourceFilenames = await listImageFiles(sourceDir);
    const inputHash = await computeInputHash({
      imagePaths: sourceFilenames.map((f) => path.join(sourceDir, f)),
      infoJson: info ? JSON.stringify(info) : null,
      storyboardJson: existingStoryboardRaw,
      pipelineVersion: PIPELINE_VERSION,
      renderSettings: {
        voice: options.voiceOverride ?? config.tts.voice,
        rate: config.tts.rate,
        pitch: config.tts.pitch,
        provider: options.useMockTts ? 'mock' : config.tts.provider,
        style: config.video.style,
      },
    });

    if (!force && canSkip(job, inputHash, await exists(paths.videoMp4))) {
      logger.done('Already up to date; skipping (use --force to rebuild)');
      return { status: 'skipped', mode, job, paths };
    }

    job = await updateJob(paths, job, { status: 'VALIDATING', stage: 'validate' });

    // ---- 2. Images -------------------------------------------------------
    job = await updateJob(paths, job, { status: 'IMAGE_PROCESSING', stage: 'process-images' });

    const { images, skipped } = await processImages({
      sourceDir,
      outputDir: paths.images,
      previewDir: paths.preview,
    });
    for (const s of skipped) logger.warn(`skipped ${s.filename}: ${s.reason}`);
    logger.done(`Images processed (${images.length} usable)`);

    // ---- 3. Storyboard ---------------------------------------------------
    let storyboard: Storyboard;

    if (existingStoryboardRaw) {
      job = await updateJob(paths, job, { status: 'STORYBOARD_READY', stage: 'generate-storyboard' });
      storyboard = parseStoryboard(existingStoryboardRaw);
      logger.done(`Storyboard loaded (${storyboard.scenes.length} scenes, no Claude call)`);
    } else {
      if (!options.storyboardSource) {
        throw new PipelineError(
          ERROR_CODES.INVALID_STORYBOARD,
          'generate-storyboard',
          `No storyboard.json in ${paths.root} and no storyboard generator was provided. ` +
            'Write one by hand, or run with the AI provider enabled.',
        );
      }

      job = await updateJob(paths, job, { status: 'ANALYZING', stage: 'generate-storyboard' });
      storyboard = await options.storyboardSource.generate({
        projectId,
        previewDir: paths.preview,
        info,
        assetFilenames: images.map((i) => i.filename),
      });

      await writeFile(paths.storyboardJson, `${JSON.stringify(storyboard, null, 2)}\n`, 'utf8');
      logger.done(`Storyboard created (${storyboard.scenes.length} scenes)`);
    }

    // ---- 4. Narration ----------------------------------------------------
    job = await updateJob(paths, job, { status: 'TTS_GENERATING', stage: 'generate-tts' });

    const narration = narrationFromScenes(storyboard);
    const tts = await synthesize({
      narration,
      storyboard,
      paths,
      config,
      logger,
      reuseVoice: options.reuseVoice ?? false,
      useMockTts: options.useMockTts ?? false,
      voiceOverride: options.voiceOverride,
    });

    logger.done(
      `TTS ready (${tts.voice}, ${tts.duration.toFixed(2)}s, ${tts.words.length} word timings` +
        `${tts.isMock ? ', MOCK' : ''})`,
    );

    // ---- 5. Bundle and stage assets -------------------------------------
    const bundleLocation = await getBundle();
    const staged = await stageAssets({
      bundleLocation,
      projectId,
      directories: { images: paths.images, audio: paths.audio },
    });

    try {
      // ---- 6. Timeline ---------------------------------------------------
      const { timeline, diagnostics } = buildTimeline({
        storyboard,
        images,
        voiceSrc: assetSrc(staged.publicPrefix, 'audio', path.basename(tts.audioPath)),
        voiceDurationSec: tts.duration,
        words: tts.words,
        imageSrcFor: (filename) => assetSrc(staged.publicPrefix, 'images', filename),
      });

      TimelineSchema.parse(timeline);

      if (diagnostics.usedFallbackAlignment) {
        logger.warn('No word timings; scene boundaries were estimated from text length');
      } else if (diagnostics.alignmentConfidence < 0.7) {
        logger.warn(
          `Low alignment confidence (${diagnostics.alignmentConfidence.toFixed(2)}); captions may drift`,
        );
      }
      for (const id of diagnostics.longScenes) {
        logger.warn(`Scene ${id} runs long; consider splitting its narration`);
      }

      await writeFile(paths.timelineJson, `${JSON.stringify(timeline, null, 2)}\n`, 'utf8');
      logger.done(
        `Timeline built (${timeline.video.durationInFrames} frames, ` +
          `${(timeline.video.durationInFrames / timeline.video.fps).toFixed(2)}s)`,
      );

      // ---- 7. Render -----------------------------------------------------
      job = await updateJob(paths, job, { status: 'RENDERING', stage: 'render' });
      logger.step('Rendering...');

      // Spec §55 allows one render retry. Worth having: Chromium occasionally
      // fails to start under memory pressure, and re-running is far cheaper
      // than losing the Claude call and the TTS work already done.
      await withRetry(
        () => renderVideo({ bundleLocation, timeline, outputPath: paths.videoMp4 }),
        {
          attempts: RETRY_BUDGETS.render,
          initialDelayMs: 2000,
          onRetry: (err, attempt, delayMs) =>
            logger.warn(
              `Render attempt ${attempt} failed (${err instanceof Error ? err.message : String(err)}); ` +
                `retrying in ${delayMs}ms`,
            ),
        },
      );

      await renderThumbnail({ bundleLocation, timeline, outputPath: paths.thumbnailJpg });

      // ---- 8. Validate ---------------------------------------------------
      job = await updateJob(paths, job, { status: 'VALIDATING_OUTPUT', stage: 'validate-output' });

      const report = await validateOutput(paths.videoMp4, {
        expectedWidth: storyboard.video.width,
        expectedHeight: storyboard.video.height,
        minDurationSec: 5,
        expectedVoiceDurationSec: tts.duration,
        allowSilentAudio: tts.isMock,
      });

      for (const warning of report.warnings) logger.warn(warning);

      if (!report.ok) {
        const first = report.problems[0]!;
        throw new PipelineError(
          first.code,
          'validate-output',
          report.problems.map((p) => p.message).join('; '),
          { measured: report.measured },
        );
      }

      logger.done(
        `Output validated (${report.measured.width}x${report.measured.height}, ` +
          `${report.measured.videoCodec}+${report.measured.audioCodec}, ` +
          `${report.measured.durationSec.toFixed(2)}s)`,
      );

      // ---- 9. Side deliverables (spec §46) --------------------------------
      await writeScript(paths, storyboard);
      await copyCaptions(paths, tts);
      // The published storyboard records the voice that was actually used, not
      // whatever the model originally suggested, so the artifact matches the
      // audio beside it.
      const asRendered: Storyboard = {
        ...storyboard,
        voice: { ...storyboard.voice, voice: tts.voice, rate: config.tts.rate, pitch: config.tts.pitch },
      };
      await writeFile(
        path.join(paths.output, 'storyboard.json'),
        `${JSON.stringify(asRendered, null, 2)}\n`,
        'utf8',
      );

      job = await updateJob(paths, job, {
        status: 'DONE',
        stage: 'complete',
        completedAt: new Date().toISOString(),
        durationSeconds: report.measured.durationSec,
        voice: tts.voice,
        scenes: storyboard.scenes.length,
        devMock: tts.isMock,
        inputHash,
        error: null,
      });

      // job.json is copied in last so the one in output/ reflects the finished
      // state rather than whatever it held mid-render (spec §46).
      await cp(paths.jobJson, path.join(paths.output, 'job.json'));

      // A project that failed once and has now succeeded must not keep an
      // error file sitting in 99_ERROR. CLAUDE.md tells the Drive layer to read
      // that folder, so a stale entry would report a healthy project as broken.
      await clearErrorFile(config, projectId);

      // ---- 10. Publish (spec §46) -----------------------------------------
      let publishedTo: string | null = null;

      if (options.publish ?? true) {
        if (tts.isMock) {
          // A silent placeholder render must never reach the folder people
          // publish from (plan §2.3). It stays in runtime/ for inspection.
          logger.warn('Not publishing: this render uses mock narration (devMock)');
        } else {
          job = await updateJob(paths, job, { status: 'UPLOADING', stage: 'publish' });
          const storage = new LocalDriveStorageProvider(config.driveRoot);
          const target = await storage.publish(projectId, paths.output);
          publishedTo = target.describe;
          logger.done(`Published → ${publishedTo}`);
          job = await updateJob(paths, job, { status: 'DONE', stage: 'complete' });
        }
      }

      logger.done(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s → ${publishedTo ?? paths.output}`);
      return { status: 'completed', mode, job, paths, timeline, publishedTo };
    } finally {
      // Always unstage, even on failure: leftovers would be picked up by the
      // next render of the same project and hide a missing input.
      await staged.cleanup();
    }
  } catch (err) {
    const pipelineError =
      err instanceof PipelineError
        ? err
        : new PipelineError(
            ERROR_CODES.RENDER_FAILED,
            'render',
            err instanceof Error ? err.message : String(err),
            undefined,
            { cause: err },
          );

    job = await markFailed(paths, job, {
      stage: pipelineError.stage,
      code: pipelineError.code,
      message: pipelineError.message,
    });

    await writeErrorFile(config, projectId, pipelineError);
    throw pipelineError;
  }
}

async function synthesize(args: {
  narration: string;
  storyboard: Storyboard;
  paths: JobPaths;
  config: AppConfig;
  logger: Logger;
  reuseVoice: boolean;
  useMockTts: boolean;
  voiceOverride?: string;
}): Promise<TTSResult> {
  const { narration, storyboard, paths, config, logger } = args;

  // RENDER-ONLY mode (spec §52): an existing voice track means the expensive
  // and network-dependent step can be skipped entirely.
  if (args.reuseVoice && (await exists(paths.voiceMp3))) {
    const { getDurationSeconds } = await import('../video/ffprobe');
    const duration = await getDurationSeconds(paths.voiceMp3);
    const words = await readWordTimings(paths);
    logger.done('Reusing existing voice.mp3 (no TTS call)');
    return {
      audioPath: paths.voiceMp3,
      captionsPath: paths.captionsSrt,
      duration,
      words,
      isMock: false,
      voice: args.voiceOverride ?? config.tts.voice,
    };
  }

  const useMock = args.useMockTts || config.tts.provider === 'mock';
  const provider: TTSProvider = useMock ? new MockTTSProvider() : new EdgeTTSProvider(config.tts.pythonBin);

  /**
   * Configuration decides the voice; the storyboard only records it.
   *
   * Reading `storyboard.voice.voice` instead looked reasonable but made the
   * setting impossible to change: Claude writes the default voice into the
   * storyboard when it generates one, and from then on editing .env rebuilt the
   * video - costing a full render - and produced byte-for-byte the same
   * narration. That is worse than refusing, because it reports success.
   *
   * This matches how width, height and fps already work: system settings come
   * from config, and the storyboard is the record of what was used.
   */
  const voice = args.voiceOverride ?? config.tts.voice;
  const rate = config.tts.rate;
  const pitch = config.tts.pitch;

  const cache = new FileCache(path.join(config.runtimeDir, 'cache'));
  // Every input that changes how the audio sounds belongs in the key. Omitting
  // pitch would mean retuning the delivery silently replayed the old recording.
  const cacheKey = FileCache.key({
    provider: provider.name,
    text: narration,
    voice,
    rate,
    pitch,
  });

  // Spec §54. This is the most valuable cache in the pipeline: the same line in
  // the same voice always sounds the same, so re-rendering after a caption or
  // animation tweak should not depend on a service that periodically refuses
  // to answer (see R1).
  const cached = await cache.get<CachedVoice>('tts', cacheKey);
  if (cached) {
    await cache.restore(cached, { voice: paths.voiceMp3, captions: paths.captionsSrt });
    await writeFile(
      path.join(paths.audio, 'words.json'),
      `${JSON.stringify(cached.value.words, null, 2)}\n`,
      'utf8',
    );
    logger.done('Voice restored from cache (no TTS call)');
    return {
      audioPath: paths.voiceMp3,
      captionsPath: paths.captionsSrt,
      duration: cached.value.duration,
      words: cached.value.words,
      isMock: cached.value.isMock,
      voice: cached.value.voice,
    };
  }

  const result = await withRetry(
    () =>
      provider.synthesize({
        text: narration,
        language: 'vi-VN',
        // Both resolved above from config. Passing `storyboard.voice.voice`
        // here is what made the setting unchangeable, and omitting `pitch`
        // meant the delivery tuning never reached the synthesiser at all -
        // while the cache key recorded the requested values, so the stored
        // audio did not match its own key.
        voice,
        rate,
        pitch,
        outDir: paths.audio,
      }),
    {
      attempts: RETRY_BUDGETS.tts,
      // A second is far too eager for an endpoint that is refusing requests;
      // backing off in seconds rather than milliseconds is what actually lets
      // it recover before the next attempt.
      initialDelayMs: 3000,
      maxDelayMs: 20_000,
      onRetry: (err, attempt, delayMs) =>
        logger.warn(
          `TTS attempt ${attempt} failed (${err instanceof Error ? err.message : String(err)}); ` +
            `retrying in ${delayMs}ms`,
        ),
    },
  );

  await cache.set<CachedVoice>(
    'tts',
    cacheKey,
    {
      duration: result.duration,
      words: result.words,
      isMock: result.isMock,
      voice: result.voice,
    },
    { voice: result.audioPath, captions: result.captionsPath },
  );

  // Persisted so RENDER-ONLY runs keep word-level captions instead of silently
  // degrading to estimated boundaries.
  await writeFile(
    path.join(paths.audio, 'words.json'),
    `${JSON.stringify(result.words, null, 2)}\n`,
    'utf8',
  );

  return result;
}

async function readWordTimings(paths: JobPaths): Promise<TTSResult['words']> {
  const raw = await readFile(path.join(paths.audio, 'words.json'), 'utf8').catch(() => null);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as TTSResult['words'];
  } catch {
    return [];
  }
}

async function readInfoJson(filePath: string): Promise<ProductInfo | null> {
  const raw = await readFile(filePath, 'utf8').catch(() => null);
  if (raw === null) return null;

  const parsed = ProductInfoSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new PipelineError(
      ERROR_CODES.INVALID_INFO_JSON,
      'validate',
      `info.json is invalid:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  return parsed.data;
}

function parseStoryboard(raw: string): Storyboard {
  const parsed = StoryboardSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new PipelineError(
      ERROR_CODES.INVALID_STORYBOARD,
      'generate-storyboard',
      `storyboard.json is invalid:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  // The scene lines are the source of truth for what gets spoken, so any
  // top-level copy is recomputed rather than trusted.
  return withDerivedNarration(parsed.data);
}

/** script.txt: HOOK / NARRATION / CTA (spec §46). */
async function writeScript(paths: JobPaths, storyboard: Storyboard): Promise<void> {
  const body = [
    'HOOK',
    storyboard.content.hook,
    '',
    'NARRATION',
    ...storyboard.scenes.map((s) => `[${s.id}] ${s.narration}`),
    '',
    'CTA',
    storyboard.content.cta,
    '',
  ].join('\n');

  await mkdir(paths.output, { recursive: true });
  await writeFile(paths.scriptTxt, body, 'utf8');
}

async function copyCaptions(paths: JobPaths, tts: TTSResult): Promise<void> {
  if (!(await exists(tts.captionsPath))) return;
  await mkdir(paths.output, { recursive: true });
  await cp(tts.captionsPath, path.join(paths.output, 'captions.srt'));
}

/** 99_ERROR/{id}/error.json (spec §47). */
async function writeErrorFile(
  config: AppConfig,
  projectId: string,
  error: PipelineError,
): Promise<void> {
  const dir = path.join(config.driveRoot, '99_ERROR', projectId);
  await mkdir(dir, { recursive: true }).catch(() => {});
  await writeFile(
    path.join(dir, 'error.json'),
    `${JSON.stringify(error.toErrorFile(projectId), null, 2)}\n`,
    'utf8',
  ).catch(() => {});
}

async function clearErrorFile(config: AppConfig, projectId: string): Promise<void> {
  const dir = path.join(config.driveRoot, '99_ERROR', projectId);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  );
}

async function assertExists(filePath: string, message: string): Promise<void> {
  if (!(await exists(filePath))) {
    throw new PipelineError(ERROR_CODES.PROJECT_NOT_FOUND, 'validate', message);
  }
}
