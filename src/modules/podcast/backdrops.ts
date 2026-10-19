import { resolveSearchedBackdrops } from '../shorts/backdrops';
import type { Storyboard } from './domain/storyboard';
import type { AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import type { ResolvedBackdrops } from '../contract';

/**
 * The photographs for an episode.
 *
 * This module used to read a shared library that somebody had filled by hand,
 * and that shaped everything upstream of it - the model had to *look at* the
 * photographs before it could choose a subject, so pictures came before the
 * script. Now the script comes first and names what it wants to be shot
 * against, which is the same order every other module uses - so the search
 * itself is shared, and this file is only the adapter from this module's scene
 * shape to it.
 */
export function resolveBackdrops(input: {
  storyboard: Storyboard;
  config: AppConfig;
  logger: Logger;
}): Promise<ResolvedBackdrops> {
  return resolveSearchedBackdrops({
    scenes: input.storyboard.scenes.map((scene) => ({
      id: scene.id,
      narration: scene.narration,
      imageQuery: scene.imageQuery,
    })),
    config: input.config,
    logger: input.logger,
  });
}
