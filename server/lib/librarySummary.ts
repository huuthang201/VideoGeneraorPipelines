import { libraryPaths, type AppConfig } from '../../src/config/env';
import {
  readLibraryIndex,
  type LibraryIndex,
} from '../../src/modules/podcast/image/library';

/**
 * What the shared libraries hold, as the UI sees them.
 *
 * Names and counts only: the projects screen asks for this on every load, and
 * reading image headers for a library of a hundred poses to render a badge
 * would be a waste.
 */
export async function readLibrarySummary(config: AppConfig): Promise<LibraryIndex> {
  return readLibraryIndex(libraryPaths(config.libraryDir));
}
