import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { callClaude, extractJson } from '../../ai/claude-runner';
import type { AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import type { ReviewCandidate } from './image/stock/types';
import { ARTICLE_PREFIX } from './image/stock/article.provider';

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
 * Bounded by what a batch actually takes, not by what it ought to.
 *
 * The first estimate was "twenty small images and a short mapping, well under
 * a minute", and the ceiling was three minutes. Measured on a seventeen-minute
 * video - thirty thumbnails and twelve scenes of narration a batch, the model
 * opening every picture with its own tool call - a batch that succeeds takes
 * two and a half to three minutes. Three was the median, not the ceiling: four
 * of eight batches timed out, and the one that failed outright was the first,
 * so the opening scenes went to the automatic assignment - which never offers
 * the press photographs a person had arranged permission for. Seven minutes
 * now; a call that needs longer has stopped working rather than being slow.
 */
const TIMEOUT_MS = 420_000;

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
    /** One line describing the video, so the advice fits the format. */
    format?: string;
    /** A second look at empty scenes; pictures already in the video may be reused. */
    reuse?: boolean;
  },
): Promise<ReadonlyMap<string, string>> {
  const directory = path.resolve(input.directory);
  const prompt = buildPrompt({ ...input, directory });

  /*
   * Remembered by the exact prompt.
   *
   * The engine promises that the same storyboard renders the same video, and
   * this call was the one place that broke it: every re-render asked again,
   * spent another half hour on a long video, and came back with different
   * pictures. Keyed on the whole prompt - the pictures on the sheet, the
   * sentences, the rules - so a change to any of them asks afresh.
   */
  const cachePath = path.join(
    config.stock.cacheDir,
    'review-verdicts',
    `${createHash('sha1').update(prompt).digest('hex')}.json`,
  );
  const remembered = await readFile(cachePath, 'utf8')
    .then((text) => JSON.parse(text) as Record<string, string>)
    .catch(() => null);
  if (remembered) {
    logger.debug('Image review: using the remembered verdict for this exact sheet');
    return new Map(Object.entries(remembered));
  }

  const raw = await callClaude(prompt, config, logger, {
    timeoutMs: TIMEOUT_MS,
    // Read, on the thumbnail directory only. The model has to open the images;
    // it has no reason to write anything or to see the rest of the disk, and a
    // filename is attacker-influenced input - it comes from a stock site's
    // title - so the grant is kept to exactly what the task needs.
    extraArgs: ['Read', '--add-dir', directory],
  });

  // Thrown rather than answered with an empty map. Empty means "looked, and
  // nothing fits", and a second look acts on that - the scenes keep the picture
  // before them. A reply that was not JSON is a failure, and must not read as
  // a verdict on every scene in the batch.
  const json = extractJson(raw);
  if (!json || typeof json !== 'object') {
    throw new Error('Image review returned no JSON');
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

  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(Object.fromEntries(assignment), null, 2)}\n`, 'utf8');
  return assignment;
}

function buildPrompt(input: {
  directory: string;
  candidates: readonly ReviewCandidate[];
  scenes: readonly ReviewScene[];
  format?: string;
  reuse?: boolean;
}): string {
  return [
    // Named rather than assumed: this pass is shared by a thirty-second
    // vertical short and a seventeen-minute landscape video, and the advice
    // below - which scene gets the strongest picture, how long a viewer looks
    // at one - reads differently in each.
    input.format ?? 'Bạn đang chọn ảnh nền cho một video ngắn tiếng Việt dạng "fact", khung dọc 9:16.',
    `Kịch bản đã viết xong; việc của bạn là **nhìn từng ảnh** rồi quyết định ảnh`,
    `nào đặt vào cảnh nào.`,
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
      (c) =>
        `  ${c.filename}  — tìm bằng "${c.query}"${c.title ? `, tiêu đề: "${c.title}"` : ''}` +
        (c.usedBy ? ` — ĐANG DÙNG ở cảnh ${c.usedBy}` : ''),
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
    `- **Loại ảnh có người nổi tiếng nhận ra được** - chính trị gia, diễn viên,`,
    `  vận động viên, người của công chúng. Kho ảnh mở có rất nhiều ảnh tư liệu`,
    `  chính phủ, và đặt mặt một người có thật dưới một câu nói về thói quen hay`,
    `  sai lầm là ngụ ý điều gì đó về chính họ. Ảnh người vô danh, chụp đời`,
    `  thường, hoặc không thấy rõ mặt thì tốt.`,
    `- **Loại ảnh có watermark**, chữ ký chìm, hay chữ của kho ảnh lặp đi lặp lại`,
    `  trên nền. Máy không đọc được thứ đó từ tiêu đề, chỉ bạn nhìn thấy - và một`,
    `  video có watermark trông như hàng ăn cắp.`,
    // Only when the sheet has press photographs, so a sheet without them - every
    // short - gets exactly the prompt it always did. Without the exception the
    // rule above rejects them: Tuổi Trẻ and Thanh Niên print their logo in the
    // corner, and those are the photographs the channel asked permission for.
    ...(input.candidates.some((c) => c.query.startsWith(ARTICLE_PREFIX))
      ? [
          `  **Ngoại lệ: ảnh tìm bằng "article:..."** là ảnh báo chí dùng với sự cho`,
          `  phép của toà soạn. Logo của chính toà soạn ở góc ảnh (tuoitre, THANH NIÊN...)`,
          `  là một phần ảnh gốc, được giữ nguyên và ghi nguồn - không phải watermark`,
          `  ăn cắp. Đừng loại những ảnh này vì logo.`,
        ]
      : []),
    ...(input.reuse
      ? [
          `- **Lượt này được dùng lại ảnh.** Các cảnh dưới đây đã được xem một lần và bị`,
          `  bỏ trống, vì không có ảnh mới nào hợp. Ảnh ghi "ĐANG DÙNG ở cảnh …" đã có`,
          `  trong video: nếu nó đúng với câu nói của cảnh này thì cứ dùng lại - một ảnh`,
          `  đúng xuất hiện hai lần tốt hơn nhiều một ảnh lạc đề. Ưu tiên ảnh của cảnh ở`,
          `  gần (cùng một đoạn kể). Hệ thống giới hạn số lần một ảnh xuất hiện trong cả`,
          `  video, nên hãy rải đều: nhiều ảnh khác nhau cùng đúng chủ đề tốt hơn một ảnh`,
          `  lặp lại.`,
        ]
      : [`- **Mỗi ảnh chỉ dùng cho một cảnh.** Video mà lặp lại ảnh trông như bị lỗi.`]),
    `- **Bám theo nội dung câu nói**, không chỉ theo từ khoá. Từ khoá là thứ máy`,
    `  đoán ra lúc chưa thấy ảnh; câu nói mới là thứ người xem nghe.`,
    `- Cảnh đầu tiên nên nhận bức mạnh nhất - đó là chỗ người xem quyết định ở`,
    `  lại hay đi.`,
    `- Nếu một ảnh **không hợp với bất kỳ cảnh nào**, cứ bỏ không dùng.`,
    `- **Nếu một cảnh không có ảnh nào hợp, hãy bỏ trống cảnh đó.** Đừng nhét`,
    `  bừa một ảnh lạc đề cho đủ. Đây là quy tắc quan trọng nhất ở đây: một cảnh`,
    input.reuse
      ? `  bỏ trống sẽ giữ nguyên ảnh của cảnh ngay trước nó, còn một ảnh lạc đề bạn cố nhét vào`
      : `  bỏ trống sẽ được hệ thống gán ảnh khác, còn một ảnh lạc đề bạn cố nhét vào`,
    `  thì đi thẳng ra video và người xem thấy ngay. Bỏ trống năm cảnh còn hơn`,
    `  đặt sai năm cảnh.`,
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
