import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { jobPaths, type AppConfig } from '../config/env';
import type { Logger } from '../utils/logger';
import { listImageFilesIfAny } from '../image/sharp.processor';
import { ProductInfoSchema } from '../domain/project';
import { ERROR_CODES, PipelineError } from '../domain/errors';

/**
 * Creates a project folder under runtime/jobs from a source directory.
 *
 * A project carries no images. Everything it shows comes from the shared
 * library (`src/image/library.ts`), so all this stage does is set up the job
 * folder and carry across the three files that *are* per project: info.json
 * (the fact whitelist), brief.json (the topic the video is built around) and
 * a hand-written storyboard.json if there is one.
 *
 * Images found in the source folder are reported and ignored on purpose. They
 * belong in the library, where every project can reach them, and silently
 * importing them from here would make it ambiguous which upload a component
 * came from.
 */

export interface PrepareInput {
  source: string;
  projectId: string;
  config: AppConfig;
  logger: Logger;
}

export interface PrepareResult {
  jobDir: string;
  hasInfoJson: boolean;
  hasBrief: boolean;
  hasStoryboard: boolean;
  /** Images sitting in the source folder that were not imported. */
  ignoredImages: number;
}

export async function prepareProject(input: PrepareInput): Promise<PrepareResult> {
  const paths = jobPaths(input.config.jobsDir, input.projectId);
  const sourceDir = path.resolve(input.source);

  await mkdir(paths.root, { recursive: true });

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
  }

  const briefRaw = await readFile(path.join(sourceDir, 'brief.json'), 'utf8').catch(() => null);
  if (briefRaw !== null) {
    await writeFile(paths.briefJson, briefRaw, 'utf8');
    input.logger.done('brief.json carried over');
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

  const strayImages = await listImageFilesIfAny(sourceDir);
  if (strayImages.length > 0) {
    input.logger.warn(
      `${strayImages.length} image(s) in ${sourceDir} were ignored. This engine finds its own ` +
        'photographs: the storyboard names what to search for and the pictures are downloaded ' +
        'at render time.',
    );
  }

  return {
    jobDir: paths.root,
    hasInfoJson: infoRaw !== null,
    hasBrief: briefRaw !== null,
    hasStoryboard: storyboardRaw !== null,
    ignoredImages: strayImages.length,
  };
}
