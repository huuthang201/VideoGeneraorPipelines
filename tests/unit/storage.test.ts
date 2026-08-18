import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DRIVE_FOLDERS, LocalDriveStorageProvider } from '../../src/storage/local-drive.provider';
import { PipelineError } from '../../src/domain/errors';

let root: string;
let storage: LocalDriveStorageProvider;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'svg-drive-'));
  storage = new LocalDriveStorageProvider(root);
  await storage.ensureLayout();
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeOutput(name: string, files: Record<string, string>): Promise<string> {
  const dir = path.join(root, 'staging', name);
  await mkdir(dir, { recursive: true });
  for (const [file, contents] of Object.entries(files)) {
    await writeFile(path.join(dir, file), contents, 'utf8');
  }
  return dir;
}

describe('drive layout', () => {
  it('creates the folder structure from spec §43', async () => {
    const entries = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const folder of Object.values(DRIVE_FOLDERS)) {
      expect(entries).toContain(folder);
    }
  });

  it('is safe to call twice', async () => {
    await expect(storage.ensureLayout()).resolves.not.toThrow();
  });
});

describe('listPending', () => {
  it('lists input projects in numeric order and ignores dotfiles', async () => {
    const input = path.join(root, DRIVE_FOLDERS.input);
    for (const name of ['p10', 'p2', 'p1', '.DS_Store']) {
      await mkdir(path.join(input, name), { recursive: true });
    }
    await writeFile(path.join(input, 'notes.txt'), 'x', 'utf8');

    expect(await storage.listPending()).toEqual(['p1', 'p2', 'p10']);
  });
});

describe('publish', () => {
  it('copies every deliverable into 03_OUTPUT', async () => {
    const output = await makeOutput('alpha', {
      'video.mp4': 'v',
      'thumbnail.jpg': 't',
      'captions.srt': 'c',
      'script.txt': 's',
      'storyboard.json': '{}',
      'job.json': '{}',
    });

    const target = await storage.publish('alpha', output);
    const published = await readdir(target.describe);

    expect(published.sort()).toEqual([
      'captions.srt',
      'job.json',
      'script.txt',
      'storyboard.json',
      'thumbnail.jpg',
      'video.mp4',
    ]);
  });

  it('replaces the destination rather than merging into it', async () => {
    // A rebuild that produces fewer files must not leave the previous video
    // sitting next to the new deliverables, where it would look current.
    const first = await makeOutput('beta-1', { 'video.mp4': 'old', 'stale.txt': 'leftover' });
    await storage.publish('beta', first);

    const second = await makeOutput('beta-2', { 'video.mp4': 'new' });
    const target = await storage.publish('beta', second);

    const published = await readdir(target.describe);
    expect(published).toEqual(['video.mp4']);
    expect(await readFile(path.join(target.describe, 'video.mp4'), 'utf8')).toBe('new');
  });

  it('refuses to publish a directory that does not exist', async () => {
    await expect(storage.publish('ghost', path.join(root, 'nope'))).rejects.toBeInstanceOf(
      PipelineError,
    );
  });
});

describe('isPublished', () => {
  it('is false before publishing and true afterwards', async () => {
    expect(await storage.isPublished('gamma')).toBe(false);
    await storage.publish('gamma', await makeOutput('gamma', { 'video.mp4': 'v' }));
    expect(await storage.isPublished('gamma')).toBe(true);
  });

  it('requires the video itself, not merely a folder', async () => {
    // An output folder holding only side files means the render did not finish.
    await storage.publish('delta', await makeOutput('delta', { 'script.txt': 's' }));
    expect(await storage.isPublished('delta')).toBe(false);
  });
});

describe('error reporting', () => {
  it('writes the spec §47 payload', async () => {
    const error = new PipelineError(
      'MINIMUM_IMAGES_NOT_MET',
      'validate',
      'Expected at least 3 images, found 2',
    );
    await storage.reportError('epsilon', error);

    const raw = await readFile(
      path.join(root, DRIVE_FOLDERS.error, 'epsilon', 'error.json'),
      'utf8',
    );
    const payload = JSON.parse(raw);

    expect(payload.projectId).toBe('epsilon');
    expect(payload.stage).toBe('validate');
    expect(payload.code).toBe('MINIMUM_IMAGES_NOT_MET');
    expect(payload.message).toMatch(/found 2/);
    expect(payload.timestamp).toBeTruthy();
  });

  it('handles a plain Error without losing the message', async () => {
    await storage.reportError('zeta', new Error('something broke'));
    const payload = JSON.parse(
      await readFile(path.join(root, DRIVE_FOLDERS.error, 'zeta', 'error.json'), 'utf8'),
    );
    expect(payload.message).toBe('something broke');
    expect(payload.code).toBe('UNKNOWN');
  });

  it('clears a stale error once the project succeeds', async () => {
    // Otherwise a project that failed once keeps reporting as broken forever,
    // and CLAUDE.md tells the Drive layer to read exactly this folder.
    await storage.reportError('eta', new Error('transient'));
    await storage.clearError('eta');

    const entries = await readdir(path.join(root, DRIVE_FOLDERS.error));
    expect(entries).not.toContain('eta');
  });

  it('clearing a project that never failed is not an error', async () => {
    await expect(storage.clearError('never-failed')).resolves.not.toThrow();
  });
});
