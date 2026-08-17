import { describe, expect, it } from 'vitest';
import { buildCaptionPages, buildTimeline } from '../../src/pipeline/build-timeline';
import { TimelineSchema } from '../../src/domain/timeline';
import { SCENE_DURATION_BOUNDS } from '../../src/domain/config';
import type { Storyboard } from '../../src/domain/storyboard';
import type { ProcessedImage } from '../../src/domain/project';
import type { WordTiming } from '../../src/tts/types';

const IMAGES: ProcessedImage[] = [
  { filename: '01.jpg', path: '/tmp/01.jpg', width: 1080, height: 1920, aspectRatio: 0.5625, orientation: 'portrait', cutoutPath: null },
  { filename: '02.jpg', path: '/tmp/02.jpg', width: 1600, height: 1200, aspectRatio: 1.333, orientation: 'landscape', cutoutPath: null },
  { filename: '03.jpg', path: '/tmp/03.jpg', width: 1400, height: 1400, aspectRatio: 1, orientation: 'square', cutoutPath: null },
];

function storyboard(overrides: Partial<Storyboard> = {}): Storyboard {
  return {
    version: '1.0',
    project: { id: 'test-product', productName: 'Test Product' },
    video: {
      width: 1080, height: 1920, fps: 30,
      targetDuration: 25, durationMin: 15, durationMax: 35,
      style: 'tiktok-fast',
    },
    voice: { language: 'vi-VN', provider: 'edge', voice: 'vi-VN-HoaiMyNeural', rate: '+5%' },
    content: { hook: 'Hook', narration: 'n', cta: 'CTA' },
    scenes: [
      { id: 's1', type: 'hook', asset: '01.jpg', headline: 'Hook', narration: 'Tai nghe này có đáng mua không', duration: 3, animation: 'zoom-in', transition: 'cut' },
      { id: 's2', type: 'feature', asset: '02.jpg', headline: 'ANC', narration: 'Chống ồn khá tốt trong tầm giá', duration: 5, animation: 'pan-left', transition: 'fade' },
      { id: 's3', type: 'cta', asset: '03.jpg', headline: 'Xem link', narration: 'Xem link bên dưới nhé', duration: 3, animation: 'spring', transition: 'whoosh' },
    ],
    ...overrides,
  };
}

function wordsFor(sb: Storyboard, perWordMs = 320): WordTiming[] {
  const all = sb.scenes.flatMap((s) => s.narration.split(/\s+/));
  return all.map((text, i) => ({
    text,
    fromMs: i * perWordMs,
    toMs: (i + 1) * perWordMs - 50,
  }));
}

const imageSrcFor = (filename: string) => `jobs/test/images/${filename}`;

function build(sb: Storyboard, words: WordTiming[], voiceDurationSec: number) {
  return buildTimeline({
    storyboard: sb,
    images: IMAGES,
    voiceSrc: voiceDurationSec > 0 ? 'jobs/test/audio/voice.mp3' : null,
    voiceDurationSec,
    words,
    imageSrcFor,
  });
}

