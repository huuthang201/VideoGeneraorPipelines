import type { ProductInfo } from '../domain/project';
import type { SceneLike } from '../modules/contract';

/**
 * Stops the model asserting figures and commitments that nobody gave it.
 *
 * A prompt instruction is not enough here and neither is a schema. Schemas
 * check shape, and "just $39, with a lifetime warranty" is a perfectly
 * well-shaped string; the model can follow an instruction ninety-nine times and
 * invent a guarantee on the hundredth.
 *
 * ## When it applies
 *
 * Only when the project has an info.json, and this is worth being clear about
 * because the videos are literally called facts.
 *
 * What this guard checks is not whether a fact is true - nothing mechanical
 * can - but whether a *commercial* claim was invented. Its rules are the
 * product ones: this price, this warranty, this certification, or none. A fact
 * script is full of perfectly correct figures ("khoảng ba nghìn năm", "hai phần
 * ba bề mặt Trái Đất") that no info.json will ever list, so applying it to
 * every project would reject correct writing on almost every line - and a guard
 * that fires constantly on good output is a guard people turn off.
 *
 * So the rule is scoped to intent: a project that ships an info.json is
 * declaring "this video makes checkable commercial claims, and these are the
 * ones it may make", and the guard holds it to exactly that list. A project
 * without one is a fact video, and truthfulness there is enforced where it
 * actually can be - in the prompt, at length, and by whoever reviews the script
 * before it is published. What the guard never does is *silently* stand down:
 * `checkFacts` reports `applied: false` so the caller can log which mode a run
 * was in.
 */

export interface FactViolation {
  kind: 'price' | 'number' | 'promotion' | 'warranty' | 'certification';
  sceneId: string | null;
  field: string;
  matched: string;
  message: string;
}

/**
 * Claims that imply a commitment somebody has to honour. These are flagged on
 * sight: unlike a number, there is no version of info.json that makes an
 * invented free-shipping promise acceptable.
 *
 * The Vietnamese patterns cannot use \b. Word boundaries are defined over
 * [A-Za-z0-9_], so `\bbảo hành\b` matches inside "đảm-bảo hành-lý" and fails to
 * match where it should once a Vietnamese vowel with a diacritic sits at the
 * edge. The lookarounds below are the Unicode equivalent: not preceded or
 * followed by another letter.
 *
 * What the lookarounds cannot do is tell a phrase from a phrase that overlaps
 * it. Vietnamese is written one syllable at a time, so "đảm bảo hành lý" hits
 * the "bảo hành" pattern and always will - no boundary rule fixes that, only a
 * parser would. The cost is bounded and cheap: a false positive is one retry
 * with the matched text quoted back, not a wrong video, and it can only happen
 * inside a project that shipped an info.json in the first place.
 *
 * The English patterns are kept alongside them. A brief or an info.json may
 * well be written in English even when the script is not, and a claim smuggled
 * in through a product name is exactly the case this exists for.
 */
/**
 * The parts of the guard that are written in a language.
 *
 * Supplied by the module rather than fixed here, and not merely for tone: the
 * *patterns* are language-specific, so a guard carrying English regexes would
 * silently pass every promotional claim in a Vietnamese script. The feedback is
 * echoed straight back to the model, so it has to be in the language the rest
 * of that conversation is in.
 *
 * The machinery around them - what counts as a number, how prices are compared
 * against info.json, which fields are scanned - is arithmetic and is shared.
 */
export interface FactGuardLanguage {
  claimPatterns: { kind: FactViolation['kind']; pattern: RegExp; label: string }[];
  /** "The number 39 is not in info.json. Allowed: ..." */
  numberNotAllowed(value: number, allowed: readonly number[]): string;
  /** "\"free shipping\" is a promotion claim not present in info.json." */
  claimNotAllowed(text: string, label: string): string;
  /** The whole retry message, built from the individual violations. */
  formatFeedback(violations: readonly FactViolation[]): string;
}

/** The draft fields the guard reads. Structural, so either module's fits. */
export interface GuardableDraft {
  project: { episodeTitle: string };
  content: { summary: string; narration: string };
  scenes: readonly Pick<SceneLike, 'id' | 'title' | 'narration'>[];
}

export interface FactGuardResult {
  ok: boolean;
  /** False when the project has no info.json, so nothing was checked. */
  applied: boolean;
  violations: FactViolation[];
  /** Ready to paste into a retry prompt. */
  feedback: string;
}

