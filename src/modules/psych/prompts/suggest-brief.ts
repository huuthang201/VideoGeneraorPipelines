import type { SuggestBriefPromptInput } from '../../shorts/prompts';

/**
 * The cheap call that fills the two boxes before anything is generated.
 *
 * Same job as the fact channel's, one different pressure: the space of
 * "psychological effects" is small enough to exhaust and famous enough that
 * everyone reaches for the same six. Left alone, a channel like this publishes
 * the anchoring effect, the halo effect and confirmation bias in its first
 * week and then repeats them, so the list of what has already been made
 * matters more here than it does for facts - and being told to go past the
 * obvious ones is part of the ask.
 */

/** How many past titles to show. Enough to avoid repeats, short enough to read. */
const MAX_COVERED = 40;

export function buildSuggestBriefPrompt(input: SuggestBriefPromptInput): string {
  const covered = input.alreadyCovered.slice(-MAX_COVERED);

  return [
    `Sắp có một video ngắn tiếng Việt về tâm lý và hành vi con người được viết:`,
    `khoảng bốn mươi lăm giây, khung dọc, giọng nam miền Bắc đọc trên nền ảnh`,
    `chụp. Kênh tên "Não Có Vấn Đề", chuyên giải mã những chuyện kỳ lạ trong đầu`,
    `và trong hành vi con người - tâm lý, tình yêu, giao tiếp, thao túng, ngôn`,
    `ngữ cơ thể, và những "chiêu" tâm lý gặp mỗi ngày. Việc của bạn chỉ là gợi ý`,
    `xem video đó nên nói về gì.`,
    ``,
    `## Người dùng đặt tên dự án là: "${input.topic}"`,
    ``,
    `Đó là manh mối duy nhất về thứ họ muốn nghe, nên hãy bám vào nó:`,
    ``,
    `- Nếu cái tên chỉ ra một **hiện tượng hoặc tình huống** cụ thể ("tại sao hay`,
    `  trì hoãn", "người yêu cũ", "phỏng vấn xin việc"), hãy tìm một cơ chế tâm`,
    `  lý giải thích đúng chuyện đó.`,
    `- Nếu cái tên chỉ ra một **lĩnh vực rộng** ("tình yêu", "giao tiếp", "thao`,
    `  túng"), chọn một hiệu ứng cụ thể trong lĩnh vực đó - đừng nói chung chung.`,
    `- Nếu cái tên **không mang nghĩa gì** (kiểu "Dự án 2", "test", một dãy chữ`,
    `  bất kỳ), hãy bỏ qua nó hoàn toàn và tự chọn một hiệu ứng hay như bình`,
    `  thường. Đừng cố nặn ra ý nghĩa từ một cái tên tạm.`,
    ``,
    `Tên có thể mất dấu tiếng Việt ("tri hoan" thay vì "trì hoãn") - cứ hiểu theo`,
    `nghĩa hợp lý nhất trong ngữ cảnh.`,
    ``,
    `## Chọn chủ đề thế nào`,
    ``,
    `- Phải là tâm lý học **thật**. Không lấy những thứ đã bị bác bỏ: "chỉ dùng`,
    `  10% bộ não", "người não trái / não phải", "phong cách học tập", quy tắc`,
    `  7-38-55 của Mehrabian, "khoanh tay là phòng thủ", đọc vị nói dối qua ngôn`,
    `  ngữ cơ thể, "21 ngày tạo thói quen", hiệu ứng Mozart, quảng cáo tiềm thức.`,
    `- Không bịa số liệu, năm, tên nghiên cứu hay tên nhà nghiên cứu. Không chắc`,
    `  thì chọn hiệu ứng khác.`,
    `- Chọn thứ người xem **đã từng trải qua nhưng chưa gọi được tên**. Cảm giác`,
    `  "à hoá ra cái đó có tên" là thứ khiến người ta xem hết và gửi cho bạn bè.`,
    `- **Đi qua những cái quá quen nếu kênh đã làm rồi.** Hiệu ứng mỏ neo, hiệu`,
    `  ứng hào quang và thiên kiến xác nhận là ba cái ai cũng nghĩ tới đầu tiên;`,
    `  nếu chúng có trong danh sách bên dưới thì hãy đi xa hơn.`,
    `- Ưu tiên thứ **đặt được vào một khung cảnh có thật**: một cửa hàng, một cuộc`,
    `  phỏng vấn, một tin nhắn chưa trả lời, một đám đông. Ảnh sẽ được tìm tự động`,
    `  từ kho ảnh, và kho ảnh chụp được tình huống chứ không chụp được khái niệm.`,
    `- Nếu là chuyện thao túng, đặt ở phía **người bị tác động nhận ra**, không`,
    `  phải phía người đi tác động.`,
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
    `1. "context": hai đến ba câu nêu rõ HIỆN TƯỢNG cụ thể video sẽ giải thích và`,
    `   cơ chế đằng sau nó. Phải cụ thể đến mức viết kịch bản được ngay: "cái áo`,
    `   hai triệu thành rẻ khi bên cạnh treo cái năm triệu, vì não bám vào con số`,
    `   đầu tiên nhìn thấy làm mốc" là dùng được; "về tâm lý mua sắm" thì không.`,
    `2. "hook": một câu mở đầu **tả tình huống người xem đã từng sống qua**, chưa`,
    `   gọi tên hiệu ứng, không chào hỏi và không hỏi tu từ. Đây là câu quyết định`,
    `   người xem ở lại hay vuốt qua.`,
    ``,
    `Cả hai bằng tiếng Việt. Đây mới là điểm khởi đầu: người dùng sẽ đọc lại và`,
    `có thể sửa trước khi sinh kịch bản.`,
    ``,
    `Trả về DUY NHẤT một object JSON, không giải thích, không rào markdown:`,
    '```json',
    JSON.stringify(
      {
        context: 'hiện tượng cụ thể video sẽ giải thích, kèm cơ chế đằng sau',
        hook: 'câu mở đầu tả một tình huống đời thường, chưa gọi tên hiệu ứng',
      },
      null,
      2,
    ),
    '```',
  ].join('\n');
}
