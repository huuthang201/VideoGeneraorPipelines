import type { FactGuardLanguage, FactViolation } from '../../ai/fact-guard';

/** The English half of the fact guard. */
const CLAIM_PATTERNS: FactGuardLanguage['claimPatterns'] = [
  {
    kind: 'promotion',
    pattern:
      /\b(discount|on sale|free shipping|limited time|special offer|coupon|promo code|money off)\b/gi,
    label: 'promotion',
  },
  {
    kind: 'warranty',
    pattern: /\b(warranty|guaranteed?|money[- ]back|refund|free returns?)\b/gi,
    label: 'warranty',
  },
  {
    kind: 'certification',
    pattern:
      /\b(certified|clinically proven|scientifically proven|FDA[- ]approved|award[- ]winning)\b/gi,
    label: 'certification',
  },
];

export const factGuardLanguage: FactGuardLanguage = {
  claimPatterns: CLAIM_PATTERNS,

  numberNotAllowed: (value, allowed) =>
    `The number ${value} does not appear in info.json. ` +
    `Values that file allows: ${allowed.join(', ') || '(none)'}.`,

  claimNotAllowed: (text, label) =>
    `"${text}" is a ${label} claim that is not present in info.json.`,

  formatFeedback(violations: readonly FactViolation[]): string {
    if (violations.length === 0) return '';

    const lines = violations.map((v) => {
      const where = v.sceneId ? `scene "${v.sceneId}" (${v.field})` : v.field;
      return `- In ${where}: ${v.message}`;
    });

    return [
      'The previous attempt asserted facts that are not present in info.json:',
      ...lines,
      '',
      'Rewrite so that every figure and every claim about price, specification,',
      'warranty, promotion or certification comes from info.json. If a fact is not',
      'in info.json, do not mention it at all.',
    ].join('\n');
  },
};
