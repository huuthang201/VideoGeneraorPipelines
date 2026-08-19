import type { ProductInfo } from '../../domain/project';

/**
 * Stops a generated image from depicting the product itself.
 *
 * The pipeline already refuses to let the model invent facts *in words*
 * (see ai/fact-guard.ts). Pictures need the same treatment, and arguably more:
 * a viewer scrolling a product video reads every frame as a photograph of the
 * thing being sold. An AI image showing "the product" in a setting it was never
 * in, or demonstrating a capability nobody claimed, is a false advertisement
 * whatever the narration says over the top of it.
 *
 * So generated imagery is confined to *context* - a café interior, a desk, a
 * street - and the real photographs the seller supplied remain the only images
 * of the product. Spec §26 reached the same conclusion: "Không dùng AI để
 * redraw sản phẩm nếu không cần."
 *
 * This is enforced here rather than asked for in the prompt, for the same
 * reason the fact guard exists: an instruction is followed most of the time,
 * and most of the time is not good enough when the output makes commercial
 * claims to real buyers.
 */

export interface PromptViolation {
  kind: 'names-product' | 'depicts-claim' | 'empty' | 'too-long';
  matched: string;
  message: string;
}

export interface PromptGuardResult {
  ok: boolean;
  violations: PromptViolation[];
  /** Ready to echo back to the model on a retry. */
  feedback: string;
}

/** Beyond this the prompt is describing a scene nobody asked for. */
const MAX_PROMPT_CHARS = 600;

/**
 * Words that turn a scene description into a demonstration of a capability.
 *
 * Depicting one of these is a claim: an image of a bag in a downpour says
 * "waterproof" more forcefully than any caption. Allowed only when info.json
 * actually supports it.
 */
const CAPABILITY_CUES: { pattern: RegExp; claim: string }[] = [
  { pattern: /\b(rain|downpour|soaking|submerged|underwater|splash)\b/i, claim: 'water resistance' },
  { pattern: /\b(drop|dropped|falling|shatter|impact|crushed)\b/i, claim: 'durability' },
  { pattern: /\b(steam|steaming|piping hot|frozen|ice)\b/i, claim: 'temperature retention' },
  { pattern: /\b(charging|plugged in|battery|power bank)\b/i, claim: 'charging or battery' },
  { pattern: /\b(noise|silent|soundproof|quiet carriage)\b/i, claim: 'noise isolation' },
];

/**
 * Terms so generic that matching them would block almost any scene. A category
 * of "Bình giữ nhiệt" must not stop the prompt from saying "a table".
 */
const TOO_GENERIC = new Set([
  'bình', 'chai', 'cốc', 'ly', 'túi', 'balo', 'ba lô', 'máy', 'đồ', 'sản phẩm',
  'bag', 'cup', 'bottle', 'case', 'device', 'product', 'item', 'thing',
]);

export function checkImagePrompt(prompt: string, info: ProductInfo | null): PromptGuardResult {
  const violations: PromptViolation[] = [];
  const trimmed = prompt.trim();

  if (!trimmed) {
    violations.push({
      kind: 'empty',
      matched: '',
      message: 'The image prompt is empty.',
    });
    return { ok: false, violations, feedback: formatFeedback(violations) };
  }

  if (trimmed.length > MAX_PROMPT_CHARS) {
    violations.push({
      kind: 'too-long',
      matched: `${trimmed.length} characters`,
      message: `The image prompt is ${trimmed.length} characters; keep it under ${MAX_PROMPT_CHARS}.`,
    });
  }

  const haystack = normalize(trimmed);

  for (const term of productTerms(info)) {
    if (!haystack.includes(normalize(term))) continue;
    violations.push({
      kind: 'names-product',
      matched: term,
      message:
        `The prompt names the product ("${term}"). Generated images are for context only - ` +
        'a café interior, a desk, a commute - never the product itself. The product is shown ' +
        'using the real photographs that were supplied.',
    });
  }

  const sourced = sourcedText(info);
  for (const { pattern, claim } of CAPABILITY_CUES) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    if (sourced.includes(claimKeyword(claim))) continue;

    violations.push({
      kind: 'depicts-claim',
      matched: match[0],
      message:
        `The prompt depicts ${claim} ("${match[0]}"), which info.json does not mention. ` +
        'An image demonstrating a capability is a claim about the product, so it needs the ' +
        'same sourcing as a spoken one.',
    });
  }

  return { ok: violations.length === 0, violations, feedback: formatFeedback(violations) };
}

/** Product-identifying terms worth blocking, with the too-generic ones dropped. */
function productTerms(info: ProductInfo | null): string[] {
  if (!info) return [];

  const candidates = [info.name, info.brand, info.category].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );

  const terms = new Set<string>();
  for (const candidate of candidates) {
    // The full phrase always counts, however common its parts are.
    if (candidate.trim().length >= 3) terms.add(candidate.trim());

    // Individual words only when they are distinctive - a brand name, a model
    // number - so that a generic category does not veto ordinary scenery.
    for (const word of candidate.split(/[\s,/-]+/)) {
      const clean = word.trim();
      if (clean.length < 3) continue;
      if (TOO_GENERIC.has(clean.toLowerCase())) continue;
      terms.add(clean);
    }
  }

  return [...terms];
}

function sourcedText(info: ProductInfo | null): string {
  if (!info) return '';
  return normalize(
    [info.name, info.category, info.brand, ...(info.features ?? [])]
      .filter(Boolean)
      .join(' '),
  );
}

/** Vietnamese keyword most likely to appear in info.json for a given claim. */
function claimKeyword(claim: string): string {
  switch (claim) {
    case 'water resistance':
      return 'chốngnước';
    case 'durability':
      return 'bền';
    case 'temperature retention':
      return 'giữnhiệt';
    case 'charging or battery':
      return 'sạc';
    case 'noise isolation':
      return 'chốngồn';
    default:
      return claim;
  }
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFC').replace(/\s+/g, '');
}

function formatFeedback(violations: readonly PromptViolation[]): string {
  if (violations.length === 0) return '';

  return [
    'The image prompt was rejected:',
    ...violations.map((v) => `- ${v.message}`),
    '',
    'Generated images set the scene around the product without showing it.',
    'Describe a place, a moment or a mood - a rainy window, a cluttered desk,',
    'a morning commute - and let the real product photographs do the selling.',
  ].join('\n');
}
