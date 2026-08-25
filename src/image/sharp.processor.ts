import { readdir } from 'node:fs/promises';
import { SUPPORTED_IMAGE_EXTENSIONS } from '../domain/project';

/**
 * What is left of the image-import stage.
 *
 * There used to be a whole Sharp pipeline here: a folder of uploaded
 * photographs went in, and normalised render copies plus 768px previews came
 * out. None of that survives, because nobody uploads photographs any more - the
 * engine searches for them and `src/image/stock/resolve.ts` does the same
 * normalisation on what it downloads.
 *
 * This one function remains for a single purpose: telling somebody who dropped
 * images into a project folder, expecting the old behaviour, that nothing is
 * going to happen to them.
 */

/** Image files in stable order. A missing directory is simply empty. */
export async function listImageFilesIfAny(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) =>
      SUPPORTED_IMAGE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension)),
    )
    .sort();
}
