import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { exec } from '../../utils/exec';
import type { BackgroundRemovalProvider } from './provider';

/**
 * Cutouts via rembg, run as a subprocess (spec §25).
 *
 * Deliberately not a hard dependency: rembg pulls onnxruntime and a few hundred
 * megabytes of model weights, which is a lot of install surface for a feature
 * that is off by default. `npm run setup:python` does not install it; a user
 * who wants cutouts installs it into the same venv themselves.
 *
 * Every failure path returns the original image. A missing binary, a model
 * download failure, a timeout, a corrupt output - none of them may fail the
 * video, because the product photo on its own is a perfectly acceptable result.
 */
export class RembgProvider implements BackgroundRemovalProvider {
  readonly name = 'rembg';
  readonly enabled = true;

  constructor(
    private readonly pythonBin: string,
    private readonly onWarn: (message: string) => void = () => {},
  ) {}

  async removeBackground(imagePath: string, outPath: string): Promise<string> {
    try {
      await mkdir(path.dirname(outPath), { recursive: true });

      const result = await exec(
        this.pythonBin,
        ['-m', 'rembg', 'i', imagePath, outPath],
        // Generous: the first invocation downloads a model. Still bounded, so a
        // hung process cannot stall the queue indefinitely.
        { timeoutMs: 180_000 },
      );

      if (result.code !== 0) {
        this.onWarn(
          `rembg failed for ${path.basename(imagePath)} (exit ${result.code}); using the original image`,
        );
        return imagePath;
      }

      return outPath;
    } catch (err) {
      this.onWarn(
        `rembg unavailable for ${path.basename(imagePath)} (${
          err instanceof Error ? err.message : String(err)
        }); using the original image`,
      );
      return imagePath;
    }
  }
}
