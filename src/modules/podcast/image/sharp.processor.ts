import path from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import sharp from 'sharp';
import {
  SUPPORTED_IMAGE_EXTENSIONS,
  classifyOrientation,
  type ProcessedImage,
} from '../../../domain/project';
import { ERROR_CODES, PipelineError } from '../../../domain/errors';

/**
 * Image preparation.
 *
 * Two outputs come out of every uploaded image: a render-ready copy, and a much
 * smaller preview used only as input to the model. The preview exists because
 * Claude has to look at the photographs to decide which one belongs under which
 * part of the script, and feeding it 4000px originals burns a large amount of
 * context for a judgement a 768px version supports just as well.
 *
 * Everything is a backdrop, so everything is encoded as JPEG: a full-frame
 * photograph has nothing behind it to show through, and JPEG at quality 88 is
 * markedly smaller than PNG for the same picture - which matters when a ten
 * minute episode stages twenty of them into the render bundle.
 */

export interface ProcessImagesOptions {
  sourceDir: string;
  outputDir: string;
  previewDir: string;
  /**
   * Longest edge of the render-ready image. 2160 gives 1080p output room to
   * push in for Ken Burns without resampling past the source detail.
   */
  maxEdge?: number;
  previewEdge?: number;
  previewQuality?: number;
  jpegQuality?: number;
}

export interface ProcessImagesResult {
  images: ProcessedImage[];
  /** Files that were present but unusable, with the reason. */
  skipped: { filename: string; reason: string }[];
}

const DEFAULTS = {
  maxEdge: 2160,
  previewEdge: 768,
  previewQuality: 70,
  jpegQuality: 88,
} as const;

/** Extension every processed copy is written with. */
export const PROCESSED_EXTENSION = '.jpg';

export async function processImages(options: ProcessImagesOptions): Promise<ProcessImagesResult> {
  const maxEdge = options.maxEdge ?? DEFAULTS.maxEdge;
  const previewEdge = options.previewEdge ?? DEFAULTS.previewEdge;

  const candidates = await listImageFiles(options.sourceDir).catch(() => [] as string[]);

  await mkdir(options.outputDir, { recursive: true });
  await mkdir(options.previewDir, { recursive: true });

  const images: ProcessedImage[] = [];
  const skipped: { filename: string; reason: string }[] = [];

  for (const filename of candidates) {
    const sourcePath = path.join(options.sourceDir, filename);

    try {
      const outputName = `${path.parse(filename).name}${PROCESSED_EXTENSION}`;
      const outputPath = path.join(options.outputDir, outputName);
      const previewPath = path.join(options.previewDir, outputName);

      // .rotate() with no argument applies the EXIF orientation tag and then
      // clears it. It must come before any resize: phone photos are frequently
      // stored landscape with a "rotate 90" tag, and resizing first would bake
      // in the wrong dimensions and hand the layout a sideways image.
      const base = sharp(sourcePath, { failOn: 'error' }).rotate();

      const metadata = await base.metadata();
      if (!metadata.width || !metadata.height) {
        skipped.push({ filename, reason: 'no readable dimensions' });
        continue;
      }

      const resizeOptions = {
        width: maxEdge,
        height: maxEdge,
        fit: 'inside' as const,
        // Never enlarge: upscaling adds no detail and only makes the staged
        // bundle bigger and the render slower.
        withoutEnlargement: true,
      };

      // Flattened before encoding: a PNG with transparency would otherwise come
      // out of jpeg with its transparent areas turned black, which reads as a
      // corrupt photograph rather than as an unsupported input.
      const encode = (pipeline: ReturnType<typeof sharp>, quality: number) =>
        pipeline.flatten({ background: '#000000' }).jpeg({ quality, mozjpeg: true });

      const info = await encode(
        base.clone().resize(resizeOptions),
        options.jpegQuality ?? DEFAULTS.jpegQuality,
      ).toFile(outputPath);

      await encode(
        base
          .clone()
          .resize({ width: previewEdge, height: previewEdge, fit: 'inside', withoutEnlargement: true }),
        options.previewQuality ?? DEFAULTS.previewQuality,
      ).toFile(previewPath);

      images.push({
        filename: outputName,
        path: outputPath,
        kind: 'environment',
        width: info.width,
        height: info.height,
        aspectRatio: info.width / info.height,
        orientation: classifyOrientation(info.width, info.height),
      });
    } catch (err) {
      skipped.push({
        filename,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { images, skipped };
}

/** Image files in stable order, so scene assignment is reproducible. */
export async function listImageFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => {
    throw new PipelineError(
      ERROR_CODES.PROJECT_NOT_FOUND,
      'validate',
      `Could not read image directory: ${dir}`,
    );
  });

  return entries
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .filter((name) =>
      (SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(path.extname(name).toLowerCase()),
    )
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/** Same as `listImageFiles` but treats a missing directory as empty. */
export async function listImageFilesIfAny(dir: string): Promise<string[]> {
  return listImageFiles(dir).catch(() => []);
}
