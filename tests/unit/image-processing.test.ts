import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { listImageFiles, probeImage, processImages } from '../../src/image/sharp.processor';
import { NoopBackgroundRemovalProvider } from '../../src/image/background-removal/provider';
import { RembgProvider } from '../../src/image/background-removal/rembg.provider';

let workDir: string;

const solid = (width: number, height: number, colour = { r: 40, g: 90, b: 160 }) =>
  sharp({ create: { width, height, channels: 3, background: colour } });

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'svg-images-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function makeCase(name: string): Promise<{ src: string; out: string; preview: string }> {
  const base = path.join(workDir, name);
  const src = path.join(base, 'source');
  await mkdir(src, { recursive: true });
  return { src, out: path.join(base, 'images'), preview: path.join(base, 'preview') };
}

describe('processImages', () => {
  it('applies EXIF orientation before resizing', async () => {
    // The failure this guards against: a phone photo stored 1600x1200 with a
    // "rotate 90" tag is really a 1200x1600 portrait. Resizing before honouring
    // the tag bakes in landscape dimensions and hands the layout a sideways
    // product that no fit mode can rescue.
    const dirs = await makeCase('exif');

    await solid(1600, 1200)
      .withMetadata({ orientation: 6 }) // 6 = rotate 90 clockwise
      .jpeg()
      .toFile(path.join(dirs.src, '01.jpg'));
    await solid(1000, 1000).jpeg().toFile(path.join(dirs.src, '02.jpg'));
    await solid(800, 1400).jpeg().toFile(path.join(dirs.src, '03.jpg'));

    const { images } = await processImages({
      sourceDir: dirs.src,
      outputDir: dirs.out,
      previewDir: dirs.preview,
    });

    const rotated = images.find((i) => i.filename === '01.jpg')!;
    expect(rotated.width).toBe(1200);
    expect(rotated.height).toBe(1600);
    expect(rotated.orientation).toBe('portrait');
  });

  it('never enlarges a source that is already small', async () => {
    const dirs = await makeCase('small');
    for (const name of ['01.jpg', '02.jpg', '03.jpg']) {
      await solid(600, 800).jpeg().toFile(path.join(dirs.src, name));
    }

    const { images } = await processImages({
      sourceDir: dirs.src,
      outputDir: dirs.out,
      previewDir: dirs.preview,
      maxEdge: 2160,
    });

    for (const image of images) {
      expect(image.width).toBe(600);
      expect(image.height).toBe(800);
    }
  });

  it('caps the long edge and keeps the aspect ratio', async () => {
    const dirs = await makeCase('large');
    for (const name of ['01.jpg', '02.jpg', '03.jpg']) {
      await solid(4000, 3000).jpeg().toFile(path.join(dirs.src, name));
    }

    const { images } = await processImages({
      sourceDir: dirs.src,
      outputDir: dirs.out,
      previewDir: dirs.preview,
      maxEdge: 2160,
    });

    for (const image of images) {
      expect(Math.max(image.width, image.height)).toBe(2160);
      expect(image.aspectRatio).toBeCloseTo(4 / 3, 2);
    }
  });

  it('classifies all three orientations', async () => {
    const dirs = await makeCase('orientations');
    await solid(1080, 1920).jpeg().toFile(path.join(dirs.src, '01.jpg'));
    await solid(1600, 1200).jpeg().toFile(path.join(dirs.src, '02.jpg'));
    await solid(1400, 1400).jpeg().toFile(path.join(dirs.src, '03.jpg'));

    const { images } = await processImages({
      sourceDir: dirs.src,
      outputDir: dirs.out,
      previewDir: dirs.preview,
    });

    expect(images.map((i) => i.orientation)).toEqual(['portrait', 'landscape', 'square']);
  });

  it('writes previews that are much smaller than the render images', async () => {
    // The preview exists to keep the model's input cheap; if it is not
    // substantially smaller it is not doing its job.
    const dirs = await makeCase('preview');
    for (const name of ['01.jpg', '02.jpg', '03.jpg']) {
      await solid(3000, 3000).jpeg().toFile(path.join(dirs.src, name));
    }

    await processImages({
      sourceDir: dirs.src,
      outputDir: dirs.out,
      previewDir: dirs.preview,
      maxEdge: 2160,
      previewEdge: 768,
    });

    const preview = await sharp(path.join(dirs.preview, '01.jpg')).metadata();
    expect(Math.max(preview.width!, preview.height!)).toBe(768);
  });

  it('skips an unreadable file but still succeeds with enough good ones', async () => {
    const dirs = await makeCase('corrupt');
    await solid(1000, 1000).jpeg().toFile(path.join(dirs.src, '01.jpg'));
    await solid(1000, 1000).jpeg().toFile(path.join(dirs.src, '02.jpg'));
    await solid(1000, 1000).jpeg().toFile(path.join(dirs.src, '03.jpg'));
    await writeFile(path.join(dirs.src, '04.jpg'), 'this is not a jpeg', 'utf8');

    const { images, skipped } = await processImages({
      sourceDir: dirs.src,
      outputDir: dirs.out,
      previewDir: dirs.preview,
    });

    expect(images).toHaveLength(3);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.filename).toBe('04.jpg');
  });

  it('fails with MINIMUM_IMAGES_NOT_MET when too few survive', async () => {
    const dirs = await makeCase('too-few');
    await solid(1000, 1000).jpeg().toFile(path.join(dirs.src, '01.jpg'));
    await solid(1000, 1000).jpeg().toFile(path.join(dirs.src, '02.jpg'));

    await expect(
      processImages({ sourceDir: dirs.src, outputDir: dirs.out, previewDir: dirs.preview }),
    ).rejects.toMatchObject({ code: 'MINIMUM_IMAGES_NOT_MET' });
  });

  it('normalises every source format to jpeg', async () => {
    const dirs = await makeCase('formats');
    await solid(1000, 1000).png().toFile(path.join(dirs.src, '01.png'));
    await solid(1000, 1000).webp().toFile(path.join(dirs.src, '02.webp'));
    await solid(1000, 1000).jpeg().toFile(path.join(dirs.src, '03.jpg'));

    const { images } = await processImages({
      sourceDir: dirs.src,
      outputDir: dirs.out,
      previewDir: dirs.preview,
    });

    expect(images.map((i) => i.filename)).toEqual(['01.jpg', '02.jpg', '03.jpg']);
  });
});

