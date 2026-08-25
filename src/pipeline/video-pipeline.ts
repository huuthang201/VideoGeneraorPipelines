import path from 'node:path';
import { mkdir, readFile, writeFile, access, cp, rm } from 'node:fs/promises';
import { narrationFromScenes, withDerivedNarration } from '../domain/storyboard';
import { ProductInfoSchema, type ProductInfo } from '../domain/project';
import type { BaseBrief } from '../domain/brief';
import { TimelineSchema, type Timeline } from '../domain/timeline';
import { SHORTS_MAX_SECONDS, type Pacing } from '../domain/config';
import { ERROR_CODES, PipelineError } from '../domain/errors';
import type { Job } from '../domain/job';
import { jobPaths, type AppConfig, type JobPaths } from '../config/env';
import type { Logger } from '../utils/logger';
import type { AnyVideoModule, SceneLike, StoryboardLike } from '../modules';
import { buildTimeline } from './build-timeline';
import { EdgeTTSProvider } from '../tts/edge.provider';
import { VieNeuTTSProvider } from '../tts/vieneu.provider';
import { MockTTSProvider } from '../tts/mock.provider';
import { languageOf, type TTSProvider, type TTSResult } from '../tts/types';
import { getBundle } from '../video/bundler';
import { assetSrc, stageAssets } from '../video/asset-stage';
import { readdir } from 'node:fs/promises';
import { renderThumbnail, renderVideo } from '../video/renderer';
import { validateOutput } from '../video/validator';
import { computeInputHash, canSkip, loadOrCreateJob, markFailed, updateJob } from './job-store';
import { saveStoryboardVersion } from './storyboard-store';
import { buildPublishKit, readMusicCredit, writePublishKit } from './publish-kit';
import { acquireLock, releaseLock } from './lock';
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
  /** So a restore writes back the same container the engine produced. */
  audioExt: string;
}

/**
 * The deterministic pipeline. Given a job folder it runs every stage in order
 * and produces the deliverables.
 *
 * It contains no AI. Storyboard generation is injected, so the same code path
 * serves all three modes - AI, manual storyboard, and render-only - differing
 * only in which steps have work to do.
 */

export type PipelineMode = 'ai' | 'manual' | 'render-only';

type Storyboard = StoryboardLike<SceneLike>;
type Brief = BaseBrief;

export interface RunPipelineOptions {
  projectId: string;
  config: AppConfig;
  logger: Logger;
  /**
   * Which pipeline this is.
   *
   * Everything that differs between a podcast episode and a fact short reaches
   * this file through here: the schemas, the prompt, where the pictures come
   * from, how a subtitle is laid out, how long a scene may run. See
   * `src/modules/contract.ts`.
   */
  module: AnyVideoModule;
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
  /**
   * Whether this run may call Claude for a storyboard it does not have.
   *
   * Off for `render` and `generate-storyboard --no-ai`; on for `generate`. The
   * generator itself is the module's, so there is nothing to inject here any
   * more - only permission to use it.
   */
  allowStoryboardGeneration?: boolean;
  /**
   * Stops right after a storyboard exists (no TTS, no render). Used by the
   * `generate-storyboard` CLI command so the UI can offer "create the script"
   * as a separate, much cheaper action from "make the video".
   */
  storyboardOnly?: boolean;
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
  const { projectId, config, logger, module, force = false } = options;
  const paths = jobPaths(config.jobsDir, projectId);
  const startedAt = Date.now();

  let job = await loadOrCreateJob(paths, projectId);
  await acquireLock(paths).catch(() => {});

