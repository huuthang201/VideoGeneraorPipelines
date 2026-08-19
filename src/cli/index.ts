#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { readdir, mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { loadConfig, jobPaths, type AppConfig } from '../config/env';
import { createLogger } from '../utils/logger';
import { runPipeline, readInfoJson, type PipelineResult } from '../pipeline/video-pipeline';
import { validateOutput } from '../video/validator';
import { ERROR_CODES, PipelineError, isPipelineError } from '../domain/errors';
import { listImageFiles } from '../image/sharp.processor';
import { prepareProject } from './prepare';
import { generateBrollImages } from './generate-broll';
import { ClaudeCodeStoryboardProvider } from '../ai/claude-code.provider';
import { suggestBrief } from '../ai/suggest-brief.provider';
import { LocalDriveStorageProvider } from '../storage/local-drive.provider';
import { shutdownVieNeu } from '../tts/vieneu.provider';

/**
 * The single entry point (spec §57). Everything - a person at a terminal,
 * Claude Code following the Drive workflow, a future Cowork layer - drives the
 * engine through these commands, so there is one behaviour to reason about
 * rather than one per caller.
 */

const program = new Command();

program
  .name('video-maker')
  .description('Turn a folder of product photos into a 9:16 short with Vietnamese narration')
  .version('0.1.0');

program
  .command('prepare')
  .argument('<source>', 'folder of product images (typically under 01_INPUT)')
  .option('--id <projectId>', 'project id; defaults to the source folder name')
  .description('Copy a project into runtime/jobs and generate images plus AI previews')
  .action(async (source: string, opts: { id?: string }) => {
    const config = loadConfig();
    const projectId = opts.id ?? path.basename(path.resolve(source));
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(async () => {
      const result = await prepareProject({ source, projectId, config, logger });
      logger.done(`Prepared ${result.imageCount} images → ${result.jobDir}`);
    }, logger);
  });

program
  .command('generate')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .option('--force', 'rebuild even when nothing changed', false)
  .option('--mock-tts', 'use placeholder narration instead of calling Edge TTS', false)
  .option('--no-publish', 'leave the output in runtime/jobs instead of copying to 03_OUTPUT')
  .option('--voice <name>', 'override TTS_VOICE for this run, e.g. vi-VN-NamMinhNeural')
  .option('--no-broll', 'build from the supplied photographs only, skipping AI b-roll')
  .description('Run the full pipeline for one project')
  .action(
    async (
      job: string,
      opts: { force: boolean; mockTts: boolean; publish: boolean; voice?: string; broll: boolean },
    ) => {
    const config = loadConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(
      () =>
        runPipeline({
          projectId,
          config,
          logger,
          force: opts.force,
          useMockTts: opts.mockTts,
          publish: opts.publish,
          voiceOverride: opts.voice,
          noBroll: !opts.broll,
          storyboardSource: new ClaudeCodeStoryboardProvider(config, logger),
        }),
      logger,
    );
  },
);

program
  .command('generate-broll')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .requiredOption('--description <text>', 'what the video is about, in Vietnamese or English')
  .option('--count <n>', 'how many images to generate', '3')
  .description('Generate context images from a description, before writing the script')
  .action(async (job: string, opts: { description: string; count: string }) => {
    const config = loadConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(async () => {
      const count = Math.max(1, Math.min(8, Number.parseInt(opts.count, 10) || 3));
      const images = await generateBrollImages({
        projectId,
        description: opts.description,
        count,
        config,
        logger,
      });
      logger.done(`${images.length} context image(s) ready`);
    }, logger);
  });

program
  .command('publish')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .description('Copy an already-rendered project to DRIVE_ROOT/03_OUTPUT')
  .action(async (job: string) => {
    const config = loadConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(async () => {
      const paths = jobPaths(config.jobsDir, projectId);
      const storage = new LocalDriveStorageProvider(config.driveRoot);
      await storage.ensureLayout();
      const target = await storage.publish(projectId, paths.output);
      logger.done(`Published → ${target.describe}`);
    }, logger);
  });

