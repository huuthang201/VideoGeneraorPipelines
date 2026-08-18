import { describe, expect, it } from 'vitest';
import { checkFacts } from '../../src/ai/fact-guard';
import { extractJson } from '../../src/ai/claude-code.provider';
import { checkStoryboardStructure, type StoryboardDraft } from '../../src/domain/storyboard';
import type { ProductInfo } from '../../src/domain/project';

const INFO: ProductInfo = {
  name: 'Baseus Bowie MA10',
  category: 'Tai nghe Bluetooth',
  price: 399000,
  currency: 'VND',
  features: ['Chống ồn ANC', 'Bluetooth 5.3', 'Thời lượng pin dài'],
  targetAudience: ['Sinh viên', 'Người đi làm'],
  cta: 'Xem sản phẩm ở link bên dưới',
};

function draft(overrides: {
  hook?: string;
  cta?: string;
  scenes?: Partial<StoryboardDraft['scenes'][number]>[];
}): StoryboardDraft {
  const scenes = (overrides.scenes ?? [{}, {}, {}]).map((s, i) => ({
    id: s.id ?? `scene-0${i + 1}`,
    type: s.type ?? (i === 0 ? 'hook' : i === (overrides.scenes ?? [{}, {}, {}]).length - 1 ? 'cta' : 'feature'),
    asset: s.asset ?? '01.jpg',
    headline: s.headline ?? 'Tiêu đề',
    narration: s.narration ?? 'Một câu bình thường không có con số nào.',
    duration: s.duration ?? 4,
    animation: s.animation ?? 'zoom-in',
    transition: s.transition ?? 'cut',
  })) as StoryboardDraft['scenes'];

  return {
    version: '1.0',
    project: { id: 'p', productName: 'P' },
    video: { style: 'tiktok-fast' },
    voice: { voice: 'vi-VN-HoaiMyNeural' },
    content: {
      hook: overrides.hook ?? 'Một câu hook',
      narration: '',
      cta: overrides.cta ?? 'Xem link bên dưới',
    },
    scenes,
  };
}

describe('fact guard with a sourced price', () => {
  it('allows the price from info.json in its various written forms', () => {
    for (const text of ['Chỉ 399.000đ thôi', 'Giá 399k', 'Giá 399 nghìn']) {
      const result = checkFacts(draft({ scenes: [{ narration: text }, {}, {}] }), INFO);
      expect(result.violations.filter((v) => v.kind === 'price')).toEqual([]);
    }
  });

  it('rejects a price that is not the one in info.json', () => {
    const result = checkFacts(draft({ scenes: [{ narration: 'Chỉ 199.000đ thôi' }, {}, {}] }), INFO);

    expect(result.ok).toBe(false);
    expect(result.violations[0]!.kind).toBe('price');
    expect(result.violations[0]!.matched).toContain('199');
  });

  it('allows a fair rounding of the sourced price', () => {
    // Observed on the first real AI run: asked to hook a 399,000đ product, the
    // model wrote "dưới 400 nghìn". That is true and idiomatic, and rejecting
    // it burned a retry on correct output.
    for (const text of ['Chưa tới 400 nghìn', 'Tầm 400K', 'Khoảng 390.000đ']) {
      const result = checkFacts(draft({ scenes: [{ narration: text }, {}, {}] }), INFO);
      expect(result.violations.filter((v) => v.kind === 'price')).toEqual([]);
    }
  });

  it('still rejects a figure outside the rounding band', () => {
    // 15% of 399,000 is about 60,000 - "300 nghìn" is well beyond it and would
    // misrepresent what the buyer pays.
    for (const text of ['Chỉ 300 nghìn', 'Giá 199.000đ', 'Tầm 1 triệu']) {
      const result = checkFacts(draft({ scenes: [{ narration: text }, {}, {}] }), INFO);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects an invented promotion even when a price is sourced', () => {
    // No info.json content can make up for a free-shipping promise nobody made.
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Đang giảm giá và freeship toàn quốc' }, {}, {}] }),
      INFO,
    );

    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.kind)).toContain('promotion');
  });

  it('rejects an invented warranty', () => {
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Bảo hành mười hai tháng chính hãng' }, {}, {}] }),
      INFO,
    );

    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.kind)).toEqual(
      expect.arrayContaining(['warranty', 'certification']),
    );
  });

  it('accepts a rephrased feature rather than demanding a quote', () => {
    // The model is meant to write naturally, so "chống ồn" must pass on the
    // strength of "Chống ồn ANC" being in info.json.
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Có chống ồn nên nghe nhạc yên tĩnh hơn.' }, {}, {}] }),
      INFO,
    );

    expect(result.ok).toBe(true);
  });

  it('passes a clean storyboard', () => {
    const result = checkFacts(
      draft({
        hook: 'Tai nghe này thế nào?',
        scenes: [
          { narration: 'Thiết kế nhỏ gọn, cầm vừa tay.' },
          { narration: 'Chống ồn hoạt động khá tốt.' },
          { narration: 'Xem link bên dưới nhé.' },
        ],
      }),
      INFO,
    );

    expect(result.ok).toBe(true);
    expect(result.feedback).toBe('');
  });
});

