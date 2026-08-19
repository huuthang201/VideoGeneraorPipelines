import type { ProductInfo } from '../../domain/project';

/**
 * A short, single-shot prompt used before the real storyboard prompt: it just
 * asks Claude to look at the photos and draft a starting "context" and "hook"
 * for the two free-text boxes in the UI, which the user can then edit before
 * generating the actual storyboard.
 */
export interface SuggestBriefPromptInput {
  previewDir: string;
  assetFilenames: string[];
  info: ProductInfo | null;
}

export function buildSuggestBriefPrompt(input: SuggestBriefPromptInput): string {
  return [
    `Bạn đang chuẩn bị viết kịch bản video dọc ngắn (TikTok/Shorts) cho một sản phẩm.`,
    ``,
    `Đọc tất cả ảnh trong thư mục sau bằng công cụ Read:`,
    `  ${input.previewDir}`,
    ...input.assetFilenames.map((f) => `  - ${f}`),
    ``,
    `## Thông tin sản phẩm`,
    input.info
      ? '```json\n' + JSON.stringify(input.info, null, 2) + '\n```'
      : '(Không có info.json.)',
    ``,
    `## Việc cần làm`,
    ``,
    `Chỉ dựa trên những gì nhìn thấy trong ảnh (không bịa giá/thông số), gợi ý:`,
    ``,
    `1. "context": 1-2 câu mô tả bối cảnh/tình huống sử dụng sản phẩm này, để làm`,
    `   điểm khởi đầu cho người viết kịch bản.`,
    `2. "hook": một ý tưởng cho cảnh đầu tiên (3 giây đầu) — một câu đùa hoặc`,
    `   tình huống oái oăm gắn trực tiếp với sản phẩm trong ảnh, không phải câu`,
    `   hỏi kiểu quảng cáo ("sản phẩm này có gì hay?").`,
    ``,
    `Cả hai đều bằng tiếng Việt, ngắn gọn, và đây chỉ là gợi ý ban đầu — người`,
    `dùng sẽ đọc và có thể sửa lại trước khi dùng.`,
    ``,
    `Trả về DUY NHẤT một object JSON, không kèm giải thích, không kèm markdown:`,
    '```json',
    JSON.stringify({ context: 'bối cảnh gợi ý ở đây', hook: 'ý tưởng hook ở đây' }, null, 2),
    '```',
  ].join('\n');
}
