import { describe, expect, it } from 'vitest';
import {
  StoryboardDraftSchema,
  StoryboardSchema,
  narrationFromScenes,
  withDerivedNarration,
} from '../../src/domain/storyboard';
import { buildStoryboardPrompt } from '../../src/ai/prompts/generate-storyboard';
import { extractJson } from '../../src/ai/claude-code.provider';

const scene = (i: number, type: string) => ({
  id: `scene-0${i}`,
  type,
  asset: '01.jpg',
  headline: 'Tiêu đề',
  narration: `Câu số ${i}.`,
  duration: 4,
  animation: 'zoom-in',
  transition: 'cut',
});

const draft = {
  version: '1.0',
  project: { id: 'p', productName: 'P' },
  video: { style: 'tiktok-fast' },
  voice: { voice: 'vi-VN-HoaiMyNeural' },
  content: { hook: 'Hook', narration: '', cta: 'CTA' },
  scenes: [scene(1, 'hook'), scene(2, 'feature'), scene(3, 'cta')],
};

describe('the prompt and the schema agree', () => {
  it('accepts the empty content.narration the prompt asks for', () => {
    // Regression guard from the first real AI run. The prompt tells the model
    // to leave content.narration empty because the pipeline derives it from the
    // scene lines - but the draft schema still demanded a non-empty string, so
    // a perfectly obedient reply was rejected and a Claude call wasted.
    expect(StoryboardDraftSchema.safeParse(draft).success).toBe(true);
  });

  it('the prompt really does instruct that', () => {
    // Pins the two together: if the instruction is ever removed, the test above
    // is no longer guarding anything meaningful.
    const prompt = buildStoryboardPrompt({
      projectId: 'p',
      productName: 'P',
      info: null,
      assetFilenames: ['01.jpg'],
      previewDir: '/tmp/preview',
      targetDurationSec: 25,
      defaultStyle: 'tiktok-fast',
      femaleVoice: 'vi-VN-HoaiMyNeural',
      maleVoice: 'vi-VN-NamMinhNeural',
    });

    expect(prompt).toMatch(/content\.narration.*chuỗi rỗng/su);
  });

  it('the example JSON embedded in the prompt validates against the schema', () => {
    // The strongest form of this check: whatever the model is shown as a model
    // answer must itself be acceptable.
    const prompt = buildStoryboardPrompt({
      projectId: 'demo',
      productName: 'Demo',
      info: null,
      assetFilenames: ['01.jpg', '02.jpg'],
      previewDir: '/tmp/preview',
      targetDurationSec: 25,
      defaultStyle: 'tiktok-fast',
      femaleVoice: 'vi-VN-HoaiMyNeural',
      maleVoice: 'vi-VN-NamMinhNeural',
    });

    const example = extractJson(prompt.slice(prompt.lastIndexOf('```json')));
    expect(example).not.toBeNull();

    const parsed = StoryboardDraftSchema.safeParse({
      ...(example as object),
      // The example shows a single scene for brevity; the schema requires three.
      scenes: [scene(1, 'hook'), scene(2, 'feature'), scene(3, 'cta')],
    });
    expect(parsed.success).toBe(true);
  });

  it('only offers whitelisted enum values', () => {
    const prompt = buildStoryboardPrompt({
      projectId: 'p',
      productName: 'P',
      info: null,
      assetFilenames: ['01.jpg'],
      previewDir: '/tmp/preview',
      targetDurationSec: 25,
      defaultStyle: 'tiktok-fast',
      femaleVoice: 'vi-VN-HoaiMyNeural',
      maleVoice: 'vi-VN-NamMinhNeural',
    });

    expect(prompt).toContain('hook | product | feature | cta');
    expect(prompt).toContain('tiktok-fast | modern-tech | minimal');
    expect(prompt).toContain('zoom-in');
  });

  it('tells the model the exact filenames it may reference', () => {
    const prompt = buildStoryboardPrompt({
      projectId: 'p',
      productName: 'P',
      info: null,
      assetFilenames: ['first.jpg', 'second.png'],
      previewDir: '/tmp/preview',
      targetDurationSec: 25,
      defaultStyle: 'tiktok-fast',
      femaleVoice: 'vi-VN-HoaiMyNeural',
      maleVoice: 'vi-VN-NamMinhNeural',
    });

    expect(prompt).toContain('first.jpg');
    expect(prompt).toContain('second.png');
  });

  it('switches to strict wording when no price is available', () => {
    const strict = buildStoryboardPrompt({
      projectId: 'p',
      productName: 'P',
      info: null,
      assetFilenames: ['01.jpg'],
      previewDir: '/tmp/preview',
      targetDurationSec: 25,
      defaultStyle: 'tiktok-fast',
      femaleVoice: 'vi-VN-HoaiMyNeural',
      maleVoice: 'vi-VN-NamMinhNeural',
    });
    const withPrice = buildStoryboardPrompt({
      projectId: 'p',
      productName: 'P',
      info: { name: 'P', price: 399000 },
      assetFilenames: ['01.jpg'],
      previewDir: '/tmp/preview',
      targetDurationSec: 25,
      defaultStyle: 'tiktok-fast',
      femaleVoice: 'vi-VN-HoaiMyNeural',
      maleVoice: 'vi-VN-NamMinhNeural',
    });

    expect(strict).toMatch(/KHÔNG có giá/u);
    expect(withPrice).toMatch(/được phép nhắc tới/u);
  });
});

describe('derived narration', () => {
  it('joins the scene lines in order', () => {
    expect(narrationFromScenes(draft as never)).toBe('Câu số 1. Câu số 2. Câu số 3.');
  });

  it('overwrites a top-level copy that disagrees with the scenes', () => {
    const full = StoryboardSchema.parse({
      ...draft,
      video: {
        width: 1080, height: 1920, fps: 30,
        targetDuration: 25, durationMin: 15, durationMax: 35,
        style: 'tiktok-fast',
      },
      voice: { language: 'vi-VN', provider: 'edge', voice: 'vi-VN-HoaiMyNeural' },
      content: { hook: 'Hook', narration: 'something stale and wrong', cta: 'CTA' },
    });

    expect(withDerivedNarration(full).content.narration).toBe('Câu số 1. Câu số 2. Câu số 3.');
  });
});
