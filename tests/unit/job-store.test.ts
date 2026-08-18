import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canSkip, computeInputHash, readJob, writeJob } from '../../src/pipeline/job-store';
import { createJob, type Job } from '../../src/domain/job';
import { jobPaths } from '../../src/config/env';

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'svg-job-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function doneJob(hash: string): Job {
  return {
    ...createJob('p'),
    status: 'DONE',
    stage: 'complete',
    inputHash: hash,
    completedAt: new Date().toISOString(),
  };
}

describe('canSkip', () => {
  it('skips only when the job is DONE, the hash matches, and the output exists', () => {
    expect(canSkip(doneJob('h1'), 'h1', true)).toBe(true);
  });

  it('does not skip when the inputs changed', () => {
    expect(canSkip(doneJob('h1'), 'h2', true)).toBe(false);
  });

  it('does not skip when the video is gone', () => {
    // Covers a run that recorded DONE and then had its output deleted.
    expect(canSkip(doneJob('h1'), 'h1', false)).toBe(false);
  });

  it('does not skip a job that never finished', () => {
    // The regression this pins: the check used to run after the pipeline had
    // already overwritten status with an in-progress value, so a genuinely
    // complete job never matched and every run re-rendered from scratch.
    for (const status of ['PENDING', 'IMAGE_PROCESSING', 'RENDERING', 'FAILED'] as const) {
      expect(canSkip({ ...doneJob('h1'), status }, 'h1', true)).toBe(false);
    }
  });

  it('does not skip when there is no job at all', () => {
    expect(canSkip(null, 'h1', true)).toBe(false);
  });
});

describe('computeInputHash', () => {
  async function imageFile(name: string, contents: string): Promise<string> {
    const dir = path.join(workDir, 'hash');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await writeFile(file, contents, 'utf8');
    return file;
  }

  it('is stable across calls with identical input', async () => {
    const a = await imageFile('01.jpg', 'aaa');
    const b = await imageFile('02.jpg', 'bbb');
    const args = { imagePaths: [a, b], infoJson: '{"n":1}', storyboardJson: null, pipelineVersion: '1.0.0', renderSettings: {} };

    expect(await computeInputHash(args)).toBe(await computeInputHash(args));
  });

  it('ignores the order the paths are given in', async () => {
    const a = await imageFile('01.jpg', 'aaa');
    const b = await imageFile('02.jpg', 'bbb');
    const base = { infoJson: null, storyboardJson: null, pipelineVersion: '1.0.0', renderSettings: {} };

    expect(await computeInputHash({ ...base, imagePaths: [a, b] })).toBe(
      await computeInputHash({ ...base, imagePaths: [b, a] }),
    );
  });

  it('changes when an image changes', async () => {
    const file = await imageFile('01.jpg', 'original');
    const args = { imagePaths: [file], infoJson: null, storyboardJson: null, pipelineVersion: '1.0.0', renderSettings: {} };
    const before = await computeInputHash(args);

    await writeFile(file, 'edited', 'utf8');
    expect(await computeInputHash(args)).not.toBe(before);
  });

  it('changes when info.json or the storyboard changes', async () => {
    const file = await imageFile('01.jpg', 'x');
    const base = { imagePaths: [file], pipelineVersion: '1.0.0', renderSettings: {} };

    const plain = await computeInputHash({ ...base, infoJson: null, storyboardJson: null });
    const withInfo = await computeInputHash({ ...base, infoJson: '{"price":1}', storyboardJson: null });
    const withStoryboard = await computeInputHash({ ...base, infoJson: null, storyboardJson: '{"v":1}' });

    expect(new Set([plain, withInfo, withStoryboard]).size).toBe(3);
  });

  it('changes when the pipeline version is bumped', async () => {
    // The escape hatch for invalidating every cached output after a change in
    // how videos are built.
    const file = await imageFile('01.jpg', 'x');
    const base = { imagePaths: [file], infoJson: null, storyboardJson: null, renderSettings: {} };

    expect(await computeInputHash({ ...base, pipelineVersion: '1.0.0', renderSettings: {} })).not.toBe(
      await computeInputHash({ ...base, pipelineVersion: '1.1.0' }),
    );
  });
});

describe('job.json round trip', () => {
  it('reads back exactly what was written', async () => {
    const paths = jobPaths(path.join(workDir, 'jobs'), 'round-trip');
    await mkdir(paths.root, { recursive: true });

    const job = doneJob('sha256:abc');
    await writeJob(paths, job);

    expect(await readJob(paths)).toEqual(job);
  });

  it('treats a corrupt job file as absent rather than wedging the project', async () => {
    const paths = jobPaths(path.join(workDir, 'jobs'), 'corrupt');
    await mkdir(paths.root, { recursive: true });
    await writeFile(paths.jobJson, 'not json at all', 'utf8');

    expect(await readJob(paths)).toBeNull();
  });

  it('returns null when no job file exists yet', async () => {
    const paths = jobPaths(path.join(workDir, 'jobs'), 'missing');
    expect(await readJob(paths)).toBeNull();
  });
});

describe('render settings invalidate the cached result', () => {
  // The trap this closes: changing the voice in .env and re-running reported
  // "already up to date" and skipped, because the hash only covered input
  // *files*. Nothing about the images had changed, but the finished video
  // would have been different - and the user has no reason to guess that
  // --force is what unblocks it.
  async function hashWith(renderSettings: Record<string, string>): Promise<string> {
    const dir = path.join(workDir, 'settings');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, '01.jpg');
    await writeFile(file, 'image bytes', 'utf8');

    return computeInputHash({
      imagePaths: [file],
      infoJson: '{"name":"x"}',
      storyboardJson: null,
      pipelineVersion: '1.0.0',
      renderSettings,
    });
  }

  const BASE = {
    voice: 'vi-VN-HoaiMyNeural',
    rate: '+15%',
    pitch: '+25Hz',
    provider: 'edge',
    style: 'tiktok-fast',
  };

  it.each(['voice', 'rate', 'pitch', 'provider', 'style'])(
    'changing %s produces a different hash',
    async (key) => {
      const before = await hashWith(BASE);
      const after = await hashWith({ ...BASE, [key]: 'something-else' });
      expect(after).not.toBe(before);
    },
  );

  it('is unchanged when the settings are the same', async () => {
    expect(await hashWith(BASE)).toBe(await hashWith({ ...BASE }));
  });

  it('does not depend on the order the settings are given in', async () => {
    const reversed = Object.fromEntries(Object.entries(BASE).reverse());
    expect(await hashWith(reversed)).toBe(await hashWith(BASE));
  });
});
