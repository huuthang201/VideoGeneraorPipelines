import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

/**
 * meta.json - the one piece of state the UI owns that the engine does not:
 * the human-typed display name and when the project was created in the UI.
 * Kept separate from job.json (whose zod schema is `strictObject` and would
 * reject an extra field) rather than asking the engine to know about it.
 */
export interface ProjectMeta {
  displayName: string;
  createdAt: string;
  /**
   * What happens once a render finishes.
   *
   * A workflow preference rather than anything the engine needs, which is why
   * it lives here: the CLI uploads when told to and never on its own, so a
   * `generate` run from a terminal is never a surprise publication.
   *
   * A new project defaults to `schedule`, and the option is listed first in the
   * UI, because that is what this tool is for - a queue that goes out on its
   * own cadence. Defaulting to `none` meant every project needed the same click
   * before it did the thing it was made to do.
   */
  autoPublish: 'none' | 'now' | 'schedule';
}

function metaPath(jobDir: string): string {
  return path.join(jobDir, 'meta.json');
}

export async function writeProjectMeta(jobDir: string, meta: ProjectMeta): Promise<void> {
  await mkdir(jobDir, { recursive: true });
  await writeFile(metaPath(jobDir), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

export async function readProjectMeta(jobDir: string, fallbackId: string): Promise<ProjectMeta> {
  const raw = await readFile(metaPath(jobDir), 'utf8').catch(() => null);
  const fallback: ProjectMeta = {
    displayName: fallbackId,
    createdAt: new Date(0).toISOString(),
    autoPublish: 'schedule',
  };
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Partial<ProjectMeta>;
    return {
      displayName: parsed.displayName ?? fallback.displayName,
      createdAt: parsed.createdAt ?? fallback.createdAt,
      autoPublish: parsed.autoPublish ?? fallback.autoPublish,
    };
  } catch {
    return fallback;
  }
}
