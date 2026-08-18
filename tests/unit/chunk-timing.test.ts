import { describe, expect, it } from 'vitest';
import { distributeWordsAcrossChunks, type SynthesisChunk } from '../../src/tts/chunk-timing';

/**
 * VieNeu reports only audio, so word timings are reconstructed from measured
 * sentence boundaries. These assert the properties everything downstream relies
 * on - captions never drift outside their sentence, and word order is preserved
 * - rather than exact millisecond values, which are an interpolation and not a
 * measurement.
 */
describe('distributeWordsAcrossChunks', () => {
  const chunk = (text: string, fromMs: number, toMs: number): SynthesisChunk => ({
    text,
    fromMs,
    toMs,
  });

  it('keeps every word inside the sentence it belongs to', () => {
    // This is the property that matters: sentence boundaries are measured
    // facts, so an interpolation error can never leak past one sentence.
    const chunks = [
      chunk('Thiết kế nhỏ gọn.', 0, 2000),
      chunk('Pin dùng cả ngày.', 2200, 4500),
    ];

    const words = distributeWordsAcrossChunks(chunks);

    for (const word of words) {
      const owner = chunks.find((c) => c.text.includes(word.text.replace(/[.,!?]/g, '')))!;
      expect(word.fromMs).toBeGreaterThanOrEqual(owner.fromMs - 0.01);
      expect(word.toMs).toBeLessThanOrEqual(owner.toMs + 0.01);
    }
  });

  it('starts the first word exactly where the sentence starts', () => {
    const words = distributeWordsAcrossChunks([chunk('Một hai ba', 500, 2000)]);
    expect(words[0]!.fromMs).toBeCloseTo(500, 1);
  });

  it('produces strictly increasing, non-overlapping words', () => {
    const words = distributeWordsAcrossChunks([
      chunk('Một hai ba bốn năm', 0, 3000),
      chunk('sáu bảy tám', 3200, 5000),
    ]);

    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.fromMs).toBeGreaterThanOrEqual(words[i - 1]!.toMs);
    }
  });

  it('preserves word order and text', () => {
    const words = distributeWordsAcrossChunks([chunk('Thiết kế nhỏ gọn', 0, 2000)]);
    expect(words.map((w) => w.text)).toEqual(['Thiết', 'kế', 'nhỏ', 'gọn']);
  });

  it('gives every word a non-zero duration', () => {
    // A zero-length word would never highlight, so the caption would appear to
    // skip it entirely.
    const words = distributeWordsAcrossChunks([chunk('a b c d e f g h', 0, 400)]);
    for (const word of words) {
      expect(word.toMs).toBeGreaterThan(word.fromMs);
    }
  });

  it('spreads a sentence across roughly its whole span', () => {
    const words = distributeWordsAcrossChunks([chunk('một hai ba bốn', 1000, 5000)]);
    const first = words[0]!;
    const last = words[words.length - 1]!;

    expect(first.fromMs).toBeCloseTo(1000, 1);
    // The trailing gap means the last word ends slightly early, by design.
    expect(last.toMs).toBeGreaterThan(4500);
    expect(last.toMs).toBeLessThanOrEqual(5000);
  });

  it('gives digits more time than a single syllable', () => {
    // "2026" is four spoken syllables; treating it as one word would rush it
    // and push every later word early.
    const words = distributeWordsAcrossChunks([chunk('năm 2026 rồi', 0, 6000)]);
    const number = words.find((w) => w.text === '2026')!;
    const word = words.find((w) => w.text === 'năm')!;

    expect(number.toMs - number.fromMs).toBeGreaterThan(word.toMs - word.fromMs);
  });

  it('ignores tokens that carry no speech', () => {
    const words = distributeWordsAcrossChunks([chunk('một -- hai', 0, 2000)]);
    expect(words.map((w) => w.text)).toEqual(['một', 'hai']);
  });

  it('returns nothing for empty or zero-length input', () => {
    expect(distributeWordsAcrossChunks([])).toEqual([]);
    expect(distributeWordsAcrossChunks([chunk('', 0, 1000)])).toEqual([]);
    expect(distributeWordsAcrossChunks([chunk('một hai', 500, 500)])).toEqual([]);
  });

  it('survives a chunk whose text is only punctuation', () => {
    expect(distributeWordsAcrossChunks([chunk('...', 0, 500)])).toEqual([]);
  });
});