program
  .command('list')
  .description('Show every project in 01_INPUT and whether it has been published')
  .action(async () => {
    const config = loadConfig();
    const storage = new LocalDriveStorageProvider(config.driveRoot);
    await storage.ensureLayout();

    const projects = await storage.listPending();
    if (projects.length === 0) {
      console.log(`No projects in ${config.driveRoot}/01_INPUT`);
      return;
    }

    for (const projectId of projects) {
      const published = await storage.isPublished(projectId);
      console.log(`  ${published ? 'DONE   ' : 'PENDING'}  ${projectId}`);
    }
  });

program
  .command('regenerate-content')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .description('Discard the existing storyboard and ask Claude for a new one, then re-render (spec §53)')
  .action(async (job: string) => {
    const config = loadConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(() => regenerateStoryboard(projectId, config, logger, { storyboardOnly: false }), logger);
  });

program
  .command('generate-storyboard')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .description('Ask Claude for a new storyboard only (no TTS, no render); archives it as a new version')
  .action(async (job: string) => {
    const config = loadConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(() => regenerateStoryboard(projectId, config, logger, { storyboardOnly: true }), logger);
  });

program
  .command('suggest-brief')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .description('Look at the product photos and draft a context + hook suggestion (writes brief.json)')
  .action(async (job: string) => {
    const config = loadConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(async () => {
      const paths = jobPaths(config.jobsDir, projectId);
      const assetFilenames = await listImageFiles(paths.preview).catch(() => []);
      if (assetFilenames.length === 0) {
        throw new PipelineError(
          ERROR_CODES.PROJECT_NOT_FOUND,
          'suggest-brief',
          `No processed preview images in ${paths.preview}. Run "prepare" first.`,
        );
      }

      const info = await readInfoJson(paths.infoJson);
      const suggestion = await suggestBrief(config, logger, {
        previewDir: paths.preview,
        assetFilenames,
        info,
      });

      await writeFile(paths.briefJson, `${JSON.stringify(suggestion, null, 2)}\n`, 'utf8');
      logger.done(`brief.json written → ${paths.briefJson}`);
    }, logger);
  });

program
  .command('render')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .option('--mock-tts', 'use placeholder narration if no voice track exists', false)
  .description('Re-render from the existing storyboard and voice track (no Claude, no TTS)')
  .action(async (job: string, opts: { mockTts: boolean }) => {
    const config = loadConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(
      () =>
        runPipeline({
          projectId,
          config,
          logger,
          force: true,
          reuseVoice: true,
          useMockTts: opts.mockTts,
        }),
      logger,
    );
  });

program
  .command('generate-all')
  .option('--force', 'rebuild even when nothing changed', false)
  .option('--mock-tts', 'use placeholder narration instead of calling Edge TTS', false)
  .description('Run the pipeline for every project under runtime/jobs')
  .action(async (opts: { force: boolean; mockTts: boolean }) => {
    const config = loadConfig();
    const logger = createLogger({ level: config.logLevel });

    await mkdir(config.jobsDir, { recursive: true });
    const entries = await readdir(config.jobsDir, { withFileTypes: true });
    const projects = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    if (projects.length === 0) {
      logger.warn(`No projects found in ${config.jobsDir}`);
      return;
    }

    // Spec §56: one project failing must not stop the rest. Each is isolated
    // and the run reports a summary at the end rather than aborting.
    let succeeded = 0;
    const failed: string[] = [];

    for (const projectId of projects) {
      const projectLogger = logger.forProject(projectId);
      try {
        await runPipeline({
          projectId,
          config,
          logger: projectLogger,
          force: opts.force,
          useMockTts: opts.mockTts,
          storyboardSource: new ClaudeCodeStoryboardProvider(config, projectLogger),
        });
        succeeded++;
      } catch (err) {
        failed.push(projectId);
        projectLogger.error(describeError(err));
      }
    }

    // One worker served the whole batch; it goes down with the batch, not with
    // each video.
    await shutdownVieNeu().catch(() => {});

    logger.done(`Batch finished: ${succeeded} succeeded, ${failed.length} failed`);
    if (failed.length > 0) {
      logger.warn(`Failed: ${failed.join(', ')}`);
      process.exitCode = 1;
    }
  });

