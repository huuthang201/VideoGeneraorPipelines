import { SuggestedBriefSchema, type SuggestedBrief } from '../../domain/brief';
import type { AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import { ERROR_CODES, PipelineError } from '../../domain/errors';
import { callClaude, extractJson } from '../../ai/claude-runner';
import type { SuggestBriefInput } from '../contract';

/**
 * Turns a project name into a subject worth seventeen minutes.
 *
 * Given web search, unlike the shorts' equivalent and for the same reason the
 * outline call has it: a long video on this channel is usually about something
 * that happened, and "something that happened" is exactly what a model cannot
 * know from memory. Somebody typing "lũ Nepal" into the project box wants the
 * real event, and the suggestion has to go and find out which one.
 *
 * It stays cheap regardless - one call, no retry loop. What it produces is two
 * boxes a person reads and edits before anything expensive runs; the research
 * that matters happens in the outline call, which does it properly and writes
 * down its sources.
 */

/** Six minutes: it searches before it answers, so it is not the usual one-liner. */
const CLAUDE_TIMEOUT_MS = 360_000;

export async function suggestBrief(
  config: AppConfig,
  logger: Logger,
  input: SuggestBriefInput,
): Promise<SuggestedBrief> {
  const today = new Date().toISOString().slice(0, 10);

  const prompt = [
    `Hôm nay là ${today}.`,
    ``,
    `Kênh "${config.channelName || 'Ủa Thật À?'}" làm video tiếng Việt kể chuyện có thật, quanh ta`,
    `hoặc ngoài thế giới. Đây là dòng video DÀI - mười lăm đến hai mươi phút, khung`,
    `ngang - nên đề tài phải đủ sâu để nói suốt chừng đó.`,
    ``,
    `Đề tài có thể là bất cứ thứ gì có thật: một đồ vật hằng ngày, một loài vật,`,
    `một phát minh, một nghề đã mất, một hiện tượng tự nhiên, một sai lầm lịch sử,`,
    `một sự việc vừa xảy ra. Cái quyết định là **có đủ chuyện thật để kể suốt mười`,
    `lăm phút hay không** - có lịch sử, có cơ chế, có chỗ ngoặt, có con số buồn`,
    `cười, có người kỳ lạ dính líu.`,
    ``,
    `Người dùng mới chỉ đặt tên dự án là:`,
    ``,
    `  "${input.topic}"`,
    ``,
    `## Việc của bạn`,
    ``,
    `**Tìm kiếm web trước.** Cái tên trên có thể chỉ về một sự việc có thật, và có`,
    `thể là sự việc mới hơn những gì bạn nhớ được. Tra vài lượt để biết chính xác`,
    `nó là chuyện gì, xảy ra khi nào, ở đâu, quy mô ra sao. Đừng đoán từ trí nhớ.`,
    ``,
    `Rồi trả về hai thứ:`,
    ``,
    `- **context**: hai đến bốn câu nói rõ video này kể về sự việc nào - đủ cụ thể`,
    `  để bước sau tra cứu tiếp mà không nhầm sang sự việc khác. Nêu tên địa danh,`,
    `  mốc thời gian và quy mô. Đây là chỉ dẫn nội bộ, không phải lời đọc.`,
    `- **hook**: một câu mở đầu video, nói thẳng điều lạ nhất của chủ đề này.`,
    ``,
    `Kênh vui và chi tiết, nhưng cái vui đến từ sự thật kể đúng chứ không từ câu`,
    `đùa chêm vào - nên hook cũng vậy: một chi tiết có thật, cụ thể, đủ lạ để`,
    `người ta dừng lại. Nếu chủ đề là chuyện có người chết thì bỏ hết phần vui,`,
    `chuyển sang tường thuật điềm tĩnh; sức nặng nằm ở con số đúng.`,
    ...(input.alreadyCovered.length
      ? [
          ``,
          `Kênh đã làm những đề tài này rồi, đừng lặp lại:`,
          ...input.alreadyCovered.slice(-30).map((t) => `  - ${t}`),
        ]
      : []),
    ``,
    `Trả về DUY NHẤT một object JSON, không gì khác:`,
    ``,
    '```json',
    JSON.stringify({ context: '...', hook: '...' }, null, 2),
    '```',
  ].join('\n');

  const raw = await callClaude(prompt, config, logger, {
    timeoutMs: CLAUDE_TIMEOUT_MS,
    // Search only, for the same reason the outline call has it - and with the
    // same limit: nothing it finds should be able to reach this machine.
    extraArgs: ['WebSearch'],
  });

  const json = extractJson(raw);
  const parsed = json ? SuggestedBriefSchema.safeParse(json) : null;
  if (!parsed?.success) {
    throw new PipelineError(
      ERROR_CODES.AI_INVALID_OUTPUT,
      'suggest-brief',
      'Claude did not return a valid { context, hook } suggestion.',
    );
  }

  return parsed.data;
}
