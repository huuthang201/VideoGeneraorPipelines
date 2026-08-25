import path from 'node:path';
import { cp, mkdir, rm } from 'node:fs/promises';
import sharp from 'sharp';
import type { LibraryPaths } from '../../../config/env';
import {
  MINIMUM_ASSETS,
  classifyOrientation,
  hasEnoughAssets,
  type LibraryCounts,
  type ProcessedImage,
} from '../../../domain/project';
import { ERROR_CODES, PipelineError } from '../../../domain/errors';
import { listImageFilesIfAny, processImages } from './sharp.processor';

/**
 * The shared backdrop library.
 *
 * There is one library for the whole system and every project draws from it.
 * That is the point of the design: a photograph is uploaded once and is then
 * available to every episode, rather than being copied into each project folder
 * and drifting.
 *
 * Consequently the expensive work - Sharp normalisation and preview
 * generation - happens at *import* time, not at render time. A project run only
 * reads what is already on disk (`readLibrary`), so a library that has grown to
 * two hundred backdrops does not make every subsequent render slower.
 */

export interface LibraryIndex {
  /** Backdrop filenames, in stable order. */
  environment: string[];
  counts: LibraryCounts;
  ready: boolean;
}

export interface LibraryContents extends LibraryIndex {
  images: ProcessedImage[];
}

export interface ImportResult {
  imported: ProcessedImage[];
  skipped: { filename: string; reason: string }[];
  library: LibraryContents;
}

/**
 * Copies a folder of images into the library and processes them.
 *
 * Additive by design: a second upload extends the library rather than replacing
 * it, which is what makes "add ten more backdrops" a thirty-second job instead
 * of a re-upload of everything.
 */
export async function importIntoLibrary(input: {
  paths: LibraryPaths;
  sourceDir: string;
  onWarn?: (message: string) => void;
}): Promise<ImportResult> {
  const { paths } = input;
  const sourceDir = path.resolve(input.sourceDir);

  const filenames = await listImageFilesIfAny(sourceDir);
  if (filenames.length === 0) {
    throw new PipelineError(
      ERROR_CODES.MINIMUM_IMAGES_NOT_MET,
      'validate',
      `No supported images found in ${sourceDir}`,
    );
  }

  const destSource = paths.sourceFor('environment');
  const destImages = paths.imagesFor('environment');
  const destPreview = paths.previewFor('environment');

  await mkdir(destSource, { recursive: true });
  for (const filename of filenames) {
    await cp(path.join(sourceDir, filename), path.join(destSource, filename));
  }

  // The whole folder is reprocessed rather than only the new files: it is cheap
  // relative to a render, and it repairs a library whose processed copies were
  // deleted or interrupted half way through an earlier import.
  const { images, skipped } = await processImages({
    sourceDir: destSource,
    outputDir: destImages,
    previewDir: destPreview,
  });

  for (const s of skipped) input.onWarn?.(`skipped ${s.filename}: ${s.reason}`);

  const importedNames = new Set(filenames.map((f) => path.parse(f).name));
  const imported = images.filter((img) => importedNames.has(path.parse(img.filename).name));

  return { imported, skipped, library: await readLibrary(paths) };
}

/**
 * Names and counts only - no image headers are read.
 *
 * This is what a screen needs. Keeping it separate from `readLibrary` means
 * listing projects stays cheap however far the library grows, since the UI asks
 * for this on every page load while only a render needs pixel dimensions.
 */
export async function readLibraryIndex(paths: LibraryPaths): Promise<LibraryIndex> {
  const environment = await listImageFilesIfAny(paths.imagesFor('environment'));
  const counts: LibraryCounts = { environment: environment.length };

  return { environment, counts, ready: hasEnoughAssets(counts) };
}

/**
 * Everything the library currently holds, including pixel dimensions.
 *
 * The directory is the source of truth, so a file deleted by hand disappears
 * from the library rather than lingering as an entry pointing at nothing.
 */
export async function readLibrary(paths: LibraryPaths): Promise<LibraryContents> {
  const index = await readLibraryIndex(paths);
  const images: ProcessedImage[] = [];

  for (const filename of index.environment) {
    const record = await describe(path.join(paths.imagesFor('environment'), filename), filename);
    if (record) images.push(record);
  }

  return { ...index, images };
}

/**
 * Removes one backdrop, original and processed copies alike.
 *
 * Deliberately blunt: a storyboard that referenced the deleted file will fail
 * loudly in the timeline builder rather than quietly rendering a hole. Since a
 * storyboard is cheap to regenerate and a wrong video is not, that is the right
 * way round.
 */
export async function removeFromLibrary(
  paths: LibraryPaths,
  filename: string,
): Promise<LibraryContents> {
  const stem = path.parse(filename).name;

  for (const dir of [
    paths.sourceFor('environment'),
    paths.imagesFor('environment'),
    paths.previewFor('environment'),
  ]) {
    for (const candidate of await listImageFilesIfAny(dir)) {
      if (path.parse(candidate).name === stem) {
        await rm(path.join(dir, candidate), { force: true });
      }
    }
  }

  return readLibrary(paths);
}

/** Throws the same error the pipeline would, saying what is missing. */
export function assertLibraryReady(library: LibraryContents): void {
  if (library.ready) return;

  throw new PipelineError(
    ERROR_CODES.MINIMUM_IMAGES_NOT_MET,
    'validate',
    `The shared library needs at least ${MINIMUM_ASSETS.environment} backdrop image.`,
    { counts: library.counts },
  );
}

async function describe(filePath: string, filename: string): Promise<ProcessedImage | null> {
  const meta = await sharp(filePath).metadata().catch(() => null);
  if (!meta?.width || !meta.height) return null;

  return {
    filename,
    path: filePath,
    kind: 'environment',
    width: meta.width,
    height: meta.height,
    aspectRatio: meta.width / meta.height,
    orientation: classifyOrientation(meta.width, meta.height),
  };
}
