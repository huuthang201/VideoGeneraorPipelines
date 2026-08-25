import type { FactGuardLanguage, FactViolation } from '../../ai/fact-guard';

/**
 * The Vietnamese half of the fact guard.
 *
 * Word boundaries are lookarounds on `\p{L}` rather than `\b`, because `\b` is
 * defined on ASCII word characters and would not fire correctly around
 * Vietnamese diacritics - "khuyến mãi" is two words to a human and something
 * else entirely to `\b`.
 */
const NOT_LETTER_BEFORE = '(?<!\\p{L})';
const NOT_LETTER_AFTER = '(?!\\p{L})';

const vietnamese = (alternatives: string): RegExp =>
  new RegExp(`${NOT_LETTER_BEFORE}(${alternatives})${NOT_LETTER_AFTER}`, 'giu');

const CLAIM_PATTERNS: FactGuardLanguage['claimPatterns'] = [
  {
    kind: 'promotion',
    pattern: vietnamese(
      'giảm giá|khuyến mãi|khuyến mại|miễn phí vận chuyển|freeship|mã giảm giá|ưu đãi|' +
        'có hạn|duy nhất hôm nay',
    ),
    label: 'khuyến mãi',
  },
  {
    kind: 'warranty',
    pattern: vietnamese('bảo hành|cam kết|hoàn tiền|đổi trả miễn phí|bao đổi trả'),
    label: 'bảo hành',
  },
  {
    kind: 'certification',
    pattern: vietnamese(
      'được chứng nhận|kiểm nghiệm lâm sàng|chứng minh khoa học|đạt chuẩn|giải thưởng',
    ),
    label: 'chứng nhận',
  },
];

export const factGuardLanguage: FactGuardLanguage = {
  claimPatterns: CLAIM_PATTERNS,

  numberNotAllowed: (value, allowed) =>
    `Con số ${value} không có trong info.json. ` +
    `Các giá trị file đó cho phép: ${allowed.join(', ') || '(không có)'}.`,

  claimNotAllowed: (text, label) =>
    `"${text}" là một tuyên bố về ${label} không có trong info.json.`,

  formatFeedback(violations: readonly FactViolation[]): string {
    if (violations.length === 0) return '';

    const lines = violations.map((v) => {
      const where = v.sceneId ? `cảnh "${v.sceneId}" (${v.field})` : v.field;
      return `- Ở ${where}: ${v.message}`;
    });

    return [
      'Bản trước đã nêu những thông tin không có trong info.json:',
      ...lines,
      '',
      'Viết lại sao cho mọi con số và mọi tuyên bố về giá, thông số, bảo hành,',
      'khuyến mãi hay chứng nhận đều lấy từ info.json. Điều gì không có trong',
      'info.json thì bỏ hẳn, đừng nhắc đến.',
    ].join('\n');
  },
};
