import { describe, expect, it } from 'vitest';
import { parseSpokenNumber, spokenNumbersIn } from '../../src/ai/vietnamese-numbers';

const parse = (text: string) => parseSpokenNumber(text.split(/\s+/));

describe('parseSpokenNumber', () => {
  it.each([
    ['không', 0],
    ['một', 1],
    ['năm', 5],
    ['mười', 10],
    ['mười lăm', 15],
    ['hai mươi', 20],
    ['hai mươi tư', 24],
    ['một trăm', 100],
    ['một trăm lẻ năm', 105],
    ['ba trăm chín mươi chín', 399],
    ['một nghìn', 1000],
    ['hai nghìn không trăm hai mươi sáu', 2026],
  ])('reads "%s" as %i', (text, expected) => {
    expect(parse(text)).toBe(expected);
  });

  it('handles the elided tens common in speech', () => {
    // "ba trăm chín chín nghìn" is how a narrator says 399,000 - the tens word
    // is dropped and the second nine carries the units.
    expect(parse('ba trăm chín chín')).toBe(399);
    expect(parse('ba trăm chín chín nghìn')).toBe(399_000);
  });

  it('reads large scales', () => {
    expect(parse('ba trăm chín mươi chín nghìn')).toBe(399_000);
    expect(parse('hai triệu')).toBe(2_000_000);
    expect(parse('một tỷ')).toBe(1_000_000_000);
  });

  it('reads decimals digit by digit after phẩy', () => {
    expect(parse('mười lăm phẩy sáu')).toBe(15.6);
    expect(parse('mười lăm chấm sáu')).toBe(15.6);
    expect(parse('một phẩy không năm')).toBe(1.05);
  });

  it('reads rưỡi as a trailing half of the preceding scale', () => {
    expect(parse('một triệu rưỡi')).toBe(1_500_000);
    expect(parse('hai trăm rưỡi')).toBe(250);
  });

  it('returns null when nothing numeric was said', () => {
    expect(parseSpokenNumber([])).toBeNull();
    expect(parseSpokenNumber(['phẩy'])).toBeNull();
  });
});

describe('spokenNumbersIn', () => {
  const values = (text: string) => spokenNumbersIn(text).map((n) => n.value);

  it('finds a number embedded in a sentence', () => {
    expect(values('Ngăn laptop mười lăm phẩy sáu inch rất vừa.')).toEqual([15.6]);
  });

  it('keeps adjacent number words together as one value', () => {
    // The whole point: "mười lăm phẩy sáu" must not come back as 10, 5 and 6,
    // or a sourced 15.6 would never match.
    expect(values('mười lăm phẩy sáu')).toEqual([15.6]);
  });

  it('separates numbers divided by other words', () => {
    expect(values('Giá ba trăm nghìn cho hai cái.')).toEqual([300_000, 2]);
  });

  it('returns nothing for text with no numbers', () => {
    expect(values('Thiết kế nhỏ gọn và chắc chắn.')).toEqual([]);
  });

  it('reports how many words produced each value', () => {
    // Callers need this to tell a deliberate figure from an ordinary word that
    // happens to be a numeral: "năm" is usually "year", "một" usually "a".
    const [lone] = spokenNumbersIn('năm nay');
    expect(lone).toEqual({ value: 5, tokens: ['năm'] });

    const [deliberate] = spokenNumbersIn('mười lăm phẩy sáu inch');
    expect(deliberate!.tokens.length).toBeGreaterThan(1);
  });

  it('reads everyday vocabulary as single-token runs, never as phrases', () => {
    // "Một câu không có con số nào" means "a sentence with no numbers" - both
    // numerals here are ordinary words and must stay separable.
    for (const n of spokenNumbersIn('Một câu bình thường không có con số nào.')) {
      expect(n.tokens.length).toBe(1);
    }
  });
});
