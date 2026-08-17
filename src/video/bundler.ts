import path from 'node:path';
import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { bundle } from '@remotion/bundler';
import { ERROR_CODES, PipelineError } from '../domain/errors';

/**
 * Builds - and caches - the Remotion webpack bundle.
 *
 * Bundling costs 10-30 seconds, which is unacceptable per job when a batch may
 * hold dozens. The bundle only depends on the component source, never on the
 * product being rendered, so it is built once and reused until that source
 * changes. Per-job assets are added afterwards by asset-stage.ts, which is the
 * documented way to get files into an already-built bundle.
 */

const CACHE_DIR = path.join('runtime', 'cache', 'bundle');
const STAMP_FILE = path.join(CACHE_DIR, '.source-hash');
const BUNDLE_DIR = path.join(CACHE_DIR, 'out');

export interface BundleOptions {
  entryPoint?: string;
  /** Rebuilds even when the cached hash matches. */
  force?: boolean;
  onProgress?: (percent: number) => void;
}

export async function getBundle(options: BundleOptions = {}): Promise<string> {
  const entryPoint = options.entryPoint ?? path.join('src', 'remotion', 'index.ts');
  const hash = await hashRemotionSource();

  if (!options.force) {
    const cached = await readFile(STAMP_FILE, 'utf8').catch(() => null);
    if (cached?.trim() === hash) return path.resolve(BUNDLE_DIR);
  }

  await rm(BUNDLE_DIR, { recursive: true, force: true });
  await mkdir(CACHE_DIR, { recursive: true });

  let location: string;
  try {
    location = await bundle({
      entryPoint: path.resolve(entryPoint),
      outDir: path.resolve(BUNDLE_DIR),
      onProgress: options.onProgress,
    });
  } catch (err) {
    throw new PipelineError(
      ERROR_CODES.BUNDLE_FAILED,
      'render',
      `Could not bundle the Remotion project: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      { cause: err },
    );
  }

  await writeFile(STAMP_FILE, hash, 'utf8');
  return location;
}

/**
 * Hashes everything that can change what the bundle contains: component source
 * and the static assets copied in at bundle time (fonts especially - swapping a
 * font file without rebuilding would silently keep the old glyphs).
 */
async function hashRemotionSource(): Promise<string> {
  const hash = createHash('sha256');

  for (const dir of [path.join('src', 'remotion'), path.join('src', 'domain'), 'public']) {
    await hashDirectory(dir, hash);
  }

  // A Remotion upgrade changes rendering behaviour without touching our source.
  const pkg = await readFile('package.json', 'utf8').catch(() => '');
  hash.update(pkg);

  return hash.digest('hex');
}

async function hashDirectory(dir: string, hash: import('node:crypto').Hash): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

  // Sorted so the hash does not depend on filesystem enumeration order.
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);

    // Job assets are staged per render and must not invalidate the bundle.
    if (entry.isDirectory() && entry.name === 'jobs') continue;

    if (entry.isDirectory()) {
      await hashDirectory(full, hash);
    } else {
      hash.update(full);
      hash.update(await readFile(full));
    }
  }
}
