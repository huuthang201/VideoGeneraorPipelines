import path from 'node:path';
import { cp, mkdir, readdir, rm, access, writeFile } from 'node:fs/promises';
import type { PublishTarget, StorageProvider } from './provider';
import { PipelineError } from '../domain/errors';

/**
 * Filesystem-backed storage over the folder layout in spec §43.
 *
 * This is the V1 implementation and it works unchanged whether DRIVE_ROOT
 * points at a plain local directory or at a Google Drive for Desktop mount -
 * both are just paths. That is the point of spec §61's staging: get the whole
 * loop working against a local folder now, and switching to a synced one later
 * is an edit to .env rather than to code.
 */
export const DRIVE_FOLDERS = {
  input: '01_INPUT',
  processing: '02_PROCESSING',
  output: '03_OUTPUT',
  published: '04_PUBLISHED',
  error: '99_ERROR',
} as const;

export class LocalDriveStorageProvider implements StorageProvider {
  readonly name = 'local-drive';

  constructor(private readonly driveRoot: string) {}

  private dir(kind: keyof typeof DRIVE_FOLDERS, projectId?: string): string {
    const base = path.join(this.driveRoot, DRIVE_FOLDERS[kind]);
    return projectId ? path.join(base, projectId) : base;
  }

  async listPending(): Promise<string[]> {
    const entries = await readdir(this.dir('input'), { withFileTypes: true }).catch(() => []);
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }

  async resolveInput(projectId: string): Promise<string | null> {
    const dir = this.dir('input', projectId);
    return (await exists(dir)) ? dir : null;
  }

  async publish(projectId: string, outputDir: string): Promise<PublishTarget> {
    if (!(await exists(outputDir))) {
      throw new PipelineError(
        'OUTPUT_MISSING',
        'publish',
        `Nothing to publish: ${outputDir} does not exist`,
      );
    }

    const target = this.dir('output', projectId);

    // Replaced rather than merged, so a rebuild that produces fewer files
    // cannot leave a stale video alongside the new deliverables.
    await rm(target, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await cp(outputDir, target, { recursive: true });

    return { describe: target };
  }

  async isPublished(projectId: string): Promise<boolean> {
    return exists(path.join(this.dir('output', projectId), 'video.mp4'));
  }

  async reportError(projectId: string, error: unknown): Promise<void> {
    const dir = this.dir('error', projectId);
    const payload =
      error instanceof PipelineError
        ? error.toErrorFile(projectId)
        : {
            projectId,
            stage: 'unknown',
            code: 'UNKNOWN',
            message: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          };

    // Best effort throughout: failing to record a failure must not replace the
    // original error with a less useful one.
    await mkdir(dir, { recursive: true }).catch(() => {});
    await writeFile(path.join(dir, 'error.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8').catch(
      () => {},
    );
  }

  async clearError(projectId: string): Promise<void> {
    await rm(this.dir('error', projectId), { recursive: true, force: true }).catch(() => {});
  }

  /** Creates the folder layout from spec §43 if it is not there yet. */
  async ensureLayout(): Promise<void> {
    for (const folder of Object.values(DRIVE_FOLDERS)) {
      await mkdir(path.join(this.driveRoot, folder), { recursive: true });
    }
  }
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}
