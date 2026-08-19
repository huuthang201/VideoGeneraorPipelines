import path from 'node:path';
import { z } from 'zod';
import type { ProductInfo } from '../domain/project';
import type { AppConfig } from '../config/env';
import type { Logger } from '../utils/logger';
import { ERROR_CODES, PipelineError } from '../domain/errors';
import { exec } from '../utils/exec';
import { extractJson } from './claude-code.provider';
import { checkImagePrompt } from '../image/generation/prompt-guard';

/**
 * Turns one plain-language description into several distinct image prompts.
 *
 * The alternative - generating N images from the same prompt with different
 * seeds - produces N near-identical pictures, which is useless as b-roll: the
 * whole point is that the video stops showing the same thing. Asking the model
 * for genuinely different moments around one theme is what makes the set worth
 * generating.
 *
 * Every prompt is checked by the same guard the pipeline uses before any of
 * them reach the image model, so a description that would put the product in
 * frame is refused here rather than after several minutes of inference.
 */

const PromptListSchema = z.strictObject({
  prompts: z.array(z.strictObject({ scene: z.string().min(1), prompt: z.string().min(1) })).min(1),
});

export interface DeriveBrollPromptsInput {
  /** What the user typed: a description of the video, in Vietnamese or English. */
  description: string;
  count: number;
  info: ProductInfo | null;
  /** Directory of reference images the model may look at, if any. */
  referenceDir: string | null;
  config: AppConfig;
  logger: Logger;
}

export interface DerivedPrompt {
  scene: string;
  prompt: string;
}

const MAX_ATTEMPTS = 2;

export async function deriveBrollPrompts(
  input: DeriveBrollPromptsInput,
): Promise<DerivedPrompt[]> {
  const base = buildPrompt(input);
  let prompt = base;
  let lastProblem = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) input.logger.warn(`Retrying prompt derivation (${attempt}/${MAX_ATTEMPTS})`);

    const raw = await callClaude(prompt, input);
    const parsed = PromptListSchema.safeParse(extractJson(raw));

    if (!parsed.success) {
      lastProblem = parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
      prompt = `${base}\n\n---\n\nLần trước sai định dạng:\n${lastProblem}\n\nTrả lại JSON đúng.`;
      continue;
    }

    // Guarded here, not after generating: a rejected prompt costs a second now
    // and a minute of inference later.
    const rejected = parsed.data.prompts
      .map((p) => ({ p, guard: checkImagePrompt(p.prompt, input.info) }))
      .filter((r) => !r.guard.ok);

    if (rejected.length > 0) {
      lastProblem = rejected.map((r) => `- "${r.p.scene}": ${r.guard.feedback}`).join('\n');
      input.logger.warn(`${rejected.length} prompt(s) rejected by the image guard`);
      prompt = `${base}\n\n---\n\nLần trước bị chặn:\n${lastProblem}\n\nViết lại, tuân đúng quy tắc.`;
      continue;
    }

    return parsed.data.prompts.slice(0, input.count);
  }

  throw new PipelineError(
    ERROR_CODES.IMAGE_PROMPT_REJECTED,
    'generate-broll',
    `Could not derive usable image prompts in ${MAX_ATTEMPTS} attempts.\n${lastProblem}`,
  );
}

function buildPrompt(input: DeriveBrollPromptsInput): string {
  const { info } = input;

  return [
    `Bạn đang chuẩn bị ảnh bối cảnh (b-roll) cho một video dọc ngắn.`,
    ``,
    `## Mô tả video`,
    input.description.trim(),
    ``,
    info ? `## Thông tin sản phẩm\n\`\`\`json\n${JSON.stringify(info, null, 2)}\n\`\`\`` : '',
    input.referenceDir
      ? [
          ``,
          `## Ảnh tham chiếu`,
          `Xem các ảnh trong thư mục sau bằng công cụ Read:`,
          `  ${input.referenceDir}`,
          ``,
          `Nếu có ảnh nhân vật, hãy mô tả người đó thật cụ thể trong MỌI prompt`,
          `(tuổi, kiểu tóc, trang phục, dáng người) để các ảnh sinh ra trông như`,
          `cùng một người. Model không nhớ giữa các lần sinh, nên sự nhất quán`,
          `hoàn toàn phụ thuộc vào việc bạn tả lại giống nhau ở từng prompt.`,
        ].join('\n')
      : '',
    ``,
    `## Nhiệm vụ`,
    ``,
    `Viết đúng ${input.count} prompt ảnh KHÁC NHAU, mỗi prompt là một khoảnh khắc`,
    `riêng trong cùng mạch câu chuyện. Đừng viết ${input.count} biến thể của cùng`,
    `một cảnh — như vậy video vẫn nhàm.`,
    ``,
    `Prompt viết bằng TIẾNG ANH, mỗi cái một câu dài, tả: chủ thể · bối cảnh ·`,
    `ánh sáng · góc máy · độ sâu trường ảnh · tông màu. Ưu tiên cảnh rộng hoặc`,
    `trung, tránh cận mặt (model hay lỗi ở mặt và tay).`,
    ``,
    `## Ba quy tắc tuyệt đối`,
    ``,
    `1. KHÔNG nhắc tới sản phẩm — không tên, không thương hiệu, không loại sản`,
    `   phẩm. Đây là ảnh BỐI CẢNH. Sản phẩm chỉ xuất hiện qua ảnh chụp thật.`,
    `2. KHÔNG minh hoạ tính năng mà thông tin sản phẩm không có. Một tấm ảnh mưa`,
    `   xối xả nói "chống nước" mạnh hơn mọi câu chữ — ảnh cũng là một lời khẳng`,
    `   định và phải có nguồn.`,
    `3. KHÔNG đặt chữ vào ảnh. Model sinh chữ rất tệ.`,
    ``,
    `## Định dạng`,
    ``,
    `Chỉ trả về JSON, không giải thích:`,
    ``,
    '```json',
    JSON.stringify(
      {
        prompts: [
          {
            scene: 'mô tả ngắn bằng tiếng Việt để người dùng nhận ra ảnh này',
            prompt: 'the English image prompt',
          },
        ],
      },
      null,
      2,
    ),
    '```',
  ]
    .filter(Boolean)
    .join('\n');
}

async function callClaude(prompt: string, input: DeriveBrollPromptsInput): Promise<string> {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--model',
    input.config.ai.model,
    '--allowedTools',
    'Read',
  ];
  if (input.referenceDir) args.push('--add-dir', path.resolve(input.referenceDir));

  const result = await exec(input.config.ai.claudeBin, args, { timeoutMs: 240_000 }).catch(
    (err) => {
      throw new PipelineError(
        ERROR_CODES.AI_CALL_FAILED,
        'generate-broll',
        `Could not run "${input.config.ai.claudeBin}": ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  );

  if (result.code !== 0) {
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'generate-broll',
      `Claude exited ${result.code}: ${result.stderr.trim().slice(0, 400)}`,
    );
  }

  try {
    const envelope = JSON.parse(result.stdout) as { result?: unknown };
    if (typeof envelope.result === 'string') return envelope.result;
  } catch {
    // A plain-text reply is still worth parsing.
  }
  return result.stdout;
}
