import { describe, expect, it } from 'vitest';
import {
  alignByProportion,
  alignScenesToWords,
  normalizeForAlignment,
  similarity,
} from '../../src/tts/align';
import type { WordTiming } from '../../src/tts/types';

/** Builds evenly-spaced word timings, the way a steady narrator would sound. */
function words(text: string, startMs = 0, perWordMs = 300): WordTiming[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => ({
      text: word,
      fromMs: startMs + i * perWordMs,
      toMs: startMs + (i + 1) * perWordMs - 40,
    }));
}

describe('normalizeForAlignment', () => {
  it('strips case, punctuation and spacing but keeps Vietnamese diacritics', () => {
    expect(normalizeForAlignment('Chống ồn ANC!')).toBe('chốngồnanc');
    expect(normalizeForAlignment('Giá chỉ 399.000đ?')).toBe('giáchỉ399000đ');
  });

  it('treats diacritics as meaningful, not noise', () => {
    // "ma" and "mà" are different words; normalising them together would make
    // alignment think two different scripts matched.
    expect(normalizeForAlignment('ma')).not.toBe(normalizeForAlignment('mà'));
  });
});

describe('alignScenesToWords', () => {
  const scenes = [
    { id: 'scene-01', narration: 'Tai nghe này có đáng mua' },
    { id: 'scene-02', narration: 'Thiết kế nhỏ gọn dễ mang theo' },
    { id: 'scene-03', narration: 'Xem link bên dưới nhé' },
  ];

  it('splits a clean track at the right scene boundaries', () => {
    const all = words(scenes.map((s) => s.narration).join(' '));
    const result = alignScenesToWords(scenes, all)!;

    expect(result).not.toBeNull();
    expect(result.scenes).toHaveLength(3);
    expect(result.usedFallback).toBe(false);
    expect(result.confidence).toBeGreaterThan(0.95);

    // Every word is accounted for exactly once.
    const total = result.scenes.reduce((n, s) => n + s.words.length, 0);
    expect(total).toBe(all.length);

    expect(result.scenes[0]!.words.map((w) => w.text)).toEqual([
      'Tai', 'nghe', 'này', 'có', 'đáng', 'mua',
    ]);
    expect(result.scenes[2]!.words.map((w) => w.text)).toEqual([
      'Xem', 'link', 'bên', 'dưới', 'nhé',
    ]);
  });

  it('produces boundaries that only move forwards', () => {
    const result = alignScenesToWords(scenes, words(scenes.map((s) => s.narration).join(' ')))!;
    let previous = -1;
    for (const scene of result.scenes) {
      expect(scene.startMs).toBeGreaterThanOrEqual(previous);
      expect(scene.endMs).toBeGreaterThanOrEqual(scene.startMs);
      previous = scene.endMs;
    }
  });

  it('survives the service expanding a number into spoken words', () => {
    // This is the concrete reason alignment matches on character position
    // rather than token identity: "399K" comes back as several words that
    // appear nowhere in the script.
    const scripted = [
      { id: 'a', narration: 'Tai nghe giá 399K' },
      { id: 'b', narration: 'Chống ồn rất tốt' },
    ];
    const spoken = words('Tai nghe giá ba trăm chín chín nghìn Chống ồn rất tốt');

    const result = alignScenesToWords(scripted, spoken)!;

    expect(result.scenes).toHaveLength(2);
    // Scene b must still end up with its own words, not be swallowed by a.
    expect(result.scenes[1]!.words.length).toBeGreaterThanOrEqual(3);
    expect(result.scenes[1]!.words.map((w) => w.text)).toContain('tốt');
    // No word is lost or duplicated.
    expect(result.scenes[0]!.words.length + result.scenes[1]!.words.length).toBe(spoken.length);
  });

  it('never leaves a narrating scene with zero words', () => {
    // A scene with no words would collapse to the minimum duration and its
    // captions would vanish.
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`,
      narration: `Câu số ${i} ở đây`,
    }));
    const all = words(many.map((s) => s.narration).join(' '));

    const result = alignScenesToWords(many, all)!;
    for (const scene of result.scenes) {
      expect(scene.words.length).toBeGreaterThan(0);
    }
  });

  it('gives every trailing word to the last scene', () => {
    const scripted = [
      { id: 'a', narration: 'Ngắn' },
      { id: 'b', narration: 'Dài hơn nhiều' },
    ];
    const spoken = words('Ngắn Dài hơn nhiều và thêm vài từ nữa');
    const result = alignScenesToWords(scripted, spoken)!;

    const last = result.scenes[1]!;
    expect(last.words[last.words.length - 1]!.text).toBe('nữa');
    expect(last.endMs).toBe(spoken[spoken.length - 1]!.toMs);
  });

  it('returns null when there is nothing to align', () => {
    expect(alignScenesToWords([], words('a b c'))).toBeNull();
    expect(alignScenesToWords(scenes, [])).toBeNull();
  });

  it('handles a single scene owning the whole track', () => {
    const all = words('Một câu duy nhất cho toàn bộ video');
    const result = alignScenesToWords([{ id: 'only', narration: 'Một câu duy nhất' }], all)!;
    expect(result.scenes[0]!.words).toHaveLength(all.length);
  });

  it('reports low confidence when the spoken text barely resembles the script', () => {
    const result = alignScenesToWords(
      [{ id: 'a', narration: 'Tai nghe chống ồn' }],
      words('completely different english words here'),
    )!;
    expect(result.confidence).toBeLessThan(0.3);
    // Still produces usable boundaries rather than throwing.
    expect(result.scenes[0]!.words.length).toBeGreaterThan(0);
  });
});

describe('alignByProportion', () => {
  it('splits the measured duration by how much text each scene carries', () => {
    const result = alignByProportion(
      [
        { id: 'a', narration: 'bốn từ ở đây' },
        { id: 'b', narration: 'tám từ ở đây thì dài gấp đôi luôn nhé' },
      ],
      12_000,
    );

    expect(result.usedFallback).toBe(true);
    expect(result.scenes[0]!.startMs).toBe(0);
    expect(result.scenes[1]!.endMs).toBe(12_000);
    // The longer line gets the larger share.
    const first = result.scenes[0]!.endMs - result.scenes[0]!.startMs;
    const second = result.scenes[1]!.endMs - result.scenes[1]!.startMs;
    expect(second).toBeGreaterThan(first);
  });

  it('always spans exactly the audio it was given', () => {
    const result = alignByProportion(
      [
        { id: 'a', narration: 'một' },
        { id: 'b', narration: 'hai' },
        { id: 'c', narration: 'ba' },
      ],
      9_000,
    );
    expect(result.scenes[0]!.startMs).toBe(0);
    expect(result.scenes[result.scenes.length - 1]!.endMs).toBe(9_000);
  });
});

describe('similarity', () => {
  it('scores identical strings 1 and unrelated ones near 0', () => {
    expect(similarity('chốngồn', 'chốngồn')).toBe(1);
    expect(similarity('chốngồn', 'xyzabc')).toBeLessThan(0.2);
  });

  it('stays high when text is inserted rather than replaced', () => {
    expect(similarity('tainghegia', 'tainghegiabatramchinchin')).toBeGreaterThan(0.5);
  });
});