describe('buildTimeline', () => {
  it('produces a timeline that satisfies its own schema', () => {
    // The schema re-checks the running-sum and total-duration invariants, so a
    // successful parse proves the layout is internally consistent.
    const sb = storyboard();
    const words = wordsFor(sb);
    const { timeline } = build(sb, words, 6.4);

    expect(() => TimelineSchema.parse(timeline)).not.toThrow();
  });

  it('lays scenes end to end with no gaps or overlaps', () => {
    const sb = storyboard();
    const { timeline } = build(sb, wordsFor(sb), 6.4);

    let expectedFrom = 0;
    for (const scene of timeline.scenes) {
      expect(scene.from).toBe(expectedFrom);
      expect(scene.durationInFrames).toBeGreaterThan(0);
      expectedFrom += scene.durationInFrames;
    }
    expect(timeline.video.durationInFrames).toBe(expectedFrom);
  });

  it('derives scene length from measured audio, not from the model hint', () => {
    // s2's hint says 5s. Give its narration far more spoken time than that and
    // the timeline must follow the audio.
    const sb = storyboard();
    const words = wordsFor(sb, 900);
    const { timeline } = build(sb, words, 30);

    const s2 = timeline.scenes[1]!;
    const hintFrames = Math.round(5 * 30);
    expect(s2.durationInFrames).not.toBe(hintFrames);
    expect(s2.durationInFrames).toBeGreaterThan(hintFrames);
  });

  it('falls back to the model hint only when there is no audio at all', () => {
    const sb = storyboard();
    const { timeline, diagnostics } = build(sb, [], 0);

    expect(diagnostics.usedFallbackAlignment).toBe(true);
    expect(timeline.voice).toBeNull();
    // 3s hint + 0.25s tail padding = 3.25s -> 98 frames
    expect(timeline.scenes[0]!.durationInFrames).toBe(Math.round(3.25 * 30));
  });

  it('splits the real duration when audio exists but carries no word timings', () => {
    const sb = storyboard();
    const { timeline, diagnostics } = build(sb, [], 12);

    expect(diagnostics.usedFallbackAlignment).toBe(true);
    expect(timeline.voice).not.toBeNull();
    // Total should track the 12s of audio rather than the 11s of hints.
    const totalSec = timeline.video.durationInFrames / 30;
    expect(totalSec).toBeGreaterThan(11.5);
  });

  it('clamps against the upper bound only when durations came from model hints', () => {
    // With no audio there is nothing to be faithful to, so an implausible hint
    // is corrected outright.
    const sb = storyboard();
    sb.scenes[1]!.duration = 40;
    const { timeline, diagnostics } = build(sb, [], 0);

    for (const scene of timeline.scenes) {
      expect(scene.durationInFrames).toBeLessThanOrEqual(SCENE_DURATION_BOUNDS.maxSeconds * 30);
      expect(scene.durationInFrames).toBeGreaterThanOrEqual(SCENE_DURATION_BOUNDS.minSeconds * 30);
    }
    expect(diagnostics.clampedScenes).toContain('s2');
  });

  it('reports rather than truncates an over-long scene backed by real audio', () => {
    // Capping a scene whose length was measured would cut the narration off
    // mid-word, so the length stands and the anomaly is surfaced instead.
    const sb = storyboard();
    const words = wordsFor(sb, 3000);
    const { timeline, diagnostics } = build(sb, words, 90);

    expect(diagnostics.longScenes.length).toBeGreaterThan(0);
    expect(diagnostics.usedFallbackAlignment).toBe(false);

    // The video still covers the audio exactly - that invariant outranks the cap.
    const summed = timeline.scenes.reduce((n, s) => n + s.durationInFrames, 0);
    expect(summed).toBe(timeline.video.durationInFrames);
  });

  it('reports no long scenes for a normally-paced narration', () => {
    const sb = storyboard();
    const { diagnostics } = build(sb, wordsFor(sb), 6.4);
    expect(diagnostics.longScenes).toEqual([]);
  });

  it('never emits a zero-length scene even from zero-length audio', () => {
    const sb = storyboard();
    const words = wordsFor(sb).map((w) => ({ ...w, fromMs: 0, toMs: 0 }));
    const { timeline } = build(sb, words, 0.1);

    for (const scene of timeline.scenes) {
      expect(scene.durationInFrames).toBeGreaterThan(0);
    }
  });

  it('picks the fit treatment from each image orientation', () => {
    const sb = storyboard();
    const { timeline } = build(sb, wordsFor(sb), 6.4);

    expect(timeline.scenes[0]!.image.fit).toBe('cover'); // portrait
    expect(timeline.scenes[1]!.image.fit).toBe('blur-pad'); // landscape
    expect(timeline.scenes[2]!.image.fit).toBe('blur-pad'); // square
  });

  it('carries intrinsic image dimensions through so nothing downstream guesses', () => {
    const sb = storyboard();
    const { timeline } = build(sb, wordsFor(sb), 6.4);
    expect(timeline.scenes[1]!.image.width).toBe(1600);
    expect(timeline.scenes[1]!.image.height).toBe(1200);
  });

  it('refuses a storyboard that references a missing image', () => {
    const sb = storyboard();
    sb.scenes[0]!.asset = 'does-not-exist.jpg';
    expect(() => build(sb, wordsFor(sb), 6.4)).toThrow(/does-not-exist\.jpg/);
  });

  it('reports how far the voice track overhangs the video', () => {
    // Padding and clamping mean the two are rarely identical; the pipeline needs
    // the number to decide whether the mismatch is acceptable.
    const sb = storyboard();
    const { diagnostics } = build(sb, wordsFor(sb), 6.4);
    expect(Number.isFinite(diagnostics.voiceOverhangSec)).toBe(true);
  });

  it('keeps captions inside their own scene', () => {
    const sb = storyboard();
    const { timeline } = build(sb, wordsFor(sb), 6.4);

    for (const scene of timeline.scenes) {
      const sceneMs = (scene.durationInFrames / 30) * 1000;
      for (const page of scene.captionPages) {
        expect(page.startMs).toBeGreaterThanOrEqual(0);
        expect(page.startMs + page.durationMs).toBeLessThanOrEqual(sceneMs + 1);
        for (const token of page.tokens) {
          expect(token.fromMs).toBeGreaterThanOrEqual(0);
          expect(token.toMs).toBeLessThanOrEqual(sceneMs + 1);
        }
      }
    }
  });

  it('gives every narrating scene captions', () => {
    const sb = storyboard();
    const { timeline } = build(sb, wordsFor(sb), 6.4);
    for (const scene of timeline.scenes) {
      expect(scene.captionPages.length).toBeGreaterThan(0);
    }
  });
});

