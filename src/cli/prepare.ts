import path from 'node:path';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { jobPaths, type AppConfig } from '../config/env';
import type { Logger } from '../utils/logger';
import { listImageFiles, processImages } from '../image/sharp.processor';
import { ProductInfoSchema } from '../domain/project';
import { ERROR_CODES, PipelineError } from '../domain/errors';

/**
 * Brings a project from wherever it lives into runtime/jobs and prepares it for
 * inspection (spec §58, steps 4-5).
 *
 * Splitting this out of `generate` is what lets Claude Code look at the photos
 * before writing a storyboard, and look at *previews* rather than originals -
 * spec §58 has the model reading images straight off Drive at full size, which
 * spends a great deal of context on a judgement a 768px copy supports equally
 * well.
 *
 * The source folder is only ever read. Whatever is on Drive stays there, so a
 * crash here cannot cost the user their only copy of the photos.
 */

export interface PrepareInput {
  source: string;
  projectId: string;
  config: AppConfig;
  logger: Logger;
}

export interface PrepareResult {
  jobDir: string;
  previewDir: string;
  imageCount: number;
  hasInfoJson: boolean;
  assetFilenames: string[];
}

export async function prepareProject(input: PrepareInput): Promise<PrepareResult> {
  const paths = jobPaths(input.config.jobsDir, input.projectId);
  const sourceDir = path.resolve(input.source);

  const sourceImages = await listImageFiles(sourceDir);
  if (sourceImages.length === 0) {
    throw new PipelineError(
      ERROR_CODES.MINIMUM_IMAGES_NOT_MET,
      'validate',
      `No supported images found in ${sourceDir}`,
    );
  }

  await mkdir(paths.source, { recursive: true });
  for (const filename of sourceImages) {
    await cp(path.join(sourceDir, filename), path.join(paths.source, filename));
  }
  input.logger.done(`Copied ${sourceImages.length} source images`);

  const infoRaw = await readFile(path.join(sourceDir, 'info.json'), 'utf8').catch(() => null);
  if (infoRaw !== null) {
    const parsed = ProductInfoSchema.safeParse(JSON.parse(infoRaw));
    if (!parsed.success) {
      throw new PipelineError(
        ERROR_CODES.INVALID_INFO_JSON,
        'validate',
        `info.json is invalid:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
      );
    }
    await writeFile(paths.infoJson, `${JSON.stringify(parsed.data, null, 2)}\n`, 'utf8');
    input.logger.done('info.json validated');
  } else {
    input.logger.warn(
      'No info.json. The storyboard will run in strict mode: no prices, specs or claims may appear.',
    );
  }

  // An existing storyboard is carried across so a hand-written or previously
  // generated one survives re-preparation (spec §52 manual mode).
  const storyboardRaw = await readFile(path.join(sourceDir, 'storyboard.json'), 'utf8').catch(
    () => null,
  );
  if (storyboardRaw !== null) {
    await writeFile(paths.storyboardJson, storyboardRaw, 'utf8');
    input.logger.done('Existing storyboard.json carried over (Claude will be skipped)');
  }

  const { images, skipped } = await processImages({
    sourceDir: paths.source,
    outputDir: paths.images,
    previewDir: paths.preview,
  });
  for (const s of skipped) input.logger.warn(`skipped ${s.filename}: ${s.reason}`);

  return {
    jobDir: paths.root,
    previewDir: paths.preview,
    imageCount: images.length,
    hasInfoJson: infoRaw !== null,
    assetFilenames: images.map((i) => i.filename),
  };
}
