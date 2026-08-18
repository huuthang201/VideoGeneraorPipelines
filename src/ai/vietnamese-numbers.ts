/**
 * Reads Vietnamese number words back into digits.
 *
 * The fact guard needs this because narration is written to be spoken. A
 * sourced "15.6 inch" reaches the storyboard as "mười lăm phẩy sáu inch", and a
 * guard that only understands digits either rejects the legitimate rewording or
 * - if it gives up and allows spelled numbers - lets an invented figure through
 * in exactly the form the model naturally produces.
 *
 * Parsing rather than generating: a single number has many valid spoken forms
 * ("ba trăm chín mươi chín nghìn", "ba trăm chín chín nghìn", "gần bốn trăm
 * nghìn"), so enumerating them all is hopeless. Reading what was written and
 * comparing values handles every variant at once.
 */

const DIGITS: Record<string, number> = {
  không: 0,
  một: 1,
  mốt: 1,
  hai: 2,
  ba: 3,
  bốn: 4,
  tư: 4,
  năm: 5,
  lăm: 5,
  nhăm: 5,
  sáu: 6,
  bảy: 7,
  bẩy: 7,
  tám: 8,
  chín: 9,
};

/** Multipliers that close a group, largest first. */
const SCALES: Record<string, number> = {
  nghìn: 1_000,
  ngàn: 1_000,
  triệu: 1_000_000,
  tỷ: 1_000_000_000,
  tỉ: 1_000_000_000,
};

const NUMBER_TOKENS = new Set([
  ...Object.keys(DIGITS),
  ...Object.keys(SCALES),
  'mười',
  'mươi',
  'trăm',
  'linh',
  'lẻ',
  'rưỡi',
  'phẩy',
  'chấm',
]);

export function isNumberWord(token: string): boolean {
  return NUMBER_TOKENS.has(token.toLowerCase());
}

export interface SpokenNumber {
  value: number;
  /** The words that produced it, so callers can judge how deliberate it was. */
  tokens: string[];
  /**
   * Other defensible readings of the same words.
   *
   * A run of bare digit words is ambiguous and both readings occur in real
   * narration: "ba không bốn" is how anyone reads the model number 304 aloud,
   * but the same words as a compound number come to 34. A guard that commits to
   * one reading rejects correctly-sourced copy - which is exactly what happened
   * to a "thép không gỉ 304" line whose 304 was right there in info.json.
   */
  alternates: number[];
}

/**
 * Every number spoken in a piece of text.
 *
 * Runs of adjacent number words are collected and evaluated as one value, so
 * "mười lăm phẩy sáu" yields 15.6 rather than 10, 5 and 6.
 *
 * The token list is returned alongside the value because a single number word
 * usually is not a number at all. Vietnamese reuses them as everyday
 * vocabulary - "một" is also the article, "không" is also negation, "năm" is
 * also "year" - so "Một câu không có con số nào" would otherwise read as
 * stating 1 and 0. Callers decide the threshold; the parser does not guess.
 */
export function spokenNumbersIn(text: string): SpokenNumber[] {
  const tokens = text
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  const values: SpokenNumber[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length > 0) {
      // A run made only of structural words states no figure. "nghìn" on its
      // own is the tail of "400 nghìn", where the digits were written as digits
      // - reading it as the number 1000 invented a claim the text never made.
      if (run.some((t) => DIGITS[t] !== undefined || t === 'mười')) {
        const value = parseSpokenNumber(run);
        if (value !== null) {
          values.push({ value, tokens: [...run], alternates: alternateReadings(run) });
        }
      }
      run = [];
    }
  };

  for (const token of tokens) {
    if (isNumberWord(token)) run.push(token);
    else flush();
  }
  flush();

  return values;
}

/** Evaluates one run of number words, or null if it says nothing numeric. */
export function parseSpokenNumber(tokens: readonly string[]): number | null {
  const decimalAt = tokens.findIndex((t) => t === 'phẩy' || t === 'chấm');

  if (decimalAt !== -1) {
    const whole = parseInteger(tokens.slice(0, decimalAt));
    const fractionTokens = tokens.slice(decimalAt + 1);
    if (whole === null || fractionTokens.length === 0) return null;

    // The fraction is read digit by digit: "phẩy sáu" is .6, "phẩy không năm"
    // is .05 - not "sixty-five hundredths".
    const digits = fractionTokens.map((t) => DIGITS[t]).filter((d) => d !== undefined);
    if (digits.length === 0) return null;

    return Number.parseFloat(`${whole}.${digits.join('')}`);
  }

  // "rưỡi" is a trailing half, as in "một triệu rưỡi".
  if (tokens[tokens.length - 1] === 'rưỡi') {
    const base = parseInteger(tokens.slice(0, -1));
    if (base === null) return null;
    const halfOfScale = trailingScale(tokens.slice(0, -1)) / 2;
    return base + (halfOfScale >= 1 ? halfOfScale : 0.5);
  }

  return parseInteger(tokens);
}

function trailingScale(tokens: readonly string[]): number {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const scale = SCALES[tokens[i]!];
    if (scale !== undefined) return scale;
    if (tokens[i] === 'trăm') return 100;
    if (tokens[i] === 'mười' || tokens[i] === 'mươi') return 10;
  }
  return 1;
}

function parseInteger(tokens: readonly string[]): number | null {
  let total = 0;
  let group = 0;
  let current: number | null = null;
  let sawAnything = false;

  for (const token of tokens) {
    const digit = DIGITS[token];
    if (digit !== undefined) {
      // Two digits in a row inside a group means the tens were elided:
      // "ba trăm chín chín" is 399, the second nine being the units.
      if (current !== null) {
        group += current * 10;
        current = digit;
      } else {
        current = digit;
      }
      sawAnything = true;
      continue;
    }

    switch (token) {
      case 'mười':
        // Standalone ten, or the tens part of "mười lăm".
        group += 10;
        current = null;
        sawAnything = true;
        break;

      case 'mươi':
        group += (current ?? 0) * 10;
        current = null;
        sawAnything = true;
        break;

      case 'trăm':
        group += (current ?? 0) * 100;
        current = null;
        sawAnything = true;
        break;

      case 'linh':
      case 'lẻ':
        // Placeholder for a skipped tens digit: "một trăm lẻ năm" is 105.
        break;

      default: {
        const scale = SCALES[token];
        if (scale === undefined) break;
        const groupValue = group + (current ?? 0);
        // A bare scale word means one of it: "nghìn" alone reads as 1000.
        total += (groupValue === 0 ? 1 : groupValue) * scale;
        group = 0;
        current = null;
        sawAnything = true;
        break;
      }
    }
  }

  if (!sawAnything) return null;
  return total + group + (current ?? 0);
}

/**
 * Readings other than the compound-number one.
 *
 * Only digit sequences are ambiguous: once a run contains a scale word
 * ("trăm", "nghìn", "mươi") its structure is explicit and there is nothing to
 * second-guess. So this returns the digit-by-digit concatenation, and only when
 * every token is a bare digit.
 */
function alternateReadings(tokens: readonly string[]): number[] {
  const digits: number[] = [];

  for (const token of tokens) {
    const digit = DIGITS[token];
    if (digit === undefined) return [];
    digits.push(digit);
  }

  if (digits.length < 2) return [];

  const concatenated = Number.parseInt(digits.join(''), 10);
  return Number.isFinite(concatenated) ? [concatenated] : [];
}
