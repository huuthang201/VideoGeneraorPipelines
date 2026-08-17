import path from 'node:path';
import { cp, mkdir, rm } from 'node:fs/promises';

/**
 * Makes a job's images and audio reachable from inside an already-built bundle.
 *
 * Remotion serves `staticFile()` paths out of the `public/` directory *within
 * the bundle*, and only files present when the bundle was built are normally
 * available. The documented exception is the server-side rendering path: assets
 * copied into the bundle's public directory after the fact are served fine.
 * That is what makes bundle-once-render-many possible here (plan §2.7).
 *
 * Files are copied rather than symlinked. Symlinks are faster, but the dev
 * server resolves them relative to the bundle and a link pointing outside it is
 * not reliably followed - a copy of a few product photos is cheap next to
 * debugging why an image renders blank.
 */

export interface StagedAssets {
  /** Prefix to pass to staticFile(), e.g. "jobs/baseus-ma10". */
  publicPrefix: string;
  /** Absolute path of the staged directory, for cleanup. */
  stagedDir: string;
  cleanup: () => Promise<void>;
}

export interface StageAssetsInput {
  bundleLocation: string;
  projectId: string;
  /** Absolute source directories to copy in, keyed by their name in the bundle. */
  directories: Record<string, string>;
}

export async function stageAssets(input: StageAssetsInput): Promise<StagedAssets> {
  const publicPrefix = path.posix.join('jobs', input.projectId);
  const stagedDir = path.join(input.bundleLocation, 'public', 'jobs', input.projectId);

  // Clear any residue from an interrupted previous run so a stale image cannot
  // be picked up silently.
  await rm(stagedDir, { recursive: true, force: true });
  await mkdir(stagedDir, { recursive: true });

  for (const [name, sourceDir] of Object.entries(input.directories)) {
    await cp(sourceDir, path.join(stagedDir, name), { recursive: true });
  }

  return {
    publicPrefix,
    stagedDir,
    cleanup: async () => {
      await rm(stagedDir, { recursive: true, force: true });
    },
  };
}

/** Builds the staticFile() path for a job asset. */
export function assetSrc(publicPrefix: string, ...segments: string[]): string {
  return path.posix.join(publicPrefix, ...segments);
}
