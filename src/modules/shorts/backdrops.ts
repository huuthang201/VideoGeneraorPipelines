import { OpenverseProvider } from './image/stock/openverse.provider';
import { resolveSceneImages } from './image/stock/resolve';
import { reviewImages } from './review-images';
import type { Storyboard } from './domain/storyboard';
import type { AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import { assetSrc } from '../../video/asset-stage';
import type { ResolvedBackdrops } from '../contract';
import type { SceneBackdrop } from '../../pipeline/build-timeline';

/**
 * The photographs for a fact short: searched for, not uploaded.
 *
 * This runs *after* the storyboard, which is the whole shape of this module:
 * the script names what it wants to be shot against, and the engine goes and
 * finds it. There is no library to check first, so this is also where a job
 * fails if the search is unreachable or rate-limited.
 */
export async function resolveBackdrops(input: {
  storyboard: Storyboard;
  config: AppConfig;
  logger: Logger;
}): Promise<ResolvedBackdrops> {
  const { storyboard, config, logger } = input;

  const resolved = await resolveSceneImages({
    scenes: storyboard.scenes.map((scene) => ({ sceneId: scene.id, query: scene.imageQuery })),
    provider: new OpenverseProvider(config.stock.token, config.stock.sources),
    cacheDir: config.stock.cacheDir,
    fallbackQuery: config.stock.fallbackQuery,
    onProgress: (message) => logger.step(`  ${message}`),
    onWarn: (message) => logger.warn(message),
    // The scenes are closed over rather than threaded through the resolver,
    // which has no business knowing what a scene says - it deals in queries.
    review: config.stock.review
      ? ({ directory, candidates }) =>
          reviewImages(config, logger, {
            directory,
            candidates,
            scenes: storyboard.scenes.map((scene) => ({
              id: scene.id,
              narration: scene.narration,
              imageQuery: scene.imageQuery,
            })),
          })
      : undefined,
  });

  const backdrops = new Map<string, SceneBackdrop>(
    resolved.images.map((entry) => [entry.sceneId, { image: entry.image, credit: entry.credit }]),
  );

  return {
    backdrops,
    staging: {
      // Only this video's photographs, named by file. The stock cache is
      // shared and grows with every video ever made, so copying the whole
      // directory in would make every render slower than the last.
      files: Object.fromEntries(
        resolved.images.map((entry) => [`images/${entry.image.filename}`, entry.image.path]),
      ),
    },
    imageSrcFor: (prefix, image) => assetSrc(prefix, 'images', image.filename),
    summary:
      `Photographs ready (${resolved.images.length} scene(s), ` +
      `${resolved.searchesPerformed} search(es) hit the network` +
      `${config.stock.review ? `, ${resolved.reviewed} placed by review` : ''})`,
  };
}