program
  .command('validate')
  .argument('<video>', 'path to an MP4')
  .description('Check an output file against the spec §39 requirements')
  .action(async (video: string) => {
    const config = loadConfig();
    const logger = createLogger({ level: config.logLevel });

    const report = await validateOutput(video, {
      expectedWidth: config.video.width,
      expectedHeight: config.video.height,
      minDurationSec: 5,
    });

    const m = report.measured;
    console.log(`  size          : ${(m.sizeBytes / 1e6).toFixed(2)} MB`);
    console.log(`  resolution    : ${m.width ?? '?'}x${m.height ?? '?'}`);
    console.log(`  video codec   : ${m.videoCodec ?? 'NONE'}`);
    console.log(`  audio codec   : ${m.audioCodec ?? 'NONE'}`);
    console.log(`  duration      : ${m.durationSec.toFixed(2)}s`);
    console.log(
      `  silence ratio : ${Number.isNaN(m.silenceRatio) ? 'unmeasurable' : `${(m.silenceRatio * 100).toFixed(1)}%`}`,
    );

    for (const warning of report.warnings) logger.warn(warning);

    if (report.ok) {
      logger.done('Valid');
    } else {
      for (const problem of report.problems) logger.error(`${problem.code}: ${problem.message}`);
      process.exitCode = 1;
    }
  });

/**
 * Shared by `regenerate-content` and `generate-storyboard`: both must force a
 * fresh Claude call even when a storyboard.json already exists, which means
 * setting the existing file aside first (spec §53) - `runPipeline` only calls
 * the AI when none is present. The only difference between the two commands
 * is whether the pipeline continues on to TTS/render afterwards.
 */
async function regenerateStoryboard(
  projectId: string,
  config: AppConfig,
  logger: ReturnType<typeof createLogger>,
  opts: { storyboardOnly: boolean },
): Promise<PipelineResult> {
  const paths = jobPaths(config.jobsDir, projectId);
  const backup = `${paths.storyboardJson}.previous`;

  // Set aside rather than delete. Deleting first meant a rejected
  // regeneration left the project with no storyboard at all - strictly worse
  // than the one it had been asked to improve on, and the working copy was
  // gone.
  const had = await rename(paths.storyboardJson, backup).then(
    () => true,
    () => false,
  );
  if (had) logger.step('Existing storyboard set aside');

  try {
    const result = await runPipeline({
      projectId,
      config,
      logger,
      force: true,
      storyboardOnly: opts.storyboardOnly,
      storyboardSource: new ClaudeCodeStoryboardProvider(config, logger),
    });
    await rm(backup, { force: true });
    return result;
  } catch (err) {
    if (had) {
      await rename(backup, paths.storyboardJson).catch(() => {});
      logger.warn('Regeneration failed; restored the previous storyboard');
    }
    throw err;
  }
}

/**
 * Accepts either a path or a bare id, because the two callers naturally use
 * different forms: spec §57 shows Claude Code passing a path, while a person at
 * a terminal reaches for the project name.
 */
function resolveProjectId(input: string, jobsDir: string): string {
  const resolved = path.resolve(input);
  if (resolved.startsWith(path.resolve(jobsDir))) return path.basename(resolved);
  if (!input.includes(path.sep)) return input;
  return path.basename(resolved);
}

async function run(fn: () => Promise<unknown>, logger: ReturnType<typeof createLogger>) {
  try {
    await fn();
  } catch (err) {
    logger.error(describeError(err));
    process.exitCode = 1;
  } finally {
    // The TTS worker holds a neural model in memory and outlives the command
    // that started it unless it is told to stop. Two orphans were found still
    // resident after a day of runs - each one several hundred megabytes doing
    // nothing.
    await shutdownVieNeu().catch(() => {});
  }
}

function describeError(err: unknown): string {
  if (isPipelineError(err)) return `${err.code} at ${err.stage}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

// Spec §56: a stray rejection anywhere must be logged, not left to kill the
// process silently mid-batch.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exitCode = 1;
});

program.parseAsync(process.argv);
