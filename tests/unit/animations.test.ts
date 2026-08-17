import { describe, expect, it } from 'vitest';
import { ANIMATIONS } from '../../src/domain/scene';
import {
  getContentEntry,
  getImageMotion,
  requiresOverscan,
} from '../../src/remotion/animations/presets';

describe('getImageMotion', () => {
  it('handles every whitelisted animation', () => {
    // Guards against a name being added to the whitelist in domain/scene.ts
    // without a matching implementation here - the exact "Claude picks a value
    // with nothing behind it" failure the whitelist is meant to prevent.
    for (const animation of ANIMATIONS) {
      const motion = getImageMotion(animation, 0.5);
      expect(Number.isFinite(motion.scale)).toBe(true);
      expect(Number.isFinite(motion.translateXRatio)).toBe(true);
      expect(Number.isFinite(motion.translateYRatio)).toBe(true);
    }
  });

  it('never scales below 1, which would expose the frame edge', () => {
    for (const animation of ANIMATIONS) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        expect(getImageMotion(animation, t).scale).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('keeps pan travel inside the available overscan', () => {
    // If travel ever exceeded the slack from overscan, the pan would slide the
    // image off its own edge and show background through the gap.
    for (const animation of ANIMATIONS) {
      if (!requiresOverscan(animation)) continue;
      for (const t of [0, 0.5, 1]) {
        const { scale, translateXRatio, translateYRatio } = getImageMotion(animation, t);
        const slack = (scale - 1) / 2;
        expect(Math.abs(translateXRatio)).toBeLessThanOrEqual(slack + 1e-9);
        expect(Math.abs(translateYRatio)).toBeLessThanOrEqual(slack + 1e-9);
      }
    }
  });

  it('zoom-in grows and zoom-out shrinks', () => {
    expect(getImageMotion('zoom-in', 1).scale).toBeGreaterThan(getImageMotion('zoom-in', 0).scale);
    expect(getImageMotion('zoom-out', 1).scale).toBeLessThan(getImageMotion('zoom-out', 0).scale);
  });

  it('pans move in opposite directions from each other', () => {
    const left = getImageMotion('pan-left', 1).translateXRatio - getImageMotion('pan-left', 0).translateXRatio;
    const right = getImageMotion('pan-right', 1).translateXRatio - getImageMotion('pan-right', 0).translateXRatio;
    expect(Math.sign(left)).toBe(-Math.sign(right));

    const up = getImageMotion('pan-up', 1).translateYRatio - getImageMotion('pan-up', 0).translateYRatio;
    const down = getImageMotion('pan-down', 1).translateYRatio - getImageMotion('pan-down', 0).translateYRatio;
    expect(Math.sign(up)).toBe(-Math.sign(down));
  });

  it('"none" is genuinely static', () => {
    for (const t of [0, 0.5, 1]) {
      expect(getImageMotion('none', t)).toEqual({ scale: 1, translateXRatio: 0, translateYRatio: 0 });
    }
  });

  it('gives content-entry animations a subtle drift so no scene freezes', () => {
    for (const animation of ['fade', 'spring', 'slide-left', 'slide-up'] as const) {
      const start = getImageMotion(animation, 0).scale;
      const end = getImageMotion(animation, 1).scale;
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThan(1.1);
    }
  });

  it('clamps progress outside 0..1 rather than extrapolating', () => {
    expect(getImageMotion('zoom-in', -5)).toEqual(getImageMotion('zoom-in', 0));
    expect(getImageMotion('zoom-in', 5)).toEqual(getImageMotion('zoom-in', 1));
  });

  it('treats NaN progress as the start of the scene', () => {
    expect(getImageMotion('zoom-in', Number.NaN)).toEqual(getImageMotion('zoom-in', 0));
  });
});

describe('getContentEntry', () => {
  it('maps every animation to an implemented entry', () => {
    const valid = new Set(['fade', 'spring', 'slide-left', 'slide-right', 'slide-up', 'none']);
    for (const animation of ANIMATIONS) {
      expect(valid.has(getContentEntry(animation))).toBe(true);
    }
  });

  it('lets camera moves carry the motion and just fades their text in', () => {
    expect(getContentEntry('pan-left')).toBe('fade');
    expect(getContentEntry('zoom-in')).toBe('fade');
  });

  it('passes content animations through unchanged', () => {
    expect(getContentEntry('spring')).toBe('spring');
    expect(getContentEntry('slide-up')).toBe('slide-up');
    expect(getContentEntry('none')).toBe('none');
  });
});
