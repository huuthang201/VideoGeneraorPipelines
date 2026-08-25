import path from 'node:path';
import { callClaude, extractJson } from '../../ai/claude-runner';
import type { AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import type { ReviewCandidate } from './image/stock/types';

/**
 * The pass that actually looks at the photographs.
 *
 * Everything upstream of this reasons about words. The source allowlist, the
 * artwork filter and the relevance ranking all decide from a query, a title and
 * a list of tags whether a picture belongs in a scene - and none of them has
 * seen it. That is why a search for "white mouse" returned computer mice and a
 * search for "rodent teeth" returned a dire wolf skull: both are, in words,
 * exactly what was asked for.
 *
 * So the candidates are downloaded as thumbnails and handed to the model with
 * the script beside them, and it says which picture goes with which sentence.
 * This restores the judgement the podcast module never lost - there, the
 * photographs exist before the script and the model picks from them; here the
 * script comes first and the pictures are fetched afterwards, so the looking
 * has to happen in a second pass.
 *
 * ## It is allowed to fail
 *
 * The return value is advisory. A scene the review does not mention, or names a
 * candidate that does not exist for, falls through to the automatic assignment
 * exactly as before. A call that times out or returns nonsense is logged and
 * discarded. The cost of losing it is a less relevant picture; the cost of
 * depending on it would be a job that dies after paying for a script, a search
 * and a round of downloads.
 */

/**
 * Bounded well under the storyboard call's ceiling.
 *
 * The work is reading twenty small images and emitting a short mapping, which
 * settles in well under a minute. A generous timeout here would mostly mean
 * waiting a long time to find out the pass is not going to help.
 */
const TIMEOUT_MS = 180_000;

export interface ReviewScene {
  id: string;
  /** What the scene says, so the model can match a picture to the sentence. */
  narration: string;
  /** The query the storyboard asked for, as a hint rather than a rule. */
  imageQuery: string;
}

export async function reviewImages(
  config: AppConfig,
  logger: Logger,
  input: {
    directory: string;
    candidates: readonly ReviewCandidate[];
    scenes: readonly ReviewScene[];
  },
): Promise<ReadonlyMap<string, string>> {
  const directory = path.resolve(input.directory);
  const prompt = buildPrompt({ ...input, directory });

  const raw = await callClaude(prompt, config, logger, {
    timeoutMs: TIMEOUT_MS,
    // Read, on the thumbnail directory only. The model has to open the images;
    // it has no reason to write anything or to see the rest of the disk, and a
    // filename is attacker-influenced input - it comes from a stock site's
    // title - so the grant is kept to exactly what the task needs.
    extraArgs: ['Read', '--add-dir', directory],
  });

  const json = extractJson(raw);
  if (!json || typeof json !== 'object') {
    logger.warn('Image review returned no JSON; keeping the automatic assignment.');
    return new Map();
  }

  const byFilename = new Map(input.candidates.map((c) => [c.filename, c.key]));
  const assignment = new Map<string, string>();

  for (const [sceneId, filename] of Object.entries(json as Record<string, unknown>)) {
    if (typeof filename !== 'string') continue;
    // Matched on filename rather than on the internal key, because the filename
    // is what the model was shown and what it can copy without inventing.
    const key = byFilename.get(path.basename(filename.trim()));
    if (key) assignment.set(sceneId, key);
  }

  return assignment;
}

function buildPrompt(input: {
  directory: string;
  candidates: readonly ReviewCandidate[];
  scenes: readonly ReviewScene[];
}): string {
  return [
    `Bạn đang chọn ảnh nền cho một video ngắn tiếng Việt dạng "fact", khung dọc`,
    `9:16. Kịch bản đã viết xong; việc của bạn là **nhìn từng ảnh** rồi quyết định`,
    `ảnh nào đặt vào cảnh nào.`,
    ``,
    `## Hãy mở tất cả ảnh trước khi quyết`,
    ``,
    `Dùng công cụ Read xem từng file trong thư mục này:`,
    `  ${input.directory}`,
    ``,
    `Đây là điểm mấu chốt: máy đã lọc sẵn theo từ khoá, nhưng **máy không nhìn`,
    `được ảnh**. Nó không phân biệt được con chuột với con chuột máy tính, cũng`,
    `không biết ảnh "rodent teeth" hoá ra là cái sọ trong bảo tàng. Bạn nhìn được.`,
    `Đó là toàn bộ lý do bước này tồn tại.`,
    ``,
    `## Các ảnh có sẵn`,
    ``,
    ...input.candidates.map(
      (c) => `  ${c.filename}  — tìm bằng "${c.query}"${c.title ? `, tiêu đề: "${c.title}"` : ''}`,
    ),
    ``,
    `## Các cảnh cần ảnh`,
    ``,
    ...input.scenes.flatMap((scene) => [
      `  [${scene.id}] (kịch bản gợi ý: "${scene.imageQuery}")`,
      `    ${scene.narration}`,
    ]),
    ``,
    `## Cách chọn`,
    ``,
    `- **Đúng chủ đề quan trọng hơn đẹp.** Một con chuột chụp hơi mờ vẫn tốt hơn`,
    `  một bức phong cảnh tuyệt đẹp không liên quan.`,
    `- **Mỗi ảnh chỉ dùng cho một cảnh.** Video mà lặp lại ảnh trông như bị lỗi.`,
    `- **Bám theo nội dung câu nói**, không chỉ theo từ khoá. Từ khoá là thứ máy`,
    `  đoán ra lúc chưa thấy ảnh; câu nói mới là thứ người xem nghe.`,
    `- Cảnh mở đầu nên nhận bức mạnh nhất - đó là hai giây quyết định người xem`,
    `  ở lại hay vuốt qua.`,
    `- Nếu một ảnh **không hợp với bất kỳ cảnh nào**, cứ bỏ không dùng.`,
    `- Nếu một cảnh **không có ảnh nào hợp**, hãy bỏ trống cảnh đó (đừng nhét bừa`,
    `  một ảnh lạc đề). Hệ thống sẽ tự xử lý phần còn lại.`,
    ``,
    `## Định dạng trả về`,
    ``,
    `Một object JSON duy nhất, khoá là id cảnh, giá trị là tên file ảnh. Không`,
    `giải thích, không rào markdown, không thêm gì khác:`,
    ``,
    '```json',
    JSON.stringify(
      Object.fromEntries(
        input.scenes
          .slice(0, 3)
          .map((scene, index) => [
            scene.id,
            input.candidates[index]?.filename ?? '01-vi-du.jpg',
          ]),
      ),
      null,
      2,
    ),
    '```',
  ].join('\n');
}