  try {
    await assertExists(paths.root, `Job folder not found: ${paths.root}`);

    // ---- 1. Inputs -------------------------------------------------------
    const info = await readInfoJson(paths.infoJson);
    const brief = await readBriefJson(paths.briefJson, module);
    const existingStoryboardRaw = await readFile(paths.storyboardJson, 'utf8').catch(() => null);

    const mode: PipelineMode = existingStoryboardRaw
      ? options.reuseVoice
        ? 'render-only'
        : 'manual'
      : 'ai';

    // Idempotency runs before anything is written, and before the job status is
    // touched (spec §34). Checking it later would compare against a status this
    // very run had already overwritten, so it could never match.
    //
    // No image paths go into the key any more, and they cannot: the pictures
    // are searched for using queries that live *inside* the storyboard, so they
    // do not exist yet at this point in the run. The storyboard covers them by
    // proxy - change a query and the hash changes - and the search cache means
    // an unchanged storyboard resolves to the same photographs anyway.
    const inputHash = await computeInputHash({
      imagePaths: [],
      infoJson: info ? JSON.stringify(info) : null,
      storyboardJson: existingStoryboardRaw,
      pipelineVersion: PIPELINE_VERSION,
      renderSettings: {
        voice: options.voiceOverride ?? config.tts.voice,
        rate: config.tts.rate,
        pitch: config.tts.pitch,
        engine: options.useMockTts ? 'mock' : config.tts.engine,
        volume: config.tts.volume,
        speed: String(config.tts.speed),
        style: config.video.style,
        music: `${config.music.file}@${config.music.volume}`,
        // The frame size belongs in the key too: switching VIDEO_ASPECT changes
        // every pixel of the output while leaving the storyboard and the audio
        // untouched, so without it a re-run would report "already up to date"
        // and hand back the video in the old shape.
        frame: `${config.video.width}x${config.video.height}`,
        // The module id itself, because the two render the same storyboard
        // differently - different theme pack, different subtitle layout.
        module: module.id,
        ...module.hashInputs({ brief, config }),
      },
    });

    if (!force && canSkip(job, inputHash, await exists(paths.videoMp4))) {
      logger.done('Already up to date; skipping (use --force to rebuild)');
      return { status: 'skipped', mode, job, paths };
    }

    job = await updateJob(paths, job, { status: 'VALIDATING', stage: 'validate' });

    // Length is a per-project editorial decision, so the brief wins over
    // configuration when it names one. What "the brief names one" means is the
    // module's business - minutes in one, seconds in the other - and so is
    // whatever ceiling the format imposes on the answer.
    const requestedSec = module.targetSecondsOf(brief) ?? config.video.targetDuration;
    const targetDurationSec = module.resolveTargetSeconds(requestedSec, config, logger);

    // ---- 3. Storyboard ---------------------------------------------------
    let storyboard: Storyboard;

    if (existingStoryboardRaw) {
      job = await updateJob(paths, job, { status: 'STORYBOARD_READY', stage: 'generate-storyboard' });
      storyboard = parseStoryboard(existingStoryboardRaw, module);
      logger.done(`Storyboard loaded (${storyboard.scenes.length} scenes, no Claude call)`);
    } else {
      if (!options.allowStoryboardGeneration) {
        throw new PipelineError(
          ERROR_CODES.INVALID_STORYBOARD,
          'generate-storyboard',
          `No storyboard.json in ${paths.root} and this run may not call Claude for one. ` +
            'Write one by hand, or use `generate` rather than `render`.',
        );
      }

      job = await updateJob(paths, job, { status: 'ANALYZING', stage: 'generate-storyboard' });
      storyboard = await module.generateStoryboard(
        { projectId, info, brief, targetDurationSec },
        config,
        logger,
      );

      const storyboardRaw = `${JSON.stringify(storyboard, null, 2)}\n`;
      await writeFile(paths.storyboardJson, storyboardRaw, 'utf8');
      await saveStoryboardVersion(paths, storyboardRaw).catch((err) =>
        logger.warn(`Could not archive storyboard version: ${err instanceof Error ? err.message : String(err)}`),
      );
      logger.done(`Storyboard created (${storyboard.scenes.length} scenes)`);
    }

    if (options.storyboardOnly) {
      // Clears any error left over from a previous failed run, same as the
      // full-pipeline DONE path - otherwise a job that fails once and then
      // succeeds at just the storyboard keeps reporting the old failure.
      job = await updateJob(paths, job, {
        status: 'STORYBOARD_READY',
        stage: 'generate-storyboard',
        error: null,
      });
      logger.done(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s → storyboard only`);
      return { status: 'completed', mode, job, paths };
    }

    /*
     * The frame size and frame rate are delivery settings, not content.
     *
     * They are re-read from configuration on every run rather than taken from
     * the storyboard, so switching VIDEO_ASPECT re-renders an existing video in
     * the new shape. Reading them from the file instead looked tidier and was
     * wrong in a way that reports success: the run picked up the new setting in
     * its input hash, spent a full render on it, and produced a video in the old
     * shape - which for a Short means an upload YouTube will not serve as one.
     * `style` is left exactly as the model chose it - that one *is* content.
     */
    storyboard = {
      ...storyboard,
      video: {
        ...storyboard.video,
        width: config.video.width,
        height: config.video.height,
        fps: config.video.fps,
      },
    };

    /*
     * ---- 4. Photographs --------------------------------------------------
     *
     * After the storyboard, and that ordering is load-bearing for one of the
     * two modules rather than merely convenient. The fact module's script names
     * what it wants to be shot against, so the queries do not exist until the
     * storyboard does; this is also where such a job fails if the search is
     * unreachable or rate-limited. The podcast module could resolve earlier -
     * its pictures were uploaded long ago - but it reads the library during
     * generation anyway, so nothing is gained by splitting the stage in two.
     */
    job = await updateJob(paths, job, { status: 'IMAGE_PROCESSING', stage: 'process-images' });

    const resolved = await module.resolveBackdrops({ storyboard, config, logger, brief });
    const backdrops = resolved.backdrops;

    logger.done(resolved.summary);

    // ---- 5. Narration ----------------------------------------------------
    job = await updateJob(paths, job, { status: 'TTS_GENERATING', stage: 'generate-tts' });

    const narration = narrationFromScenes(storyboard);
    const tts = await synthesize({
      narration,
      storyboard,
      module,
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

    // ---- 6. Bundle and stage assets -------------------------------------
    const bundleLocation = await getBundle();

    const musicFile = await resolveMusic(config, logger);

    // What goes into the bundle is the module's call: one copies the library's
    // whole images directory, the other names each downloaded file. See
    // `ResolvedBackdrops.staging`.
    const staged = await stageAssets({
      bundleLocation,
      projectId,
      directories: { audio: paths.audio, ...resolved.staging.directories },
      files: {
        ...resolved.staging.files,
        ...(musicFile ? { [`music/${path.basename(musicFile)}`]: musicFile } : {}),
      },
    });

    try {
      // ---- 7. Timeline ---------------------------------------------------
      const { timeline, diagnostics } = buildTimeline({
        storyboard,
        module: module.id,
        pacing: module.pacing,
        coverTolerance: module.coverTolerance,
        buildCaptions: module.buildCaptions,
        backdrops,
        voiceSrc: assetSrc(staged.publicPrefix, 'audio', path.basename(tts.audioPath)),
        voiceDurationSec: tts.duration,
        words: tts.words,
        imageSrcFor: (image) => resolved.imageSrcFor(staged.publicPrefix, image),
        music: musicFile
          ? {
              src: assetSrc(staged.publicPrefix, 'music', path.basename(musicFile)),
              volume: config.music.volume,
            }
          : null,
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
        () =>
          renderVideo({
            bundleLocation,
            timeline,
            outputPath: paths.videoMp4,
            onProgress: (progress) => {
              void writeFile(
                paths.progressJson,
                JSON.stringify({ ...progress, updatedAt: new Date().toISOString() }),
                'utf8',
              ).catch(() => {});
            },
          }),
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

      /*
       * Three thumbnails, not one.
       *
       * A cover image is a choice, and it is the one part of publishing that a
       * still frame can genuinely be wrong about - the intro frame is the
       * obvious pick and is also the one where the narrator has just said
       * hello over a photograph nobody has looked at yet. Offering the opening
       * of three different scenes costs two extra stills and saves scrubbing
       * through eight minutes of video to find a better one.
       */
      const thumbnailFrames = pickThumbnailFrames(timeline);
      const thumbnails: string[] = [];

      for (const [index, frame] of thumbnailFrames.entries()) {
        const name = index === 0 ? 'thumbnail.jpg' : `thumbnail-${index + 1}.jpg`;
        await renderThumbnail({
          bundleLocation,
          timeline,
          outputPath: path.join(paths.output, name),
          frame,
        });
        thumbnails.push(name);
      }

      // ---- 8. Validate ---------------------------------------------------
      job = await updateJob(paths, job, { status: 'VALIDATING_OUTPUT', stage: 'validate-output' });

      const report = await validateOutput(paths.videoMp4, {
        expectedWidth: storyboard.video.width,
        expectedHeight: storyboard.video.height,
        // Only a sanity floor and a runaway ceiling, and the module's own -
        // the two formats are an order of magnitude apart. See
        // `outputDurationGuard`.
        minDurationSec: module.outputDurationGuard.minSeconds,
        maxDurationSec: module.outputDurationGuard.maxSeconds,
        expectedVoiceDurationSec: tts.duration,
        allowSilentAudio: tts.isMock,
      });

      for (const warning of report.warnings) logger.warn(warning);

      /*
       * The Shorts ceiling, checked but not enforced here.
       *
       * A video that overruns is still a perfectly good video, and failing the
       * render would throw away a Claude call, a round of speech and the render
       * itself over something the operator may well accept. What must not
       * happen is *uploading* it as a Short without anyone noticing, so the
       * refusal lives in the upload command and this is the early warning.
       */
      if (isVertical(config) && report.measured.durationSec > SHORTS_MAX_SECONDS) {
        logger.warn(
          `This video is ${report.measured.durationSec.toFixed(1)}s, past the ` +
            `${SHORTS_MAX_SECONDS}s Shorts ceiling. YouTube will accept it and then serve it as ` +
            'an ordinary video rather than a Short. Shorten the script (a lower "độ dài mong ' +
            'muốn") and re-run, or upload it deliberately with --allow-long.',
        );
      }

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
        voice: {
          ...storyboard.voice,
          language: languageOf(tts.voice),
          voice: tts.voice,
          rate: config.tts.rate,
          pitch: config.tts.pitch,
        },
      };
      await writeFile(
        path.join(paths.output, 'storyboard.json'),
        `${JSON.stringify(asRendered, null, 2)}\n`,
        'utf8',
      );

      // Everything the upload form asks for, with the chapter timings taken
      // from the finished timeline rather than guessed.
      const kit = buildPublishKit({
        storyboard: asRendered,
        timeline,
        thumbnails,
        music: await readMusicCredit(config.music.dir, musicFile),
        musicFile,
        titlePrefix: config.youtube.titlePrefix,
      });
      await writePublishKit(paths.output, kit);
      logger.done(
        `Publishing kit ready (${kit.chapters.length} chapters, ${kit.tags.length} tags` +
          `${kit.music ? `, music credited to ${kit.music.artist}` : ''})`,
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
  } finally {
    await releaseLock(paths).catch(() => {});
  }
}

async function synthesize(args: {
  narration: string;
  storyboard: Storyboard;
  module: AnyVideoModule;
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
  const existingVoice = (await exists(paths.voiceWav))
    ? paths.voiceWav
    : (await exists(paths.voiceMp3))
      ? paths.voiceMp3
      : null;

  if (args.reuseVoice && existingVoice) {
    const { getDurationSeconds } = await import('../video/ffprobe');
    const duration = await getDurationSeconds(existingVoice);
    const words = await readWordTimings(paths);
    logger.done('Reusing existing voice.mp3 (no TTS call)');
    return {
      audioPath: existingVoice,
      captionsPath: paths.captionsSrt,
      duration,
      words,
      isMock: false,
      voice: args.voiceOverride ?? config.tts.voice,
    };
  }

  const provider: TTSProvider = selectProvider(
    config,
    args.useMockTts,
    args.module.pacing,
    args.module.ttsTimeoutMs,
  );

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
  const volume = config.tts.volume;
  // Which locale is acceptable is the module's rule - English for a podcast,
  // Vietnamese for a fact short - and so is whether the check applies at all:
  // it only means anything for an engine whose voices are locale-prefixed ids,
  // and VieNeu names its voices ("Thái Sơn").
  args.module.assertVoiceUsable(voice, args.useMockTts ? 'mock' : config.tts.engine);

  const cache = new FileCache(path.join(config.runtimeDir, 'cache'));
  // Every input that changes how the audio sounds belongs in the key. Omitting
  // pitch would mean retuning the delivery silently replayed the old recording.
  const cacheKey = FileCache.key({
    provider: provider.name,
    text: narration,
    voice,
    rate,
    pitch,
    volume,
    // The speed is applied after synthesis, so two runs at different speeds
    // produce the same model output and different audio. Without this the
    // second one silently replays the first.
    speed: String(config.tts.speed),
    // Bumped when the *shape* of a cached entry changes rather than its audio.
    // v2 restores the script's punctuation into the word timings; without this
    // marker every project with a warm cache would keep serving the earlier,
    // punctuation-less timings and its captions would silently stay wrong.
    wordFormat: 'v2',
  });

  // Spec §54. This is the most valuable cache in the pipeline: the same line in
  // the same voice always sounds the same, so re-rendering after a caption or
  // animation tweak should not depend on a service that periodically refuses
  // to answer (see R1).
  const cached = await cache.get<CachedVoice>('tts', cacheKey);
  if (cached) {
    const cachedVoicePath = cached.value.audioExt === '.wav' ? paths.voiceWav : paths.voiceMp3;
    await cache.restore(cached, { voice: cachedVoicePath, captions: paths.captionsSrt });
    await writeFile(
      path.join(paths.audio, 'words.json'),
      `${JSON.stringify(cached.value.words, null, 2)}\n`,
      'utf8',
    );
    logger.done('Voice restored from cache (no TTS call)');
    return {
      audioPath: cachedVoicePath,
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
        language: languageOf(voice),
        // Both resolved above from config. Passing `storyboard.voice.voice`
        // here is what made the setting unchangeable, and omitting `pitch`
        // meant the delivery tuning never reached the synthesiser at all -
        // while the cache key recorded the requested values, so the stored
        // audio did not match its own key.
        voice,
        rate,
        pitch,
        volume,
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
      audioExt: path.extname(result.audioPath),
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

const isVertical = (config: AppConfig): boolean => config.video.height > config.video.width;

/**
 * Picks the narration engine.
 *
 * `vieneu` runs locally and is the default; `edge` is the fallback that needs
 * no model on disk; `mock` is silent audio for offline development and is never
 * publishable. Note that only VieNeu takes the speed setting - Edge is asked
 * for a rate instead, which it applies during synthesis.
 */
function selectProvider(
  config: AppConfig,
  useMockTts: boolean,
  pacing: Pacing,
  ttsTimeoutMs: number,
): TTSProvider {
  if (useMockTts || config.tts.engine === 'mock') {
    // Paced from the module's own measured words-per-minute, so a mock render
    // is the length the real one will be.
    return new MockTTSProvider(pacing.wordsPerMinute);
  }
  if (config.tts.engine === 'vieneu') {
    return new VieNeuTTSProvider(config.tts.vieneuPythonBin, config.tts.speed);
  }
  return new EdgeTTSProvider(config.tts.pythonBin, ttsTimeoutMs);
}

/**
 * Which frames to grab as candidate cover images.
 *
 * The first is the opening title card - the frame the video was designed to be
 * recognised by. The others are taken a little way into two scenes spread
 * across it, past their entry fade and their camera move's starting position,
 * so they are compositions rather than transitions.
 *
 * A cover image matters less for a Short than for an ordinary video, since the
 * feed plays the video itself rather than showing a thumbnail - but it is what
 * appears on the channel's Shorts tab, which is where a viewer who liked one
 * decides whether to watch a second.
 */
function pickThumbnailFrames(timeline: Timeline): number[] {
  const scenes = timeline.scenes;
  const first = scenes[0];
  const opening = first ? first.from + Math.floor(first.durationInFrames / 2) : 15;

  const candidates = [Math.floor(scenes.length * 0.35), Math.floor(scenes.length * 0.7)]
    .map((index) => scenes[index])
    .filter((scene): scene is (typeof scenes)[number] => Boolean(scene))
    .map((scene) => scene.from + Math.floor(scene.durationInFrames * 0.4));

  return [opening, ...candidates]
    .map((frame) => Math.min(frame, timeline.video.durationInFrames - 1))
    .filter((frame, index, all) => all.indexOf(frame) === index);
}

/**
 * Picks the background track, or decides there is none.
 *
 * Deliberately forgiving in one direction and strict in the other: an empty
 * music folder is a normal, silent-bed episode and passes quietly, while a
 * MUSIC_FILE naming something that is not there is a typo the operator wants
 * to hear about - it would otherwise render a whole episode without the music
 * they asked for and say nothing.
 */
async function resolveMusic(config: AppConfig, logger: Logger): Promise<string | null> {
  const entries = await readdir(config.music.dir).catch(() => [] as string[]);
  const tracks = entries.filter((name) => /\.(mp3|m4a|wav|ogg)$/iu.test(name)).sort();

  if (config.music.file) {
    if (!tracks.includes(config.music.file)) {
      throw new PipelineError(
        ERROR_CODES.PROJECT_NOT_FOUND,
        'render',
        `MUSIC_FILE is "${config.music.file}", which is not in ${config.music.dir}. ` +
          `Available: ${tracks.join(', ') || '(none)'}.`,
      );
    }
    return path.join(config.music.dir, config.music.file);
  }

  if (tracks.length === 0) {
    logger.done('No background music (assets/music is empty)');
    return null;
  }

  logger.done(`Music: ${tracks[0]}${tracks.length > 1 ? ` (+${tracks.length - 1} unused)` : ''}`);
  return path.join(config.music.dir, tracks[0]!);
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

export async function readInfoJson(filePath: string): Promise<ProductInfo | null> {
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

/**
 * brief.json is UI-authored free text, not a fact source, so a malformed file
 * is treated as "no brief" rather than failing the whole run.
 */
export async function readBriefJson(
  filePath: string,
  module: AnyVideoModule,
): Promise<Brief | null> {
  const raw = await readFile(filePath, 'utf8').catch(() => null);
  if (raw === null) return null;

  try {
    return module.parseBrief(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseStoryboard(raw: string, module: AnyVideoModule): Storyboard {
  let parsed: Storyboard;
  try {
    parsed = module.parseStoryboard(JSON.parse(raw));
  } catch (err) {
    throw new PipelineError(
      ERROR_CODES.INVALID_STORYBOARD,
      'generate-storyboard',
      `storyboard.json is not a valid ${module.label} storyboard: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      undefined,
      { cause: err },
    );
  }
  // The scene lines are the source of truth for what gets spoken, so any
  // top-level copy is recomputed rather than trusted.
  return withDerivedNarration(parsed);
}

/** script.txt: the readable version of what the video says. */
async function writeScript(paths: JobPaths, storyboard: Storyboard): Promise<void> {
  const body = [
    storyboard.project.episodeTitle,
    '',
    storyboard.content.summary,
    '',
    '---',
    '',
    ...storyboard.scenes.flatMap((s) => [
      `[${s.id}] ${s.title || '(no title)'}`,
      s.narration,
      '',
    ]),
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
