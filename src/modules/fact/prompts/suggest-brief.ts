import type { ProductInfo } from '../../../domain/project';

/**
 * A short, single-shot prompt used before the real storyboard prompt: it asks
 * Claude for a fact worth a video, to fill the two text boxes in the UI before
 * anything is generated.
 *
 * Deliberately much cheaper than the storyboard call - no script is written
 * here, just a fact and one opening line the user is expected to rewrite.
 *
 * It used to work by looking at the uploaded photographs and suggesting a topic
 * they could carry. There are no uploaded photographs any more, so the job has
 * inverted: the fact is chosen first and the pictures are searched for
 * afterwards. That is a better order for this format anyway - the fact is what
 * the video is, and the backdrop is what it is shot against.
 *
 * Written in Vietnamese for the same reason the storyboard prompt is: what
 * comes back goes straight into two boxes a Vietnamese speaker reads, and then
 * into a prompt that has to produce Vietnamese prose.
 */
export interface SuggestBriefPromptInput {
  /**
   * What the project is called, used as the subject to find a fact inside.
   *
   * The project name is the only thing a person types before asking for a
   * suggestion, so it is the only signal of what they wanted. Treated as a
   * *hint* rather than a constraint: names like "Dự án 2" carry no subject, and
   * a prompt that insisted on one would produce a fact about the number two.
   */
  topic: string;
  info: ProductInfo | null;
  /**
   * Titles the channel has already published or drafted.
   *
   * Passed so the suggestion is not one of them. At a video an hour a channel
   * exhausts the obvious facts within days, and nothing else in the system has
   * any memory of what it has already said.
   */
  alreadyCovered: readonly string[];
}

/** How many past titles to show. Enough to avoid repeats, short enough to read. */
const MAX_COVERED = 40;

export function buildSuggestBriefPrompt(input: SuggestBriefPromptInput): string {
  const covered = input.alreadyCovered.slice(-MAX_COVERED);

  return [
    `Sắp có một video ngắn tiếng Việt thể loại "fact" được viết: một sự thật có`,
    `thật, kể trong khoảng bốn mươi lăm giây, khung dọc, giọng nam miền Bắc đọc`,
    `trên nền ảnh chụp. Việc của bạn chỉ là gợi ý xem video đó nên nói về gì.`,
    ``,
    `## Người dùng đặt tên dự án là: "${input.topic}"`,
    ``,
    `Đó là manh mối duy nhất về thứ họ muốn nghe, nên hãy bám vào nó:`,
    ``,
    `- Nếu cái tên chỉ ra một **chủ thể** rõ ràng (một con vật, một nơi chốn, một`,
    `  đồ vật, một hiện tượng), hãy tìm một sự thật bất ngờ **về đúng chủ thể đó**.`,
    `  Tên "con chuột" thì kể chuyện về chuột, không phải về loài gặm nhấm nói`,
    `  chung, càng không phải về chuột máy tính - trừ khi tên nói rõ như vậy.`,
    `- Nếu cái tên chỉ ra một **lĩnh vực rộng** ("vũ trụ", "cơ thể người"), chọn`,
    `  một sự thật cụ thể trong lĩnh vực đó.`,
    `- Nếu cái tên **không mang nghĩa gì** (kiểu "Dự án 2", "test", một dãy chữ`,
    `  bất kỳ), hãy bỏ qua nó hoàn toàn và tự chọn một sự thật hay như bình`,
    `  thường. Đừng cố nặn ra ý nghĩa từ một cái tên tạm.`,
    ``,
    `Tên có thể mất dấu tiếng Việt ("con chuot" thay vì "con chuột") - cứ hiểu`,
    `theo nghĩa hợp lý nhất trong ngữ cảnh.`,
    ``,
    `## Chọn sự thật thế nào`,
    ``,
    `- Phải là điều bạn **thực sự chắc chắn là đúng**. Không bịa số liệu, năm,`,
    `  tên nghiên cứu hay tên nhà khoa học. Không chắc thì chọn sự thật khác.`,
    `- Không lấy tin đồn mạng đã bị bác bỏ ("người ta chỉ dùng 10% bộ não",`,
    `  "Vạn Lý Trường Thành nhìn thấy từ vũ trụ").`,
    `- Chọn thứ một người Việt bình thường **chưa biết**, nhưng nghe giải thích`,
    `  xong thì thấy hợp lý ngay. Đó là cảm giác khiến người ta xem hết và gửi`,
    `  cho bạn bè.`,
    `- Ưu tiên sự thật **có thứ để nhìn**: một con vật, một nơi chốn, một đồ vật,`,
    `  một hiện tượng tự nhiên. Ảnh minh hoạ sẽ được tìm tự động từ kho ảnh, nên`,
    `  một sự thật thuần trừu tượng rất khó dựng thành hình.`,
    ``,
    covered.length > 0
      ? [
          `## Kênh đã làm những video này rồi`,
          ``,
          `Đừng gợi ý trùng, và cũng đừng gợi ý một biến thể sát nghĩa của chúng:`,
          ``,
          ...covered.map((title) => `  - ${title}`),
        ].join('\n')
      : `(Kênh chưa có video nào, nên chủ đề nào cũng còn mới.)`,
    ``,
    `## Tư liệu tham khảo`,
    input.info
      ? '```json\n' + JSON.stringify(input.info, null, 2) + '\n```'
      : '(Không có info.json.)',
    ``,
    `## Cần trả về gì`,
    ``,
    `1. "context": hai đến ba câu nêu rõ SỰ THẬT cụ thể mà video sẽ kể, và cách`,
    `   giải thích tại sao nó đúng. Phải cụ thể đến mức viết kịch bản được ngay:`,
    `   "mật ong không bao giờ hỏng, vì gần như không có nước nên vi khuẩn không`,
    `   sống được" là dùng được; "về thiên nhiên" thì không.`,
    `2. "hook": một câu mở đầu, nói thẳng vào điều lạ, không chào hỏi và không`,
    `   hỏi tu từ. Đây là câu quyết định người xem ở lại hay vuốt qua.`,
    ``,
    `Cả hai bằng tiếng Việt. Đây mới là điểm khởi đầu: người dùng sẽ đọc lại và`,
    `có thể sửa trước khi sinh kịch bản.`,
    ``,
    `Trả về DUY NHẤT một object JSON, không giải thích, không rào markdown:`,
    '```json',
    JSON.stringify(
      {
        context: 'sự thật cụ thể mà video sẽ kể, kèm cách giải thích',
        hook: 'câu mở đầu nói thẳng vào điều lạ',
      },
      null,
      2,
    ),
    '```',
  ].join('\n');
}
