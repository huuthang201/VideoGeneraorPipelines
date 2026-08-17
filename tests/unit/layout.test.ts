import { describe, expect, it } from 'vitest';
import { STYLES } from '../../src/domain/config';
import { THEME_BY_STYLE, contentBottomInsetRatio, getTheme } from '../../src/remotion/themes/theme';
import { SAFE_AREA, safeAreaBox } from '../../src/remotion/components/SafeArea';

const FRAME_W = 1080;
const FRAME_H = 1920;

describe('safe area', () => {
  it('clears the platform UI on every edge (spec §19)', () => {
    const box = safeAreaBox(FRAME_W, FRAME_H);
    expect(box.top).toBeGreaterThan(0);
    expect(box.left).toBeGreaterThan(0);
    expect(box.right).toBeLessThan(FRAME_W);
    expect(box.bottom).toBeLessThan(FRAME_H);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it('reserves the widest inset for the interaction button column', () => {
    // The right column carries like/comment/share on both TikTok and Shorts and
    // is the easiest place to accidentally hide text behind.
    expect(SAFE_AREA.right).toBeGreaterThan(SAFE_AREA.left);
    expect(SAFE_AREA.right).toBeGreaterThanOrEqual(SAFE_AREA.bottom);
  });

  it('resolves insets against the correct axis', () => {
    // Regression guard. The first render of M1 used CSS percentage padding,
    // which resolves against the containing block's *width* - so a 12% top
    // inset produced 130px instead of 230px and pushed text under the app UI.
    // These assertions pin each inset to the axis it is supposed to track.
    const box = safeAreaBox(FRAME_W, FRAME_H);
    expect(box.top).toBeCloseTo(FRAME_H * SAFE_AREA.top, 5);
    expect(box.left).toBeCloseTo(FRAME_W * SAFE_AREA.left, 5);
    expect(FRAME_H - box.bottom).toBeCloseTo(FRAME_H * SAFE_AREA.bottom, 5);
    expect(FRAME_W - box.right).toBeCloseTo(FRAME_W * SAFE_AREA.right, 5);

    // Concretely: a vertical inset must not equal the horizontal-axis value.
    expect(box.top).not.toBeCloseTo(FRAME_W * SAFE_AREA.top, 1);
  });
});

describe('caption band does not collide with scene text', () => {
  it.each(STYLES)('%s keeps bottom-aligned content above the captions', (style) => {
    // Captions are positioned from the audio, scene text from the layout. They
    // are independent, so this is the only thing stopping them overlapping -
    // which they did on the first M1 render.
    const theme = getTheme(style);
    const contentBottomPx = FRAME_H * (1 - contentBottomInsetRatio(theme, true));
    const captionTopPx = FRAME_H * theme.caption.positionRatio;

    expect(contentBottomPx).toBeLessThan(captionTopPx);
  });

  it('lets content use the full safe area when a scene has no captions', () => {
    for (const style of STYLES) {
      const theme = getTheme(style);
      expect(contentBottomInsetRatio(theme, false)).toBeCloseTo(SAFE_AREA.bottom, 5);
    }
  });

  it('never insets less than the platform-safe bottom', () => {
    for (const style of STYLES) {
      const theme = getTheme(style);
      expect(contentBottomInsetRatio(theme, true)).toBeGreaterThanOrEqual(SAFE_AREA.bottom);
    }
  });
});

describe('themes', () => {
  it('defines one theme per declared style', () => {
    for (const style of STYLES) {
      expect(THEME_BY_STYLE[style]).toBeDefined();
      expect(THEME_BY_STYLE[style].name).toBe(style);
    }
  });

  it('keeps captions inside the frame', () => {
    for (const style of STYLES) {
      const theme = getTheme(style);
      expect(theme.caption.positionRatio).toBeGreaterThan(0);
      expect(theme.caption.positionRatio).toBeLessThan(1 - SAFE_AREA.bottom);
    }
  });

  it('orders motion speed the way the styles are described (spec §33)', () => {
    // tiktok-fast must actually be the fastest, minimal the slowest - otherwise
    // the style names mislead whoever picks one.
    const fast = getTheme('tiktok-fast').motion.entryDurationFrames;
    const tech = getTheme('modern-tech').motion.entryDurationFrames;
    const minimal = getTheme('minimal').motion.entryDurationFrames;
    expect(fast).toBeLessThan(tech);
    expect(tech).toBeLessThan(minimal);
  });

  it('gives minimal the least text emphasis', () => {
    expect(getTheme('minimal').headline.fontSize).toBeLessThan(
      getTheme('tiktok-fast').headline.fontSize,
    );
    expect(getTheme('minimal').progressBar.visible).toBe(false);
  });
});
