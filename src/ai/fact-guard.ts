import type { ProductInfo } from '../domain/project';
import type { StoryboardDraft } from '../domain/storyboard';
import { spokenNumbersIn } from './vietnamese-numbers';

/**
 * Stops the model asserting facts about a product that nobody gave it
 * (spec §5).
 *
 * A prompt instruction is not enough here and neither is a schema. Schemas
 * check shape, and "chỉ 399K" is a perfectly well-shaped string; the model can
 * follow an instruction ninety-nine times and invent a warranty on the
 * hundredth. Since these videos make commercial claims to real buyers, the rule
 * needs a mechanical check rather than good intentions.
 *
 * The approach is a whitelist: pull every number and claim out of info.json,
 * then scan the storyboard for anything factual that is not on that list. What
 * remains is by definition unsourced.
 */

export interface FactViolation {
  kind: 'price' | 'number' | 'promotion' | 'warranty' | 'certification';
  sceneId: string | null;
  field: string;
  matched: string;
  message: string;
}

/**
 * Word boundaries that work on Vietnamese.
 *
 * JavaScript's \b is defined in terms of \w, which is [A-Za-z0-9_] even under
 * the /u flag. So \b never matches next to đ, á, ệ or any other Vietnamese
 * letter, and a pattern like /\d+đ\b/ silently fails to match "399.000đ".
 *
 * That is not a cosmetic problem here: it meant the guard was letting invented
 * prices ending in "đ", "nghìn" or "triệu" through untouched, while appearing
 * to pass its tests because nothing matched at all. Unicode-aware lookaround
 * replaces \b throughout.
 */
const B_START = '(?<![\\p{L}\\p{N}])';
const B_END = '(?![\\p{L}\\p{N}])';

const u = (source: string): RegExp => new RegExp(source, 'giu');

/**
 * Marketing claims that imply a commitment the seller has to honour. These are
 * flagged on sight: unlike a number, there is no version of info.json that
 * makes an invented free-shipping promise acceptable.
 */
const CLAIM_PATTERNS: { kind: FactViolation['kind']; pattern: RegExp; label: string }[] = [
  {
    kind: 'promotion',
    pattern: u(
      `${B_START}(giảm giá|khuyến mãi|sale|freeship|miễn phí vận chuyển|tặng kèm|ưu đãi)${B_END}`,
    ),
    label: 'promotion',
  },
  {
    kind: 'warranty',
    pattern: u(`${B_START}(bảo hành|đổi trả|hoàn tiền)${B_END}`),
    label: 'warranty',
  },
  {
    kind: 'certification',
    pattern: u(`${B_START}(chính hãng|chứng nhận|kiểm định|đạt chuẩn|cam kết)${B_END}`),
    label: 'certification',
  },
];

export interface FactGuardResult {
  ok: boolean;
  violations: FactViolation[];
  /** Ready to paste into a retry prompt. */
  feedback: string;
}