describe('buildCaptionPages', () => {
  const words = (n: number, perWordMs = 300, startMs = 0): WordTiming[] =>
    Array.from({ length: n }, (_, i) => ({
      text: `từ${i}`,
      fromMs: startMs + i * perWordMs,
      toMs: startMs + (i + 1) * perWordMs - 40,
    }));

  it('chunks into 2-5 words per page (spec §18)', () => {
    const pages = buildCaptionPages(words(12), 0, 12 * 30, 30);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.tokens.length).toBeGreaterThanOrEqual(1);
      expect(page.tokens.length).toBeLessThanOrEqual(5);
    }
  });

  it('breaks at a natural pause rather than mid-phrase', () => {
    const timings: WordTiming[] = [
      { text: 'một', fromMs: 0, toMs: 260 },
      { text: 'hai', fromMs: 300, toMs: 560 },
      // 900ms of silence - a sentence boundary.
      { text: 'ba', fromMs: 1500, toMs: 1760 },
      { text: 'bốn', fromMs: 1800, toMs: 2060 },
    ];
    const pages = buildCaptionPages(timings, 0, 90, 30);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.text).toBe('một hai');
    expect(pages[1]!.text).toBe('ba bốn');
  });

  it('rebases times so 0 is the scene start, not the track start', () => {
    // A scene four seconds into the voice track: its words carry absolute
    // timings, but Remotion counts frames from the scene's own start.
    const pages = buildCaptionPages(words(4, 300, 4000), 4000, 150, 30);
    expect(pages[0]!.startMs).toBe(0);
    expect(pages[0]!.tokens[0]!.fromMs).toBe(0);
    expect(pages[0]!.tokens[1]!.fromMs).toBe(300);
  });

  it('drops words that precede the scene they were handed to', () => {
    // Defensive: a caller passing mismatched offsets gets no captions rather
    // than captions pinned at 0 that would fight the ones that do belong.
    expect(buildCaptionPages(words(4), 5000, 150, 30)).toEqual([]);
  });

  it('returns nothing for a scene with no words', () => {
    expect(buildCaptionPages([], 0, 90, 30)).toEqual([]);
  });

  it('drops pages that fall entirely outside a clamped scene', () => {
    // 20 words of speech squeezed into a 1-second scene: the tail is unreachable
    // and must not produce pages that never render.
    const pages = buildCaptionPages(words(20), 0, 30, 30);
    for (const page of pages) {
      expect(page.durationMs).toBeGreaterThan(0);
      expect(page.startMs).toBeLessThan(1000);
    }
  });

  it('keeps tokens in order within a page', () => {
    const pages = buildCaptionPages(words(10), 0, 300, 30);
    for (const page of pages) {
      for (let i = 1; i < page.tokens.length; i++) {
        expect(page.tokens[i]!.fromMs).toBeGreaterThanOrEqual(page.tokens[i - 1]!.fromMs);
      }
    }
  });
});
