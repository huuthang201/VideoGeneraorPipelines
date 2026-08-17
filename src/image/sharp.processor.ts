import path from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import sharp from 'sharp';
import {
  MINIMUM_IMAGES,
  SUPPORTED_IMAGE_EXTENSIONS,
  classifyOrientation,
  type ProcessedImage,
} from '../domain/project';
import { ERROR_CODES, PipelineError } from '../domain/errors';

/**
 * Image preparation (spec §20-21).
 *
 * Two outputs come out of every source photo: a render-ready image, and a much
 * smaller preview used only as input to the model. The preview exists because
 * Claude has to look at the photos to decide which one suits which scene, and
 * feeding it 4000px originals burns a large amount of context for a judgement
 * that a 768px version supports just as well.
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

export async function processImages(options: ProcessImagesOptions): Promise<ProcessImagesResult> {
  const maxEdge = options.maxEdge ?? DEFAULTS.maxEdge;
  const previewEdge = options.previewEdge ?? DEFAULTS.previewEdge;

  const candidates = await listImageFiles(options.sourceDir);

  await mkdir(options.outputDir, { recursive: true });
  await mkdir(options.previewDir, { recursive: true });

  const images: ProcessedImage[] = [];
  const skipped: { filename: string; reason: string }[] = [];

  for (const filename of candidates) {
    const sourcePath = path.join(options.sourceDir, filename);

    try {
      // Everything downstream is normalised to jpeg: it keeps the staged bundle
      // small, and it means the renderer never meets a colour profile or alpha
      // channel it has to reason about.
      const outputName = `${path.parse(filename).name}.jpg`;
      const outputPath = path.join(options.outputDir, outputName);
      const previewPath = path.join(options.previewDir, outputName);

      // .rotate() with no argument applies the EXIF orientation tag and then
      // clears it. It must come before any resize: phone photos are frequently
      // stored landscape with a "rotate 90" tag, and resizing first would bake
      // in the wrong dimensions and hand the layout a sideways product.
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

      const info = await base
        .clone()
        .resize(resizeOptions)
        .jpeg({ quality: options.jpegQuality ?? DEFAULTS.jpegQuality, mozjpeg: true })
        .toFile(outputPath);

      await base
        .clone()
        .resize({ width: previewEdge, height: previewEdge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: options.previewQuality ?? DEFAULTS.previewQuality })
        .toFile(previewPath);

      images.push({
        filename: outputName,
        path: outputPath,
        width: info.width,
        height: info.height,
        aspectRatio: info.width / info.height,
        orientation: classifyOrientation(info.width, info.height),
        cutoutPath: null,
      });
    } catch (err) {
      skipped.push({
        filename,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (images.length < MINIMUM_IMAGES) {
    throw new PipelineError(
      ERROR_CODES.MINIMUM_IMAGES_NOT_MET,
      'process-images',
      `Expected at least ${MINIMUM_IMAGES} usable images, found ${images.length}`,
      { skipped, candidates: candidates.length },
    );
  }

  return { images, skipped };
}

/** Source images in stable order, so scene assignment is reproducible. */
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

/**
 * Confirms a file is a decodable image, used during input validation.
 *
 * Reads metadata rather than trusting the extension - a half-copied file has
 * the right name long before it has all its bytes, and this is what catches it
 * (spec §7).
 */
export async function probeImage(
  filePath: string,
): Promise<{ ok: true; width: number; height: number } | { ok: false; reason: string }> {
  try {
    const metadata = await sharp(filePath, { failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height) {
      return { ok: false, reason: 'no readable dimensions' };
    }
    return { ok: true, width: metadata.width, height: metadata.height };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