describe('fact guard in strict mode', () => {
  const NO_PRICE: ProductInfo = { name: 'Tai nghe', category: 'Tai nghe' };

  it('rejects any price when info.json has none', () => {
    const result = checkFacts(draft({ scenes: [{ narration: 'Chỉ 399K thôi' }, {}, {}] }), NO_PRICE);

    expect(result.ok).toBe(false);
    expect(result.violations[0]!.kind).toBe('price');
  });

  it('rejects a price spelled out in words, not just digits', () => {
    // The realistic failure: narration is written to be read aloud, so an
    // invented price arrives as "ba trăm chín chín nghìn" and a digit-only
    // check would pass it straight through.
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Giá chỉ ba trăm chín chín nghìn thôi.' }, {}, {}] }),
      NO_PRICE,
    );

    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.kind === 'price')).toBe(true);
  });

  it('rejects a bare specification figure', () => {
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Pin dùng được 30 giờ liền.' }, {}, {}] }),
      NO_PRICE,
    );

    expect(result.ok).toBe(false);
  });

  it('applies with no info.json at all', () => {
    const result = checkFacts(draft({ scenes: [{ narration: 'Giá 250.000đ' }, {}, {}] }), null);
    expect(result.ok).toBe(false);
  });

  it('still allows purely descriptive narration', () => {
    const result = checkFacts(
      draft({
        scenes: [
          { narration: 'Nhìn khá nhỏ gọn và chắc chắn.' },
          { narration: 'Màu sắc trông sạch sẽ, dễ phối đồ.' },
          { narration: 'Xem thêm ở link bên dưới nhé.' },
        ],
      }),
      NO_PRICE,
    );

    expect(result.ok).toBe(true);
  });
});

describe('Vietnamese word boundaries', () => {
  // Regression guard. The patterns originally used \b, which JavaScript defines
  // over [A-Za-z0-9_] even under /u - so it never matches next to a Vietnamese
  // letter. /\d+đ\b/ therefore failed to match "199.000đ", and the guard waved
  // invented prices through while its tests appeared to pass, because nothing
  // matched at all rather than because nothing was wrong.
  const NO_PRICE: ProductInfo = { name: 'Tai nghe' };

  it.each([
    ['199.000đ', 'currency suffix đ'],
    ['250.000 VNĐ', 'currency word VNĐ'],
    ['1.2 triệu', 'unit triệu'],
    ['500 nghìn', 'unit nghìn'],
    ['3 tỷ', 'unit tỷ ending in a non-ASCII letter'],
  ])('catches a price written as "%s" (%s)', (text) => {
    const result = checkFacts(draft({ scenes: [{ narration: `Giá ${text} thôi.` }, {}, {}] }), NO_PRICE);
    expect(result.ok).toBe(false);
  });

  it.each(['giảm giá', 'ưu đãi', 'tặng kèm', 'đổi trả', 'kiểm định'])(
    'catches the claim "%s" despite its non-ASCII ending',
    (claim) => {
      const result = checkFacts(
        draft({ scenes: [{ narration: `Sản phẩm có ${claim} nhé.` }, {}, {}] }),
        INFO,
      );
      expect(result.ok).toBe(false);
    },
  );

  it('does not fire on a word that merely contains a claim as a substring', () => {
    // "sale" inside "salemall" is not a promotion claim; the boundary has to
    // still behave like a boundary once it is Unicode-aware.
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Tên shop là salemall nhé.' }, {}, {}] }),
      INFO,
    );
    expect(result.violations.filter((v) => v.kind === 'promotion')).toEqual([]);
  });
});

