import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../../src/pipeline/build-timeline';
import type { Storyboard } from '../../src/domain/storyboard';
import type { ProcessedImage } from '../../src/domain/project';
import type { WordTiming } from '../../src/tts/types';

/**
 * Regression suite for the defect found on the first real M2 run: scene
 * durations were taken as the span from a scene's first spoken word to its
 * last, which silently discarded the pauses between scenes and the trailing
 * silence. A 17.4s narration rendered as a 15.0s video and the call to action
 * was cut off mid-sentence.
 *
 * The property that prevents it is simple and worth stating plainly: when the
 * timeline is built from measured audio, total video length equals total audio
 * length.
 */

const IMAGES: ProcessedImage[] = [
  { filename: 'a.jpg', path: '', width: 1080, height: 1920, aspectRatio: 0.5625, orientation: 'portrait', cutoutPath: null },
];

function makeStoryboard(sceneCount: number): Storyboard {
  return {
    version: '1.0',
    project: { id: 'p', productName: 'P' },
    video: { width: 1080, height: 1920, fps: 30, targetDuration: 25, durationMin: 15, durationMax: 35, style: 'tiktok-fast' },
    voice: { language: 'vi-VN', provider: 'edge', voice: 'vi-VN-HoaiMyNeural' },
    content: { hook: 'h', narration: 'n', cta: 'c' },
    scenes: Array.from({ length: sceneCount }, (_, i) => ({
      id: `s${i + 1}`,
      type: i === 0 ? ('hook' as const) : i === sceneCount - 1 ? ('cta' as const) : ('feature' as const),
      asset: 'a.jpg',
      headline: `H${i}`,
      narration: `Câu số ${i} nói về sản phẩm này khá là dài`,
      duration: 3,
      animation: 'zoom-in' as const,
      transition: 'cut' as const,
    })),
  };
}

/**
 * Word timings with a deliberate pause between scenes - the gap that used to
 * disappear.
 */
function wordsWithPauses(sb: Storyboard, perWordMs: number, pauseMs: number): WordTiming[] {
  const words: WordTiming[] = [];
  let cursor = 140; // narrators do not start on frame 0

  for (const scene of sb.scenes) {
    for (const text of scene.narration.split(/\s+/)) {
      words.push({ text, fromMs: cursor, toMs: cursor + perWordMs - 60 });
      cursor += perWordMs;
    }
    cursor += pauseMs;
  }
  return words;
}

function build(sb: Storyboard, words: WordTiming[], voiceDurationSec: number) {
  return buildTimeline({
    storyboard: sb,
    images: IMAGES,
    voiceSrc: 'jobs/p/audio/voice.mp3',
    voiceDurationSec,
    words,
    imageSrcFor: (f) => `jobs/p/images/${f}`,
  });
}

describe('timeline covers the whole voice track', () => {
  it('matches total audio duration within one frame', () => {
    const sb = makeStoryboard(4);
    const words = wordsWithPauses(sb, 320, 500);
    const lastWordEndMs = words[words.length - 1]!.toMs;
    // Real files carry trailing silence past the final word.
    const voiceDurationSec = (lastWordEndMs + 900) / 1000;

    const { timeline } = build(sb, words, voiceDurationSec);

    const videoSec = timeline.video.durationInFrames / 30;
    expect(Math.abs(videoSec - voiceDurationSec)).toBeLessThan(1 / 30 + 1e-9);
  });

  it('does not drop the pauses between scenes', () => {
    const sb = makeStoryboard(4);
    const perWordMs = 320;

    const tight = wordsWithPauses(sb, perWordMs, 0);
    const gappy = wordsWithPauses(sb, perWordMs, 800);

    const tightEnd = tight[tight.length - 1]!.toMs / 1000;
    const gappyEnd = gappy[gappy.length - 1]!.toMs / 1000;

    const a = build(sb, tight, tightEnd).timeline.video.durationInFrames;
    const b = build(sb, gappy, gappyEnd).timeline.video.durationInFrames;

    // Three inter-scene pauses of 800ms => ~2.4s more video, not the same length.
    expect(b - a).toBeGreaterThan(0.8 * 3 * 30 * 0.9);
  });

  it('keeps the trailing silence after the last word', () => {
    const sb = makeStoryboard(3);
    const words = wordsWithPauses(sb, 300, 200);
    const lastWordEndSec = words[words.length - 1]!.toMs / 1000;

    const withTail = build(sb, words, lastWordEndSec + 1.5).timeline;
    const withoutTail = build(sb, words, lastWordEndSec).timeline;

    expect(withTail.video.durationInFrames).toBeGreaterThan(withoutTail.video.durationInFrames);
    // The extra time lands on the final scene, giving the CTA room to breathe.
    const lastWith = withTail.scenes[withTail.scenes.length - 1]!;
    const lastWithout = withoutTail.scenes[withoutTail.scenes.length - 1]!;
    expect(lastWith.durationInFrames).toBeGreaterThan(lastWithout.durationInFrames);
  });

  it('never accumulates rounding drift across many scenes', () => {
    const sb = makeStoryboard(7);
    // A per-word duration that does not divide evenly into frames.
    const words = wordsWithPauses(sb, 333, 217);
    const voiceSec = (words[words.length - 1]!.toMs + 700) / 1000;

    const { timeline } = build(sb, words, voiceSec);

    const summed = timeline.scenes.reduce((n, s) => n + s.durationInFrames, 0);
    expect(summed).toBe(timeline.video.durationInFrames);
    expect(Math.abs(timeline.video.durationInFrames / 30 - voiceSec)).toBeLessThan(1 / 30 + 1e-9);
  });

  it('starts the first scene at frame 0 even though speech starts later', () => {
    const sb = makeStoryboard(3);
    const words = wordsWithPauses(sb, 300, 300);
    const { timeline } = build(sb, words, (words[words.length - 1]!.toMs + 500) / 1000);

    expect(timeline.scenes[0]!.from).toBe(0);
  });

  it('keeps captions aligned to real speech, not to the scene start', () => {
    // The first caption must appear when the narrator actually speaks - about
    // 140ms in here - rather than snapping to 0 because the scene starts there.
    const sb = makeStoryboard(2);
    const words = wordsWithPauses(sb, 300, 400);
    const { timeline } = build(sb, words, (words[words.length - 1]!.toMs + 500) / 1000);

    const firstPage = timeline.scenes[0]!.captionPages[0]!;
    expect(firstPage.startMs).toBeGreaterThan(50);
    expect(firstPage.startMs).toBeLessThan(400);
  });

  it('still enforces a readable minimum when speech is rushed', () => {
    const sb = makeStoryboard(4);
    const words = wordsWithPauses(sb, 40, 0);
    const { timeline, diagnostics } = build(sb, words, words[words.length - 1]!.toMs / 1000);

    for (const scene of timeline.scenes) {
      expect(scene.durationInFrames).toBeGreaterThanOrEqual(1.5 * 30);
    }
    expect(diagnostics.clampedScenes.length).toBeGreaterThan(0);
  });
});
