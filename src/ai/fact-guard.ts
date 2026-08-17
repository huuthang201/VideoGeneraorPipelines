import type { ProductInfo } from '../domain/project';
import type { StoryboardDraft } from '../domain/storyboard';

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

/** Currency amounts: "399.000đ", "399k", "399 nghìn", "1.2 triệu". */
const MONEY_PATTERNS = [
  u(`\\d[\\d.,]*\\s*(?:đ|vnđ|vnd|₫)${B_END}`),
  u(`${B_START}\\d[\\d.,]*\\s*k${B_END}`),
  u(`${B_START}\\d[\\d.,]*\\s*(?:nghìn|ngàn|triệu|tỷ)${B_END}`),
];

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

/** Bare numbers, for strict mode where nothing numeric is sourced. */
const BARE_NUMBER = u(`${B_START}\\d[\\d.,]*${B_END}`);

/**
 * Vietnamese number words, so a price spelled out for the narrator is caught
 * the same way a digit would be. The model naturally writes "ba trăm chín chín
 * nghìn" in narration because that is how it should be read aloud, and a
 * digit-only check would wave it straight through.
 */
const NUMBER_WORDS = u(
  `${B_START}(?:không|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười|mươi|trăm|nghìn|ngàn|triệu|tỷ|rưỡi|lăm|tư)${B_END}`,
);

export interface FactGuardResult {
  ok: boolean;
  violations: FactViolation[];
  /** Ready to paste into a retry prompt. */
  feedback: string;
}

export function checkFacts(draft: StoryboardDraft, info: ProductInfo | null): FactGuardResult {
  const violations: FactViolation[] = [];
  const allowed = buildWhitelist(info);
  const strict = info === null || info.price === undefined;

  for (const field of collectTextFields(draft)) {
    // Spoken-out numbers only matter when there is no sourced price at all;
    // once a price exists, the narration is expected to say it in words.
    if (strict) {
      const spelled = field.text.match(NUMBER_WORDS);
      if (spelled && spelled.length >= 3) {
        violations.push({
          kind: 'price',
          sceneId: field.sceneId,
          field: field.name,
          matched: spelled.slice(0, 6).join(' '),
          message:
            `"${field.text}" appears to speak a number aloud, but info.json provides no price. ` +
            'Do not state or imply any price, measurement or specification.',
        });
      }
    }

    for (const pattern of MONEY_PATTERNS) {
      for (const match of field.text.matchAll(pattern)) {
        const text = match[0].trim();
        if (isAllowed(text, allowed)) continue;
        if (isPriceWithinTolerance(text, info)) continue;
        violations.push({
          kind: 'price',
          sceneId: field.sceneId,
          field: field.name,
          matched: text,
          message: strict
            ? `"${text}" states a price, but info.json contains no price at all.`
            : `"${text}" does not match the price in info.json (${String(info?.price)} ${info?.currency ?? 'VND'}).`,
        });
      }
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

    if (strict) {
      for (const match of field.text.matchAll(BARE_NUMBER)) {
        const text = match[0].trim();
        if (isAllowed(text, allowed)) continue;
        violations.push({
          kind: 'number',
          sceneId: field.sceneId,
          field: field.name,
          matched: text,
          message: `"${text}" is a specific figure, but info.json provides nothing to support it.`,
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
