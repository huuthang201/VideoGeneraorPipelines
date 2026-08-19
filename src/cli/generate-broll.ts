import path from 'node:path';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { jobPaths, type AppConfig } from '../config/env';
import type { Logger } from '../utils/logger';
import { ProductInfoSchema, type ProductInfo } from '../domain/project';
import { readFile } from 'node:fs/promises';
import { deriveBrollPrompts } from '../ai/broll-prompts';
import { BROLL_SIZE, ComfyUIImageProvider } from '../image/generation/comfyui.provider';
import { FileCache } from '../utils/cache';
import { ERROR_CODES, PipelineError } from '../domain/errors';

/**
 * Generates context images ahead of the storyboard, from a description.
 *
 * Doing this before the script rather than during the render is a deliberate
 * inversion of the first design. Generating mid-render meant the operator only
 * saw the images once the video existed, and a bad one cost a whole rebuild.
 * Generated up front, they can be looked at, deleted and regenerated cheaply,
 * and the model writes the script already knowing what footage it has.
 */

export interface GenerateBrollCommandInput {
  projectId: string;
  description: string;
  count: number;
  config: AppConfig;
  logger: Logger;
}

export interface GeneratedBrollImage {
  filename: string;
  scene: string;
  prompt: string;
}

/** Sidecar describing what each generated file is, for the UI and the model. */
export const BROLL_MANIFEST = 'broll.json';

export async function generateBrollImages(
  input: GenerateBrollCommandInput,
): Promise<GeneratedBrollImage[]> {
  const { config, logger } = input;
  const paths = jobPaths(config.jobsDir, input.projectId);

  if (config.image.engine === 'none') {
    throw new PipelineError(
      ERROR_CODES.IMAGE_GENERATION_UNAVAILABLE,
      'generate-broll',
      'Image generation is off. Set IMAGE_ENGINE=comfyui in .env.',
    );
  }

  const info = await readInfo(paths.infoJson);
  const provider = new ComfyUIImageProvider({
    pythonBin: 'python3',
    serverUrl: config.image.comfyuiServer,
    info,
    onLog: (m) => logger.debug(m),
  });

  if (!(await provider.isAvailable())) {
    throw new PipelineError(
      ERROR_CODES.IMAGE_GENERATION_UNAVAILABLE,
      'generate-broll',
      `ComfyUI is not running at ${config.image.comfyuiServer}.\n` +
        'Start it with:  cd ~/ComfyUI && ./venv/bin/python3 main.py',
    );
  }

  // The model looks at whatever photographs exist so the generated scenes match
  // their setting - and so a character reference, if one was uploaded, can be
  // described consistently across every prompt.
  const hasPreviews = await readdir(paths.preview)
    .then((f) => f.length > 0)
    .catch(() => false);

  logger.step(`Deriving ${input.count} image prompt(s) from the description`);
  const derived = await deriveBrollPrompts({
    description: input.description,
    count: input.count,
    info,
    referenceDir: hasPreviews ? paths.preview : null,
    config,
    logger,
  });

  await mkdir(paths.generated, { recursive: true });
  const cache = new FileCache(path.join(config.runtimeDir, 'cache'));

  const existing = await readManifest(paths.generated);
  const results: GeneratedBrollImage[] = [...existing];

  for (const [index, item] of derived.entries()) {
    const slot = existing.length + index + 1;
    const filename = `broll-${String(slot).padStart(2, '0')}.jpg`;
    const outPath = path.join(paths.generated, filename);
    const position = `${index + 1}/${derived.length}`;

    const cacheKey = FileCache.key({
      provider: provider.name,
      prompt: item.prompt,
      width: String(BROLL_SIZE.width),
      height: String(BROLL_SIZE.height),
    });

    const cached = await cache.get<{ filename: string }>('broll', cacheKey);
    if (cached) {
      await cache.restore(cached, { image: outPath });
      logger.done(`${position} ${item.scene} (cached)`);
    } else {
      logger.step(`${position} ${item.scene} - generating, about a minute`);
      const rawPath = path.join(paths.generated, `.raw-${slot}.png`);
      try {
        await provider.generateBackground({
          prompt: item.prompt,
          width: BROLL_SIZE.width,
          height: BROLL_SIZE.height,
          outPath: rawPath,
        });
        await sharp(rawPath).jpeg({ quality: 88, mozjpeg: true }).toFile(outPath);
        await cache.set('broll', cacheKey, { filename }, { image: outPath });
      } finally {
        await rm(rawPath, { force: true });
      }
      logger.done(`${position} ${item.scene}`);
    }

    results.push({ filename, scene: item.scene, prompt: item.prompt });
  }

  await writeManifest(paths.generated, results);
  return results;
}

export async function readManifest(generatedDir: string): Promise<GeneratedBrollImage[]> {
  const raw = await readFile(path.join(generatedDir, BROLL_MANIFEST), 'utf8').catch(() => null);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as GeneratedBrollImage[];
  } catch {
    return [];
  }
}

async function writeManifest(
  generatedDir: string,
  images: readonly GeneratedBrollImage[],
): Promise<void> {
  await writeFile(
    path.join(generatedDir, BROLL_MANIFEST),
    `${JSON.stringify(images, null, 2)}\n`,
    'utf8',
  );
}

/** Removes one generated image and forgets it in the manifest. */
export async function deleteBrollImage(generatedDir: string, filename: string): Promise<void> {
  await rm(path.join(generatedDir, filename), { force: true });
  const remaining = (await readManifest(generatedDir)).filter((i) => i.filename !== filename);
  await writeManifest(generatedDir, remaining);
}

async function readInfo(infoPath: string): Promise<ProductInfo | null> {
  const raw = await readFile(infoPath, 'utf8').catch(() => null);
  if (!raw) return null;
  const parsed = ProductInfoSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}