describe('listImageFiles', () => {
  it('sorts numerically so 10 comes after 9, not after 1', async () => {
    // Scene assignment follows this order, so "02.jpg" landing between "1" and
    // "10" would quietly reshuffle which photo appears in which scene.
    const dirs = await makeCase('sorting');
    for (const name of ['10.jpg', '2.jpg', '1.jpg']) {
      await solid(100, 100).jpeg().toFile(path.join(dirs.src, name));
    }

    expect(await listImageFiles(dirs.src)).toEqual(['1.jpg', '2.jpg', '10.jpg']);
  });

  it('ignores unsupported extensions and dotfiles', async () => {
    const dirs = await makeCase('filtering');
    await solid(100, 100).jpeg().toFile(path.join(dirs.src, '01.jpg'));
    await writeFile(path.join(dirs.src, 'info.json'), '{}', 'utf8');
    await writeFile(path.join(dirs.src, '.DS_Store'), '', 'utf8');
    await writeFile(path.join(dirs.src, 'notes.txt'), 'x', 'utf8');

    expect(await listImageFiles(dirs.src)).toEqual(['01.jpg']);
  });
});

describe('probeImage', () => {
  it('accepts a real image and reports its size', async () => {
    const dirs = await makeCase('probe-ok');
    const file = path.join(dirs.src, '01.jpg');
    await solid(640, 480).jpeg().toFile(file);

    const result = await probeImage(file);
    expect(result).toEqual({ ok: true, width: 640, height: 480 });
  });

  it('rejects a file that only looks like an image', async () => {
    // Stands in for the half-copied file case: correct name, incomplete bytes.
    const dirs = await makeCase('probe-bad');
    const file = path.join(dirs.src, 'truncated.jpg');
    await writeFile(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]));

    const result = await probeImage(file);
    expect(result.ok).toBe(false);
  });
});

describe('background removal', () => {
  it('the default provider is a no-op that returns the original', async () => {
    const provider = new NoopBackgroundRemovalProvider();
    expect(provider.enabled).toBe(false);
    expect(await provider.removeBackground('/tmp/a.jpg')).toBe('/tmp/a.jpg');
  });

  it('falls back to the original image when rembg is unavailable', async () => {
    // Spec §25: a failed cutout must never fail the video.
    const warnings: string[] = [];
    const provider = new RembgProvider('/nonexistent/python', (m) => warnings.push(m));

    const result = await provider.removeBackground('/tmp/product.jpg', '/tmp/cutout.png');

    expect(result).toBe('/tmp/product.jpg');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/using the original image/);
  });
});
