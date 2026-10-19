import { OpenverseProvider } from './image/stock/openverse.provider';
import {
  RoutedStockProvider,
  WikimediaCommonsProvider,
} from './image/stock/wikimedia.provider';
import { ARTICLE_PREFIX, ArticleImageProvider } from './image/stock/article.provider';
import { resolveSceneImages } from './image/stock/resolve';
import { reviewImages } from './review-images';
import type { AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import { assetSrc } from '../../video/asset-stage';
import type { ResolvedBackdrops } from '../contract';
import type { SceneBackdrop } from '../../pipeline/build-timeline';

/**
 * Searching for a video's photographs, for every module that searches.
 *
 * Which is now all of them, and that is why this takes scenes rather than a
 * storyboard. It was written for the fact short; when the podcast stopped
 * reading an uploaded library it grew a copy that differed only in its doc
 * comment, and a second copy of the ranking, the widening and the review is a
 * second copy to keep in step. Openverse does not care what language the
 * narration is in.
 *
 * What a module still owns is the *prompt* that writes the queries. An
 * episode's themes are moods and places, a short's are objects, and a
 * reportage's are the real river and the real mountain - none of which this
 * file has an opinion about.
 *
 * It runs *after* the storyboard on every module, which is the shape they now
 * share: the script names what it wants to be shot against and the engine goes
 * and finds it. So this is also where a job fails if the search is unreachable
 * or rate-limited.
 */
export interface SearchableScene {
  id: string;
  narration: string;
  imageQuery: string;
  /** Exact sources found for this scene alone. See `SceneImageRequest.extraQueries`. */
  extraQueries?: readonly string[];
}

export async function resolveSearchedBackdrops(input: {
  scenes: readonly SearchableScene[];
  config: AppConfig;
  logger: Logger;
  /** One line telling the review what kind of video it is choosing for. */
  reviewFormat?: string;
  /**
   * News articles whose photographs the channel owner has permission to use,
   * searched as `article:<url>` and offered to every review batch. Empty for
   * every ordinary run - see `ArticleImageProvider` for why this is opt-in.
   */
  permittedArticles?: readonly string[];
  /** See `ResolveInput.blankScenes`. A short leaves it at the default. */
  blankScenes?: 'tiers' | 'reuse';
  /** See `ResolveInput.storyboardQueries`. False only for an event-only video. */
  storyboardQueries?: boolean;
  /** See `ResolveInput.maxUses`. */
  maxUses?: number;
}): Promise<ResolvedBackdrops> {
  const { scenes, config, logger } = input;

  const resolved = await resolveSceneImages({
    scenes: scenes.map((scene) => ({
      sceneId: scene.id,
      query: scene.imageQuery,
      ...(scene.extraQueries?.length ? { extraQueries: scene.extraQueries } : {}),
    })),
    /*
     * Two sources, chosen per query rather than merged.
     *
     * Openverse answers "a photograph of a mountain river", which is what most
     * scenes want. A query prefixed `commons:` asks Wikimedia Commons directly,
     * and exists for the one thing a stock library cannot do: return a picture
     * of *this* event. Openverse rebuilds its Commons index on its own
     * schedule, so a disaster from last week is in Commons and not yet in
     * Openverse - measured on the 2026 Nepal flood, where Openverse had nothing
     * and Commons had fourteen files.
     */
    provider: new RoutedStockProvider(
      new OpenverseProvider(config.stock.token, config.stock.sources, {
        shareAlike: config.stock.allowShareAlike,
      }),
      new WikimediaCommonsProvider({ shareAlike: config.stock.allowShareAlike }),
      input.permittedArticles?.length ? new ArticleImageProvider() : null,
      { shareAlike: config.stock.allowShareAlike },
    ),
    pinnedQueries: (input.permittedArticles ?? []).map((url) => `${ARTICLE_PREFIX}${url}`),
    blankScenes: input.blankScenes ?? 'tiers',
    ...(input.storyboardQueries === false ? { storyboardQueries: false } : {}),
    ...(input.maxUses ? { maxUses: input.maxUses } : {}),
    // The frame this video is actually rendered at, so a landscape episode is
    // not offered portrait photographs and a vertical short is not offered
    // wide ones. Read from config rather than from the storyboard, which is the
    // same rule `runPipeline` follows when it overwrites the frame size.
    frameAspect: config.video.width / config.video.height,
    cacheDir: config.stock.cacheDir,
    fallbackQuery: config.stock.fallbackQuery,
    onProgress: (message) => logger.step(`  ${message}`),
    onWarn: (message) => logger.warn(message),
    // The scenes are closed over rather than threaded through the resolver,
    // which has no business knowing what a scene says - it deals in queries.
    review: config.stock.review
      ? ({ directory, candidates, sceneIds, reuse }) => {
          // Only the batch's own scenes. Handing the model all ninety-one and
          // asking it about twelve is how a review starts assigning pictures to
          // scenes it was not shown candidates for.
          const wanted = new Set(sceneIds);
          return reviewImages(config, logger, {
            directory,
            candidates,
            scenes: scenes.filter((scene) => wanted.has(scene.id)),
            format: input.reviewFormat,
            reuse,
          });
        }
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
