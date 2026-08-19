import path from 'node:path';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { JobPaths } from '../config/env';

/**
 * Version history for storyboard.json. The pipeline only ever reads the
 * active `storyboard.json` (spec's manual/ai mode split is unaffected), but
 * every time a fresh one is generated a copy is archived here so the UI can
 * list past attempts and let a user revert to one instead of losing it the
 * moment a regeneration overwrites the active file.
 */
export interface StoryboardVersionMeta {
  filename: string;
  createdAt: string;
}

const SAFE_FILENAME = /^[0-9A-Za-z_.-]+\.json$/;

function timestampFilename(): string {
  return `${new Date().toISOString().replace(/:/g, '-')}.json`;
}

export async function saveStoryboardVersion(paths: JobPaths, storyboardRaw: string): Promise<string> {
  await mkdir(paths.storyboardVersions, { recursive: true });
  const filename = timestampFilename();
  await writeFile(path.join(paths.storyboardVersions, filename), storyboardRaw, 'utf8');
  return filename;
}

export async function listStoryboardVersions(paths: JobPaths): Promise<StoryboardVersionMeta[]> {
  const entries = await readdir(paths.storyboardVersions).catch(() => [] as string[]);
  const filenames = entries.filter((f) => SAFE_FILENAME.test(f)).sort().reverse();

  return Promise.all(
    filenames.map(async (filename) => {
      const s = await stat(path.join(paths.storyboardVersions, filename));
      return { filename, createdAt: s.mtime.toISOString() };
    }),
  );
}

export async function readStoryboardVersion(paths: JobPaths, filename: string): Promise<string> {
  if (!SAFE_FILENAME.test(filename)) {
    throw new Error(`Invalid storyboard version filename: ${filename}`);
  }
  return readFile(path.join(paths.storyboardVersions, filename), 'utf8');
}

/** Copies a past version over the active storyboard.json. */
export async function activateStoryboardVersion(paths: JobPaths, filename: string): Promise<void> {
  const raw = await readStoryboardVersion(paths, filename);
  await writeFile(paths.storyboardJson, raw, 'utf8');
}
