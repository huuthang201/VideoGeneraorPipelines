import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import sharp from 'sharp';
import type { Storyboard } from '../../domain/storyboard';
import type { ProcessedImage, ProductInfo } from '../../domain/project';
import { classifyOrientation } from '../../domain/project';
import { BROLL_SIZE, type ComfyUIImageProvider } from '../../image/generation/comfyui.provider';
import type { Logger } from '../../utils/logger';
import { FileCache } from '../../utils/cache';
import { withRetry } from '../../utils/retry';
import { ERROR_CODES, PipelineError } from '../../domain/errors';

/**
 * Generates the images for `broll` scenes.
 *
 * The output is deliberately shaped to look exactly like a photograph the
 * seller supplied - same ProcessedImage record, same Sharp normalisation, same
 * directory conventions. Everything after this point (timeline builder, asset
 * staging, Remotion) stays unaware that some pictures were generated, which
 * keeps a sizeable feature from leaking into every downstream stage.
 *
 * The single place the distinction survives is `generated: true`, and that is
 * the point: a viewer cannot tell a generated frame from a photograph, so the
 * system has to be able to.
 */

export interface GenerateBrollInput {
  storyboard: Storyboard;
  info: ProductInfo | null;
  /** runtime/jobs/{id}/generated */
  outDir: string;
  cacheDir: string;
  provider: ComfyUIImageProvider;
  logger: Logger;
  /** Fraction of scenes allowed to be generated. */
  maxRatio: number;
}

export interface GenerateBrollResult {
  images: ProcessedImage[];
  /** Storyboard with each b-roll scene's asset pointing at its new file. */
  storyboard: Storyboard;
  /** Kept for job.json so the record of what was generated survives the run. */
  record: { sceneId: string; prompt: string; filename: string }[];
}

/** One retry: inference is slow, and a second failure rarely differs. */
const ATTEMPTS = 2;

export async function generateBroll(input: GenerateBrollInput): Promise<GenerateBrollResult> {
  const { storyboard, logger } = input;
  const brollScenes = storyboard.scenes.filter((s) => s.type === 'broll');

  if (brollScenes.length === 0) return { images: [], storyboard, record: [] };

  // A product video that is mostly invented imagery stops being a product
  // video. Checked before anything is generated, so an over-eager storyboard
  // fails in a second rather than after several minutes of inference.
  const ratio = brollScenes.length / storyboard.scenes.length;
  if (ratio > input.maxRatio) {
    throw new PipelineError(
      ERROR_CODES.IMAGE_PROMPT_REJECTED,
      'generate-broll',
      `${brollScenes.length} of ${storyboard.scenes.length} scenes are generated ` +
        `(${Math.round(ratio * 100)}%), above the ${Math.round(input.maxRatio * 100)}% ceiling. ` +
        'Most of a product video should show the actual product.',
    );
  }

  await mkdir(input.outDir, { recursive: true });
  const cache = new FileCache(input.cacheDir);

  const images: ProcessedImage[] = [];
  const record: GenerateBrollResult['record'] = [];
  const assetBySceneId = new Map<string, string>();

  for (const [index, scene] of brollScenes.entries()) {
    const prompt = (scene.imagePrompt ?? '').trim();
    const filename = `broll-${scene.id}.jpg`;
    const outPath = path.join(input.outDir, filename);
    const position = `${index + 1}/${brollScenes.length}`;

    // Each image costs a minute or more, so an unchanged prompt is never
    // regenerated. After the voice track this is the most valuable cache here.
    const cacheKey = FileCache.key({
      provider: input.provider.name,
      prompt,
      width: String(BROLL_SIZE.width),
      height: String(BROLL_SIZE.height),
    });

    const cached = await cache.get<{ filename: string }>('broll', cacheKey);

    if (cached) {
      await cache.restore(cached, { image: outPath });
      logger.done(`b-roll ${position}: ${scene.id} (cached)`);
    } else {
      logger.step(`b-roll ${position}: ${scene.id} - generating, this takes a minute`);

      const rawPath = path.join(input.outDir, `.raw-${scene.id}.png`);
      try {
        await withRetry(
          () =>
            input.provider.generateBackground({
              prompt,
              width: BROLL_SIZE.width,
              height: BROLL_SIZE.height,
              outPath: rawPath,
            }),
          {
            attempts: ATTEMPTS,
            initialDelayMs: 2000,
            // A rejected prompt is rejected identically next time; only
            // transport and inference faults are worth another minute.
            shouldRetry: (err) =>
              !(err instanceof PipelineError && err.code === ERROR_CODES.IMAGE_PROMPT_REJECTED),
            onRetry: (err, attempt) =>
              logger.warn(
                `b-roll ${scene.id} failed (${err instanceof Error ? err.message : String(err)}); ` +
                  `retry ${attempt}`,
              ),
          },
        );

        // Through the same encoder as a real photograph, so the two are
        // indistinguishable to everything downstream.
        await sharp(rawPath).jpeg({ quality: 88, mozjpeg: true }).toFile(outPath);
        await cache.set('broll', cacheKey, { filename }, { image: outPath });
      } finally {
        await rm(rawPath, { force: true });
      }

      logger.done(`b-roll ${position}: ${scene.id}`);
    }

    const meta = await sharp(outPath).metadata();
    const width = meta.width ?? BROLL_SIZE.width;
    const height = meta.height ?? BROLL_SIZE.height;

    images.push({
      filename,
      path: outPath,
      width,
      height,
      aspectRatio: width / height,
      orientation: classifyOrientation(width, height),
      cutoutPath: null,
      generated: true,
    });

    assetBySceneId.set(scene.id, filename);
    record.push({ sceneId: scene.id, prompt, filename });
  }

  // Point each b-roll scene at its new file so the timeline builder resolves it
  // exactly as it would any supplied photograph.
  const resolved: Storyboard = {
    ...storyboard,
    scenes: storyboard.scenes.map((scene) =>
      assetBySceneId.has(scene.id) ? { ...scene, asset: assetBySceneId.get(scene.id)! } : scene,
    ),
  };

  return { images, storyboard: resolved, record };
}