export function checkFacts(draft: StoryboardDraft, info: ProductInfo | null): FactGuardResult {
  const violations: FactViolation[] = [];
  const allowed = buildWhitelist(info);
  const allowedNumbers = buildNumberWhitelist(info);

  /**
   * Strict mode is about whether any figure is sourced at all - not about
   * whether a *price* happens to be present.
   *
   * Keying it on the price was wrong in a way that only showed up on a real
   * product: a bag whose info.json listed "Ngăn laptop 15.6 inch" but no price
   * had its perfectly sourced "mười lăm phẩy sáu inch" rejected, with an error
   * message complaining about a price that was never in question. Products with
   * specifications and no price are ordinary, so that false positive made the
   * guard unusable for them.
   */
  const strict = allowedNumbers.size === 0;

  for (const field of collectTextFields(draft)) {
    // Numbers are checked by value, in whichever form they were written.
    // Narration spells them out because it is read aloud, so both the digits
    // and the spoken words have to resolve to something info.json supports.
    const stated = [
      ...digitsIn(field.text),
      ...moneyIn(field.text),
      // A lone number word is almost always ordinary Vietnamese rather than a
      // figure, so only deliberate multi-word runs count. "mười lăm phẩy sáu"
      // is a measurement; the "một" in "một chiếc tai nghe" is an article.
      ...spokenNumbersIn(field.text)
        .filter((n) => n.tokens.length >= 2)
        .map((n) => n.value),
    ];

    for (const value of stated) {
      if (isNumberAllowed(value, allowedNumbers)) continue;

      violations.push({
        // Price-magnitude figures are called out as such: it is the difference
        // between misquoting a spec and misquoting what the buyer will pay.
        kind: value >= PRICE_THRESHOLD ? 'price' : 'number',
        sceneId: field.sceneId,
        field: field.name,
        matched: String(value),
        message: strict
          ? `"${field.text}" states the figure ${value}, but info.json contains no numbers to support it. ` +
            'Describe what is visible in the photos instead.'
          : `The figure ${value} does not appear in info.json. Allowed values: ${[...allowedNumbers].join(', ')}.`,
      });
    }

    for (const { kind, pattern, label } of CLAIM_PATTERNS) {
      for (const match of field.text.matchAll(pattern)) {
        const text = match[0].trim();
        if (isAllowed(text, allowed)) continue;
        violations.push({
          kind,
          sceneId: field.sceneId,
          field: field.name,
          matched: text,
          message: `"${text}" makes a ${label} claim that does not appear in info.json.`,
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    feedback: formatFeedback(violations),
  };
}

/**
 * Amounts written with a unit attached: "399k", "400 nghìn", "1.2 triệu".
 * digitsIn alone would read those as 399, 400 and 1.2 and compare the wrong
 * magnitude against the whitelist.
 */
function moneyIn(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(
    u(`${B_START}\\d[\\d.,]*\\s*(?:k|nghìn|ngàn|triệu|tỷ|tỉ|đ|vnđ|vnd|₫)${B_END}`),
  )) {
    const value = parseVietnameseMoney(match[0]);
    if (value !== null) values.push(value);
  }
  return values;
}

/** Unit suffixes that change a figure's magnitude, so moneyIn must own them. */
const UNIT_SUFFIX = /^\s*(?:k|nghìn|ngàn|triệu|tỷ|tỉ|đ|vnđ|vnd|₫)(?![\p{L}\p{N}])/iu;

/** Numeric values written as digits, including decimals and grouped thousands. */
function digitsIn(text: string): number[] {
  const values: number[] = [];

  for (const match of text.matchAll(/\d[\d.,]*/gu)) {
    const raw = match[0].replace(/[.,]$/, '');

    // "399K" is 399,000, not 399. Leaving it to moneyIn avoids reporting the
    // same figure twice at two different magnitudes, where the bare reading
    // would be both wrong and the one the caller sees first.
    const rest = text.slice(match.index + match[0].length);
    if (UNIT_SUFFIX.test(rest)) continue;

    // "399.000" is three hundred and ninety-nine thousand in Vietnamese
    // convention, whereas "15.6" is a decimal. Groups of exactly three digits
    // after the separator mark a thousands separator.
    const asGrouped = raw.replace(/[.,](?=\d{3}\b)/g, '');
    const normalized = asGrouped.replace(',', '.');

    const value = Number.parseFloat(normalized);
    if (Number.isFinite(value)) values.push(value);
  }

  return values;
}

/**
 * Above this, a figure is treated as a price and gets the rounding tolerance
 * below. Beneath it a figure is a specification, where 15.6 inches is simply
 * not 16 inches and only an exact match will do.
 */
const PRICE_THRESHOLD = 1000;

function isNumberAllowed(value: number, allowedNumbers: ReadonlySet<number>): boolean {
  for (const allowed of allowedNumbers) {
    if (allowed === value) return true;

    if (allowed >= PRICE_THRESHOLD && value >= PRICE_THRESHOLD) {
      if (Math.abs(value - allowed) / allowed <= PRICE_TOLERANCE) return true;
    }
  }
  return false;
}

/** Every number info.json supports, from any field - not only the price. */
function buildNumberWhitelist(info: ProductInfo | null): Set<number> {
  const numbers = new Set<number>();
  if (!info) return numbers;

  const harvest = (value: string | number | undefined) => {
    if (value === undefined) return;
    if (typeof value === 'number') {
      numbers.add(value);
      return;
    }
    for (const found of digitsIn(value)) numbers.add(found);
  };

  harvest(info.price);
  harvest(info.name);
  harvest(info.category);
  harvest(info.brand);
  for (const feature of info.features ?? []) harvest(feature);
  for (const audience of info.targetAudience ?? []) harvest(audience);

  // A price of 399000 is also spoken as "399 nghìn", so the shorthand counts as
  // the same sourced fact rather than a new claim.
  if (info.price !== undefined) {
    const price = typeof info.price === 'number' ? info.price : digitsIn(info.price)[0];
    if (price !== undefined && price >= 1000) {
      numbers.add(price / 1000);
      numbers.add(Math.round(price / 1000));
    }
  }

  return numbers;
}

/**
 * Everything the model is permitted to assert, normalised for comparison.
 *
 * Feature strings go in whole *and* word by word, because the model is expected
 * to rephrase "Chống ồn ANC" rather than quote it, and rejecting a legitimate
 * rewording would make the guard unusable.
 */
function buildWhitelist(info: ProductInfo | null): Set<string> {
  const allowed = new Set<string>();
  if (!info) return allowed;

  const add = (value: string | number | undefined) => {
    if (value === undefined) return;
    const text = String(value).toLowerCase();
    allowed.add(normalize(text));
    for (const token of text.split(/[\s,/]+/)) {
      if (token.length > 1) allowed.add(normalize(token));
    }
  };

  add(info.price);
  add(info.name);
  add(info.brand);
  add(info.category);
  add(info.cta);
  for (const feature of info.features ?? []) add(feature);
  for (const audience of info.targetAudience ?? []) add(audience);

  // A price of 399000 is legitimately written 399.000đ, 399k or "399 nghìn".
  if (info.price !== undefined) {
    const digits = String(info.price).replace(/\D/g, '');
    if (digits) {
      allowed.add(normalize(digits));
      if (digits.length > 3) allowed.add(normalize(digits.slice(0, digits.length - 3)));
    }
  }

  return allowed;
}

function isAllowed(text: string, allowed: Set<string>): boolean {
  const normalized = normalize(text);
  if (allowed.has(normalized)) return true;

  // "399.000đ" should match a whitelisted 399000.
  const digitsOnly = normalized.replace(/\D/g, '');
  if (digitsOnly && allowed.has(digitsOnly)) return true;

  return false;
}

/**
 * How far a stated price may sit from the sourced one before it counts as
 * invented.
 *
 * Some tolerance is necessary rather than merely convenient. Asked to write a
 * hook for a 399,000đ product, the model reaches for "dưới 400 nghìn" - which
 * is both true and the natural way a person would say it. Demanding an exact
 * match rejected that, and every rejection costs a Claude call and eventually
 * fails the job over correct output.
 *
 * 15% is wide enough for ordinary rounding in either direction and far too
 * narrow to let a fabricated figure through: nothing in this band can misstate
 * what the buyer will pay in a way that matters.
 */
const PRICE_TOLERANCE = 0.15;

/** Interprets "399.000đ", "399k", "400 nghìn", "1.2 triệu" as a number. */
export function parseVietnameseMoney(text: string): number | null {
  const lower = text.toLowerCase().trim();

  const multiplier = /triệu/u.test(lower)
    ? 1_000_000
    : /tỷ/u.test(lower)
      ? 1_000_000_000
      : /(?:^|\d\s*)(?:k|nghìn|ngàn)/u.test(lower)
        ? 1_000
        : 1;

  const numeric = lower.match(/[\d.,]+/u)?.[0];
  if (!numeric) return null;

  let value: number;
  if (multiplier > 1) {
    // With a unit attached, a lone separator followed by one or two digits is a
    // decimal point ("1.2 triệu"); anything else is a thousands separator.
    const decimal = numeric.match(/^(\d+)[.,](\d{1,2})$/u);
    value = decimal
      ? Number.parseFloat(`${decimal[1]}.${decimal[2]}`)
      : Number.parseInt(numeric.replace(/[.,]/g, ''), 10);
  } else {
    value = Number.parseInt(numeric.replace(/[.,]/g, ''), 10);
  }

  if (!Number.isFinite(value)) return null;
  return value * multiplier;
}

/** True when a stated amount is a fair restatement of the sourced price. */
function isPriceWithinTolerance(text: string, info: ProductInfo | null): boolean {
  if (!info || info.price === undefined) return false;

  const sourced = parseVietnameseMoney(String(info.price));
  const stated = parseVietnameseMoney(text);
  if (sourced === null || stated === null || sourced <= 0) return false;

  return Math.abs(stated - sourced) / sourced <= PRICE_TOLERANCE;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[.,\s₫]/g, '').replace(/(đ|vnd|vnđ)$/u, '');
}

interface TextField {
  sceneId: string | null;
  name: string;
  text: string;
}

function collectTextFields(draft: StoryboardDraft): TextField[] {
  const fields: TextField[] = [
    { sceneId: null, name: 'content.hook', text: draft.content.hook },
    { sceneId: null, name: 'content.narration', text: draft.content.narration },
    { sceneId: null, name: 'content.cta', text: draft.content.cta },
  ];

  for (const scene of draft.scenes) {
    fields.push({ sceneId: scene.id, name: 'headline', text: scene.headline });
    fields.push({ sceneId: scene.id, name: 'narration', text: scene.narration });
  }

  return fields;
}

function formatFeedback(violations: readonly FactViolation[]): string {
  if (violations.length === 0) return '';

  const lines = violations.map((v) => {
    const where = v.sceneId ? `scene "${v.sceneId}" (${v.field})` : v.field;
    return `- In ${where}: ${v.message}`;
  });

  return [
    'The previous attempt asserted facts that are not present in info.json:',
    ...lines,
    '',
    'Rewrite so that every number and every claim about price, specification,',
    'warranty, promotion or certification comes from info.json. If a fact is not',
    'in info.json, do not mention it at all - describe what is visible in the',
    'photos instead.',
  ].join('\n');
}
