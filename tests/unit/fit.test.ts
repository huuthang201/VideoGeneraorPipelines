import { describe, expect, it } from 'vitest';
import {
  boxAspectRatio,
  computeFit,
  coversFrame,
  defaultFitFor,
} from '../../src/remotion/layout/fit';
import { classifyOrientation } from '../../src/domain/project';

const FRAME_W = 1080;
const FRAME_H = 1920;

/** Representative shapes: 9:16 phone photo, 4:3 camera, 1:1 product shot. */
const PORTRAIT = { w: 1080, h: 1920 };
const LANDSCAPE = { w: 1600, h: 1200 };
const SQUARE = { w: 1600, h: 1600 };
const ALL = [PORTRAIT, LANDSCAPE, SQUARE];

describe('never stretches the source', () => {
  // This is the whole point of the module (spec §22). If any fit mode ever
  // returns a box whose aspect ratio differs from the source, the image is
  // being squashed and the render is wrong.
  it.each(['cover', 'contain', 'blur-pad'] as const)('preserves aspect ratio in %s mode', (mode) => {
    for (const { w, h } of ALL) {
      const result = computeFit(w, h, FRAME_W, FRAME_H, mode);
      const sourceRatio = w / h;

      expect(boxAspectRatio(result.foreground)).toBeCloseTo(sourceRatio, 5);
      if (result.background) {
        expect(boxAspectRatio(result.background)).toBeCloseTo(sourceRatio, 5);
      }
    }
  });

  it('scales both axes by exactly the same factor', () => {
    for (const { w, h } of ALL) {
      for (const mode of ['cover', 'contain', 'blur-pad'] as const) {
        const { foreground } = computeFit(w, h, FRAME_W, FRAME_H, mode);
        expect(foreground.width / w).toBeCloseTo(foreground.height / h, 10);
      }
    }
  });
});

describe('cover', () => {
  it('fills the frame with no bars for every source shape', () => {
    for (const { w, h } of ALL) {
      const { foreground } = computeFit(w, h, FRAME_W, FRAME_H, 'cover');
      expect(coversFrame(foreground, FRAME_W, FRAME_H)).toBe(true);
    }
  });

  it('leaves a 9:16 source exactly frame-sized', () => {
    const { foreground } = computeFit(1080, 1920, FRAME_W, FRAME_H, 'cover');
    expect(foreground.width).toBeCloseTo(1080, 5);
    expect(foreground.height).toBeCloseTo(1920, 5);
    expect(foreground.left).toBeCloseTo(0, 5);
    expect(foreground.top).toBeCloseTo(0, 5);
  });
});

describe('contain', () => {
  it('keeps the whole source inside the frame', () => {
    for (const { w, h } of ALL) {
      const { foreground } = computeFit(w, h, FRAME_W, FRAME_H, 'contain');
      expect(foreground.width).toBeLessThanOrEqual(FRAME_W + 1);
      expect(foreground.height).toBeLessThanOrEqual(FRAME_H + 1);
    }
  });
});

describe('blur-pad', () => {
  it('produces a background that fills the frame and a foreground that does not', () => {
    for (const { w, h } of [LANDSCAPE, SQUARE]) {
      const { foreground, background } = computeFit(w, h, FRAME_W, FRAME_H, 'blur-pad');

      expect(background).not.toBeNull();
      expect(coversFrame(background!, FRAME_W, FRAME_H)).toBe(true);

      // The product must stay fully visible - that is why blur-pad exists.
      expect(foreground.width).toBeLessThanOrEqual(FRAME_W);
      expect(foreground.height).toBeLessThanOrEqual(FRAME_H);
    }
  });

  it('centres both layers', () => {
    const { foreground, background } = computeFit(1600, 1200, FRAME_W, FRAME_H, 'blur-pad');
    expect(foreground.left + foreground.width / 2).toBeCloseTo(FRAME_W / 2, 5);
    expect(foreground.top + foreground.height / 2).toBeCloseTo(FRAME_H / 2, 5);
    expect(background!.left + background!.width / 2).toBeCloseTo(FRAME_W / 2, 5);
    expect(background!.top + background!.height / 2).toBeCloseTo(FRAME_H / 2, 5);
  });

  it('inset keeps the blurred backdrop visible around the product', () => {
    const { foreground } = computeFit(1600, 1600, FRAME_W, FRAME_H, 'blur-pad');
    expect(foreground.width).toBeLessThan(FRAME_W);
  });
});

describe('defaultFitFor', () => {
  it('routes each orientation to the treatment spec §23 describes', () => {
    expect(defaultFitFor('portrait')).toBe('cover');
    expect(defaultFitFor('landscape')).toBe('blur-pad');
    expect(defaultFitFor('square')).toBe('blur-pad');
  });

  it('agrees with how orientation is classified', () => {
    expect(defaultFitFor(classifyOrientation(1080, 1920))).toBe('cover');
    expect(defaultFitFor(classifyOrientation(1600, 1200))).toBe('blur-pad');
    expect(defaultFitFor(classifyOrientation(1600, 1600))).toBe('blur-pad');
  });
});

describe('classifyOrientation', () => {
  it('puts near-square inside the square band rather than the extremes', () => {
    expect(classifyOrientation(1000, 1000)).toBe('square');
    expect(classifyOrientation(1020, 1000)).toBe('square');
    expect(classifyOrientation(1000, 1020)).toBe('square');
    expect(classifyOrientation(1200, 1000)).toBe('landscape');
    expect(classifyOrientation(1000, 1200)).toBe('portrait');
  });
});

describe('invalid input', () => {
  it('rejects zero or negative dimensions instead of emitting NaN boxes', () => {
    expect(() => computeFit(0, 100, FRAME_W, FRAME_H, 'cover')).toThrow();
    expect(() => computeFit(100, 0, FRAME_W, FRAME_H, 'cover')).toThrow();
    expect(() => computeFit(100, 100, 0, FRAME_H, 'cover')).toThrow();
  });
});
