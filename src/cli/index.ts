#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { readdir, mkdir, rm } from 'node:fs/promises';
import { loadConfig, jobPaths } from '../config/env';
import { createLogger } from '../utils/logger';
import { runPipeline } from '../pipeline/video-pipeline';
import { validateOutput } from '../video/validator';
import { isPipelineError } from '../domain/errors';
import { prepareProject } from './prepare';
import { ClaudeCodeStoryboardProvider } from '../ai/claude-code.provider';

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
  .description('Run the full pipeline for one project')
  .action(async (job: string, opts: { force: boolean; mockTts: boolean }) => {
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
          storyboardSource: new ClaudeCodeStoryboardProvider(config, logger),
        }),
      logger,
    );
  });

program
  .command('regenerate-content')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .description('Discard the existing storyboard and ask Claude for a new one (spec §53)')
  .action(async (job: string) => {
    const config = loadConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(async () => {
      // Only this command spends a Claude call by design; `generate` reuses an
      // existing storyboard and `render` never calls the model at all.
      const paths = jobPaths(config.jobsDir, projectId);
      await rm(paths.storyboardJson, { force: true });
      logger.step('Existing storyboard discarded');

      await runPipeline({
        projectId,
        config,
        logger,
        force: true,
        storyboardSource: new ClaudeCodeStoryboardProvider(config, logger),
      });
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