describe('specifications without a price', () => {
  // Regression suite for a false positive found on a real product. A backpack
  // whose info.json listed "Ngăn laptop 15.6 inch" but carried no price had its
  // correctly-sourced "mười lăm phẩy sáu inch" rejected, with a message
  // complaining about a price nobody had mentioned. Strict mode was keyed on
  // the absence of a price rather than the absence of any sourced figure, so
  // every product with specs and no price was unusable.
  const SPECS_NO_PRICE: ProductInfo = {
    name: 'Balo laptop chống nước Xmark',
    category: 'Balo laptop',
    features: ['Chống nước', 'Ngăn laptop 15.6 inch', 'Cổng sạc USB'],
  };

  it('accepts a sourced specification spoken aloud', () => {
    const result = checkFacts(
      draft({
        scenes: [
          { narration: 'Ngăn riêng vừa laptop mười lăm phẩy sáu inch.' },
          {},
          {},
        ],
      }),
      SPECS_NO_PRICE,
    );

    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts the same specification written in digits', () => {
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Ngăn laptop 15.6 inch.' }, {}, {}] }),
      SPECS_NO_PRICE,
    );
    expect(result.ok).toBe(true);
  });

  it('still rejects a specification that was never sourced', () => {
    // The guard must not have been loosened into uselessness: 17 inches is not
    // in info.json and must still be caught.
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Ngăn laptop mười bảy inch.' }, {}, {}] }),
      SPECS_NO_PRICE,
    );
    expect(result.ok).toBe(false);
  });

  it('still rejects an invented price for a product that has none', () => {
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Giá chỉ ba trăm chín chín nghìn.' }, {}, {}] }),
      SPECS_NO_PRICE,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]!.kind).toBe('price');
  });
});

describe('everyday words that are also numerals', () => {
  // "một" is the article, "không" is negation, "năm" is "year". Reading these
  // as stated figures made ordinary narration fail the guard.
  const INFO_NO_NUMBERS: ProductInfo = { name: 'Tai nghe', category: 'Tai nghe' };

  it.each([
    'Một chiếc tai nghe rất đáng thử.',
    'Không có gì phải phàn nàn cả.',
    'Năm nay mẫu này bán khá chạy.',
    'Ba mẹ mình cũng thích dùng cái này.',
  ])('does not treat "%s" as stating a figure', (narration) => {
    const result = checkFacts(draft({ scenes: [{ narration }, {}, {}] }), INFO_NO_NUMBERS);
    expect(result.ok).toBe(true);
  });

  it('still catches a deliberate multi-word figure', () => {
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Pin dùng được hai mươi giờ.' }, {}, {}] }),
      INFO_NO_NUMBERS,
    );
    expect(result.ok).toBe(false);
  });
});

describe('digit sequences read aloud', () => {
  // Regression suite for a false positive that failed a correct storyboard.
  // "Thép không gỉ 304" is read aloud as "ba không bốn" - digit by digit, as
  // anyone reads a model number. The parser took consecutive digit words as a
  // compound number with elided tens and got 34, which is not in info.json, so
  // a line whose 304 came straight from the product data was rejected.
  const SPEC: ProductInfo = {
    name: 'Bình giữ nhiệt',
    features: ['Thép không gỉ 304', 'Giữ nóng 12 tiếng'],
    price: 285000,
  };

  it('accepts a model number read digit by digit', () => {
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Thân thép không gỉ ba không bốn, chắc lắm.' }, {}, {}] }),
      SPEC,
    );
    expect(result.violations).toEqual([]);
  });

  it('accepts the same number read as a compound', () => {
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Thép ba trăm lẻ bốn nha.' }, {}, {}] }),
      SPEC,
    );
    expect(result.ok).toBe(true);
  });

  it('still rejects a spoken figure carrying a unit', () => {
    // The loosening must not become a rubber stamp. A unit is what makes a
    // number a claim, and "tám tiếng" contradicts the sourced 12 hours.
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Giữ nóng được tám tiếng thôi.' }, {}, {}] }),
      SPEC,
    );
    expect(result.ok).toBe(false);
  });

  it('still rejects a spoken price', () => {
    // A scale word sits inside the run, so this is caught by the run's own
    // shape rather than by what follows it.
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Giá chỉ chín trăm nghìn nhé.' }, {}, {}] }),
      SPEC,
    );
    expect(result.ok).toBe(false);
    expect(result.feedback).toMatch(/reads as|does not appear/);
  });

  it('allows a clock time, which claims nothing about the product', () => {
    // "bảy giờ sáng" is when the narrator made tea, not a specification.
    // Treating "giờ" as a unit failed three regenerations in a row on copy that
    // was entirely accurate.
    const result = checkFacts(
      draft({
        scenes: [
          { narration: 'Pha trà lúc bảy giờ sáng, tám giờ tối vẫn còn nóng.' },
          {},
          {},
        ],
      }),
      SPEC,
    );
    expect(result.ok).toBe(true);
  });

  it('still checks a duration, which is a specification', () => {
    // "tiếng" is how a duration claim is actually written, and this one
    // contradicts the sourced 12 hours.
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Giữ nóng được tám tiếng thôi.' }, {}, {}] }),
      SPEC,
    );
    expect(result.ok).toBe(false);
  });

  it('allows a bare figure with no unit, by design', () => {
    // A deliberate trade-off. "thử bảy tám lần" claims nothing about the
    // product, and checking every unitless number against the product data
    // failed good narration and burned a Claude retry each time. Prices and
    // specifications always carry a unit or a scale word, so the protection
    // that matters is unaffected.
    const result = checkFacts(
      draft({ scenes: [{ narration: 'Tôi thử bảy tám lần rồi mới tin.' }, {}, {}] }),
      SPEC,
    );
    expect(result.ok).toBe(true);
  });
});

