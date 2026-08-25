import { assertLibraryReady, readLibrary } from './image/library';
import type { Storyboard } from './domain/storyboard';
import type { Brief } from './domain/brief';
import { COMFORTABLE_ENVIRONMENTS } from '../../domain/project';
import { ERROR_CODES, PipelineError } from '../../domain/errors';
import { libraryPaths, type AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import { assetSrc } from '../../video/asset-stage';
import type { ResolvedBackdrops } from '../contract';
import type { SceneBackdrop } from '../../pipeline/build-timeline';

/**
 * The photographs for a podcast episode: uploaded once, drawn on by every
 * project.
 *
 * The opposite of the fact module in every way that matters. Nothing is
 * searched for and nothing is downloaded; the storyboard names a filename that
 * has to already exist, because the model was shown the previews and picked it.
 * A scene whose `environment` is not in the library is a hard failure rather
 * than something to substitute around - the model chose that photograph for
 * that paragraph, and quietly showing a different one is worse than stopping.
 *
 * No credits: these are the user's own photographs, so `credit` is null on
 * every scene and `ImageCredit` draws nothing.
 */
export async function resolveBackdrops(input: {
  storyboard: Storyboard;
  config: AppConfig;
  logger: Logger;
  brief: Brief | null;
}): Promise<ResolvedBackdrops> {
  const { storyboard, config } = input;
  const paths = libraryPaths(config.libraryDir);
  const library = await readLibrary(paths);

  // A scene is a backdrop, so a missing library is not a quality problem to
  // warn about - there is literally nothing to draw.
  assertLibraryReady(library);

  const byName = new Map(library.images.map((image) => [image.filename, image]));
  const backdrops = new Map<string, SceneBackdrop>();

  for (const scene of storyboard.scenes) {
    const image = byName.get(scene.environment);
    if (!image) {
      throw new PipelineError(
        ERROR_CODES.IMAGE_UNREADABLE,
        'process-images',
        `Scene "${scene.id}" uses environment "${scene.environment}", which is not among the ` +
          `processed environment images: ${library.images.map((i) => i.filename).join(', ')}`,
      );
    }
    backdrops.set(scene.id, { image, credit: null });
  }

  const distinct = new Set(storyboard.scenes.map((s) => s.environment)).size;

  return {
    backdrops,
    staging: {
      // The library's `images` directory already holds one sub-folder per kind,
      // and cp is recursive, so the (kind, filename) pair survives into the
      // bundle unchanged.
      directories: { images: paths.images },
    },
    imageSrcFor: (prefix, image) => assetSrc(prefix, 'images', 'environment', image.filename),
    summary:
      `Backdrops ready (${distinct} distinct across ${storyboard.scenes.length} scenes, ` +
      `library holds ${library.counts.environment})`,
  };
}

/**
 * Which backdrops this episode may draw on.
 *
 * Called before the storyboard rather than with it, because the model has to be
 * told what it may choose from. An absent or empty selection means the whole
 * library, which is what a new project gets - so a project does not silently
 * freeze its shortlist the day someone uploads a better photograph.
 */
export function resolveEnvironments(
  available: readonly string[],
  brief: Brief | null,
  logger: Logger,
): string[] {
  const wanted = brief?.environments ?? [];
  if (wanted.length === 0) return [...available];

  const chosen = wanted.filter((filename) => available.includes(filename));
  const missing = wanted.filter((filename) => !available.includes(filename));

  if (missing.length > 0) {
    logger.warn(
      `This project selected ${missing.length} backdrop(s) that are no longer in the library ` +
        `(${missing.join(', ')}); continuing without them.`,
    );
  }

  if (chosen.length === 0) {
    logger.warn('None of the selected backdrops still exist; using the whole library instead.');
    return [...available];
  }

  return chosen;
}

export { COMFORTABLE_ENVIRONMENTS };