export function checkFacts(
  draft: GuardableDraft,
  info: ProductInfo | null,
  lang: FactGuardLanguage,
): FactGuardResult {
  if (info === null) {
    return { ok: true, applied: false, violations: [], feedback: '' };
  }

  const violations: FactViolation[] = [];
  const allowed = buildWhitelist(info);
  const allowedNumbers = buildNumberWhitelist(info);

  for (const field of collectTextFields(draft)) {
    for (const value of [...digitsIn(field.text), ...moneyIn(field.text)]) {
      if (isNumberAllowed(value, allowedNumbers)) continue;

      violations.push({
        // Price-magnitude figures are called out as such: it is the difference
        // between misquoting a detail and misquoting what something costs.
        kind: value >= PRICE_THRESHOLD ? 'price' : 'number',
        sceneId: field.sceneId,
        field: field.name,
        matched: String(value),
        message: lang.numberNotAllowed(value, [...allowedNumbers]),
      });
    }

    for (const { kind, pattern, label } of lang.claimPatterns) {
      for (const match of field.text.matchAll(pattern)) {
        const text = match[0].trim();
        if (isAllowed(text, allowed)) continue;
        violations.push({
          kind,
          sceneId: field.sceneId,
          field: field.name,
          matched: text,
          message: lang.claimNotAllowed(text, label),
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    applied: true,
    violations,
    feedback: lang.formatFeedback(violations),
  };
}

/**
 * Amounts written with a unit attached: "$39", "39k", "1.2 million".
 * digitsIn alone would read those as 39 and 1.2 and compare the wrong magnitude
 * against the whitelist.
 */
function moneyIn(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(
    /(?:[$£€]\s*)?\b\d[\d.,]*\s*(?:k|thousand|m|million|bn|billion|dollars?|usd|cents?)\b/gi,
  )) {
    const value = parseMoney(match[0]);
    if (value !== null) values.push(value);
  }
  return values;
}

/** Unit suffixes that change a figure's magnitude, so moneyIn must own them. */
const UNIT_SUFFIX = /^\s*(?:k|thousand|m|million|bn|billion)\b/i;

/** Numeric values written as digits, including decimals and grouped thousands. */
function digitsIn(text: string): number[] {
  const values: number[] = [];

  for (const match of text.matchAll(/\d[\d.,]*/gu)) {
    const raw = match[0].replace(/[.,]$/, '');

    // "39k" is 39,000, not 39. Leaving it to moneyIn avoids reporting the same
    // figure twice at two different magnitudes, where the bare reading would be
    // both wrong and the one the caller sees first.
    if (UNIT_SUFFIX.test(text.slice(match.index + match[0].length))) continue;

    // English convention: comma groups thousands, dot is the decimal point.
    const value = Number.parseFloat(raw.replace(/,(?=\d{3}\b)/g, ''));
    if (Number.isFinite(value)) values.push(value);
  }

  return values;
}

/**
 * Above this, a figure is treated as a price and gets the rounding tolerance
 * below. Beneath it a figure is a detail, where 15.6 inches is simply not 16
 * inches and only an exact match will do.
 */
const PRICE_THRESHOLD = 1000;

/**
 * How far a stated price may sit from the sourced one before it counts as
 * invented.
 *
 * Some tolerance is necessary rather than merely convenient. Asked to write
 * about something that costs 399,000, the model reaches for "under four hundred
 * thousand" - which is both true and the natural way a person would say it.
 * Demanding an exact match rejected that, and every rejection costs a Claude
 * call and eventually fails the job over correct output. 15% is wide enough for
 * ordinary rounding in either direction and far too narrow to let a fabricated
 * figure through.
 */
const PRICE_TOLERANCE = 0.15;

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
function buildNumberWhitelist(info: ProductInfo): Set<number> {
  const numbers = new Set<number>();

  const harvest = (value: string | number | undefined) => {
    if (value === undefined) return;
    if (typeof value === 'number') {
      numbers.add(value);
      return;
    }
    for (const found of digitsIn(value)) numbers.add(found);
    for (const found of moneyIn(value)) numbers.add(found);
  };

  harvest(info.price);
  harvest(info.name);
  harvest(info.category);
  harvest(info.brand);
  harvest(info.cta);
  for (const feature of info.features ?? []) harvest(feature);
  for (const audience of info.targetAudience ?? []) harvest(audience);

  // A price of 399000 is also spoken as "399 thousand", so the shorthand counts
  // as the same sourced fact rather than a new claim.
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
 * to rephrase "Two-year warranty included" rather than quote it, and rejecting
 * a legitimate rewording would make the guard unusable.
 */
function buildWhitelist(info: ProductInfo): Set<string> {
  const allowed = new Set<string>();

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

  return allowed;
}

function isAllowed(text: string, allowed: Set<string>): boolean {
  const normalized = normalize(text);
  if (allowed.has(normalized)) return true;

  // "$399.00" should match a whitelisted 399.
  const digitsOnly = normalized.replace(/\D/g, '');
  if (digitsOnly && allowed.has(digitsOnly)) return true;

  return false;
}

/** Interprets "$39", "39k", "1.2 million", "39 dollars" as a number. */
export function parseMoney(text: string): number | null {
  const lower = text.toLowerCase().trim();

  const multiplier = /\b(?:m|million)\b/u.test(lower)
    ? 1_000_000
    : /\b(?:bn|billion)\b/u.test(lower)
      ? 1_000_000_000
      : /\d\s*(?:k|thousand)\b/u.test(lower)
        ? 1_000
        : 1;

  const numeric = lower.match(/[\d.,]+/u)?.[0];
  if (!numeric) return null;

  const value = Number.parseFloat(numeric.replace(/,(?=\d{3}\b)/g, ''));
  if (!Number.isFinite(value)) return null;

  return value * multiplier;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[.,\s$£€]/g, '');
}

interface TextField {
  sceneId: string | null;
  name: string;
  text: string;
}

function collectTextFields(draft: GuardableDraft): TextField[] {
  const fields: TextField[] = [
    { sceneId: null, name: 'project.episodeTitle', text: draft.project.episodeTitle },
    { sceneId: null, name: 'content.summary', text: draft.content.summary },
    { sceneId: null, name: 'content.narration', text: draft.content.narration },
  ];

  for (const scene of draft.scenes) {
    fields.push({ sceneId: scene.id, name: 'title', text: scene.title });
    fields.push({ sceneId: scene.id, name: 'narration', text: scene.narration });
  }

  return fields;
}