describe('fact guard feedback', () => {
  it('names the scene and field so a retry can be targeted', () => {
    const result = checkFacts(
      draft({ scenes: [{ id: 'scene-42', narration: 'Chỉ 199.000đ' }, {}, {}] }),
      INFO,
    );

    expect(result.feedback).toContain('scene-42');
    expect(result.feedback).toContain('narration');
    expect(result.feedback).toContain('199');
  });

  it('checks the hook and cta, not only scene text', () => {
    const result = checkFacts(draft({ hook: 'Giảm giá còn 99.000đ!' }), INFO);
    expect(result.violations.some((v) => v.field === 'content.hook')).toBe(true);
  });
});

describe('checkStoryboardStructure', () => {
  const assets = ['01.jpg', '02.jpg', '03.jpg'];

  it('accepts a well-formed storyboard', () => {
    expect(checkStoryboardStructure(draft({}), assets)).toEqual([]);
  });

  it('requires the first scene to be a hook', () => {
    const d = draft({});
    d.scenes[0]!.type = 'feature';
    expect(checkStoryboardStructure(d, assets).join(' ')).toMatch(/First scene must have type "hook"/);
  });

  it('requires the last scene to be a cta', () => {
    const d = draft({});
    d.scenes[d.scenes.length - 1]!.type = 'feature';
    expect(checkStoryboardStructure(d, assets).join(' ')).toMatch(/Last scene must have type "cta"/);
  });

  it('rejects a reference to an image that does not exist', () => {
    // Otherwise the failure surfaces much later as a blank frame.
    const d = draft({});
    d.scenes[1]!.asset = 'imaginary.jpg';
    expect(checkStoryboardStructure(d, assets).join(' ')).toMatch(/imaginary\.jpg/);
  });

  it('rejects duplicate scene ids', () => {
    const d = draft({});
    d.scenes[1]!.id = d.scenes[0]!.id;
    expect(checkStoryboardStructure(d, assets).join(' ')).toMatch(/Duplicate scene id/);
  });
});

describe('extractJson', () => {
  it('reads a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads an object inside a fenced block', () => {
    expect(extractJson('Đây là kết quả:\n```json\n{"a":1}\n```\nXong.')).toEqual({ a: 1 });
  });

  it('reads an object surrounded by prose', () => {
    expect(extractJson('Sure, here you go: {"a":{"b":2}} — hope that helps!')).toEqual({
      a: { b: 2 },
    });
  });

  it('does not stop early on a nested object', () => {
    const value = { scenes: [{ id: 'a' }, { id: 'b' }], meta: { nested: { deep: true } } };
    expect(extractJson(JSON.stringify(value))).toEqual(value);
  });

  it('is not confused by braces inside strings', () => {
    expect(extractJson('{"text":"a } brace and a { one"}')).toEqual({
      text: 'a } brace and a { one',
    });
  });

  it('returns null when there is no JSON', () => {
    expect(extractJson('Xin lỗi, tôi không thể làm việc này.')).toBeNull();
  });

  it('returns null for malformed JSON rather than throwing', () => {
    expect(extractJson('{"a": }')).toBeNull();
  });
});
