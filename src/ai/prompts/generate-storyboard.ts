import type { ProductInfo } from '../../domain/project';
import { ANIMATIONS, SCENE_TYPES, TRANSITIONS } from '../../domain/scene';
import { STYLES } from '../../domain/config';

/**
 * The single prompt (spec §6: one Claude reasoning per video).
 *
 * Its job is narrow on purpose. The model is not asked for dimensions, frame
 * rate, durations that matter, or component names - all of those either belong
 * to the system or are derived later from real audio. What it is uniquely good
 * at, and what nothing else in the pipeline can do, is look at photographs,
 * work out what the product is, and write Vietnamese that someone would
 * actually stop scrolling for.
 */

export interface PromptInput {
  projectId: string;
  productName: string;
  info: ProductInfo | null;
  /** Filenames the model may reference, exactly as they appear on disk. */
  assetFilenames: string[];
  previewDir: string;
  targetDurationSec: number;
  defaultStyle: string;
  femaleVoice: string;
  maleVoice: string;
}

export function buildStoryboardPrompt(input: PromptInput): string {
  const strict = input.info === null || input.info.price === undefined;

  return [
    `Bạn đang viết kịch bản cho một video dọc ngắn (TikTok/Shorts) về một sản phẩm.`,
    ``,
    `## Ảnh sản phẩm`,
    `Đọc tất cả ảnh trong thư mục sau bằng công cụ Read:`,
    `  ${input.previewDir}`,
    ``,
    `Các file được phép tham chiếu (dùng đúng tên này trong trường "asset"):`,
    ...input.assetFilenames.map((f) => `  - ${f}`),
    ``,
    `## Thông tin sản phẩm`,
    input.info
      ? '```json\n' + JSON.stringify(input.info, null, 2) + '\n```'
      : '(Không có info.json — xem phần quy tắc bên dưới.)',
    ``,
    `## Quy tắc về sự thật — quan trọng nhất`,
    ``,
    `Bạn ĐƯỢC suy luận từ ảnh: ảnh nào đẹp, ảnh nào hợp làm hook, ảnh nào hợp`,
    `cảnh tính năng, sản phẩm trông thuộc nhóm nào, phong cách dựng nào hợp.`,
    ``,
    `Bạn KHÔNG ĐƯỢC tự bịa: giá, thông số kỹ thuật, dung lượng pin, bảo hành,`,
    `khuyến mãi, chứng nhận, hay bất kỳ tuyên bố nào về sản phẩm mà info.json`,
    `không có. Nếu một thông tin không có trong info.json thì đừng nhắc tới nó.`,
    strict
      ? [
          ``,
          `LƯU Ý: lần này KHÔNG có giá trong info.json. Tuyệt đối không nêu bất kỳ`,
          `con số nào — kể cả viết bằng chữ ("ba trăm chín chín nghìn"). Chỉ mô tả`,
          `những gì nhìn thấy được trong ảnh.`,
        ].join('\n')
      : [
          ``,
          `Giá trong info.json được phép nhắc tới. Trong "narration" hãy viết giá`,
          `bằng chữ để đọc cho tự nhiên; trong "headline" viết ngắn gọn cũng được.`,
        ].join('\n'),
    ``,
    `## Giọng văn — đọc kỹ phần này`,
    ``,
    `Viết như một đứa bạn thân đang nhắn cho bạn về món đồ nó vừa mua, chứ không`,
    `phải nhân viên bán hàng đọc kịch bản. Vui, tếu, hơi lầy một chút.`,
    ``,
    `NÊN:`,
    `- Nói chuyện trực tiếp với người xem: "ê", "này", "công nhận", "thật sự".`,
    `- Cường điệu cho vui: "xinh xỉu", "mê luôn", "chốt đơn ngay", "hết nước chấm".`,
    `- Thả một câu tự trào hoặc tình huống đời thường ai cũng dính: quên sạc,`,
    `  trời mưa, đi làm muộn, ví hết tiền cuối tháng.`,
    `- Câu ngắn. Nhịp nhanh. Thỉnh thoảng một câu cụt lủn cho có nhịp.`,
    `- Dùng từ ngữ trẻ, tự nhiên như trên TikTok Việt Nam.`,
    ``,
    `KHÔNG NÊN:`,
    `- "Sản phẩm này được thiết kế với..." — nghe như tờ rơi, bỏ ngay.`,
    `- "Với chất liệu cao cấp, mang đến trải nghiệm..." — sáo rỗng.`,
    `- Liệt kê tính năng khô khan. Kể chuyện dùng nó thì hơn.`,
    `- Trịnh trọng, khách sáo, hay xưng "quý khách".`,
    ``,
    `Ví dụ khác biệt:`,
    `  Cứng:  "Balo được làm từ chất liệu chống nước cao cấp."`,
    `  Nên:   "Trời mưa tầm tã mà mở ra laptop vẫn khô cong. Đỉnh thật sự."`,
    ``,
    `  Cứng:  "Tai nghe có tính năng chống ồn chủ động."`,
    `  Nên:   "Bật chống ồn lên là ông chú karaoke kế bên biến mất luôn."`,
    ``,
    `## Yêu cầu nội dung`,
    ``,
    `- Toàn bộ nội dung bằng TIẾNG VIỆT.`,
    `- "narration" của mỗi cảnh là câu sẽ được đọc thành tiếng.`,
    `- "headline" là chữ hiện trên màn hình: tối đa 28 ký tự, ngắn và đập vào mắt.`,
    `  Headline cũng nên tếu, đừng chỉ lặp lại narration.`,
    `- Cảnh đầu tiên phải là "hook" và phải khiến người xem dừng lại trong 1 giây.`,
    `  Hook hay nhất thường là một câu hỏi cắc cớ hoặc một tình huống buồn cười.`,
    `- Cảnh cuối cùng phải là "cta". CTA cũng nhẹ nhàng đùa được, đừng ép mua.`,
    `- Tổng độ dài mong muốn khoảng ${input.targetDurationSec} giây.`,
    `- Dùng 4 đến 6 cảnh.`,
    `- Mỗi ảnh nên được dùng ít nhất một lần nếu hợp lý.`,
    ``,
    `## Nhịp hình`,
    ``,
    `Video này chỉ có ảnh tĩnh, nên chuyển động do bạn chọn là thứ giữ người xem.`,
    `Đừng dùng đi dùng lại một animation. Xen kẽ zoom và pan để mỗi cảnh có nhịp`,
    `khác nhau, và ưu tiên "cut" cho style nhanh — chuyển cảnh dứt khoát hợp với`,
    `nội dung tếu hơn là fade chậm rãi.`,
    ``,
    `## Giá trị hợp lệ`,
    ``,
    `- type: ${SCENE_TYPES.join(' | ')}`,
    `- animation: ${ANIMATIONS.join(' | ')}`,
    `- transition: ${TRANSITIONS.join(' | ')}`,
    `- style: ${STYLES.join(' | ')} (gợi ý: ${input.defaultStyle})`,
    `- voice: ${input.femaleVoice} (nữ) | ${input.maleVoice} (nam)`,
    ``,
    `Chỉ được chọn trong các giá trị trên. Không tự nghĩ ra giá trị mới.`,
    ``,
    `## Định dạng đầu ra`,
    ``,
    `Trả về DUY NHẤT một object JSON, không kèm giải thích, không kèm markdown.`,
    `"duration" chỉ là ước lượng thô — hệ thống sẽ tính lại độ dài thật từ giọng đọc.`,
    ``,
    '```json',
    JSON.stringify(
      {
        version: '1.0',
        project: { id: input.projectId, productName: input.productName },
        video: { style: input.defaultStyle },
        voice: { voice: input.femaleVoice, rate: '+5%' },
        content: {
          hook: 'câu hook ngắn',
          narration: '',
          cta: 'câu kêu gọi hành động',
        },
        scenes: [
          {
            id: 'scene-01',
            type: 'hook',
            asset: input.assetFilenames[0] ?? '01.jpg',
            headline: 'Chữ trên màn hình',
            narration: 'Câu sẽ được đọc thành tiếng.',
            duration: 4,
            animation: 'zoom-in',
            transition: 'cut',
          },
        ],
      },
      null,
      2,
    ),
    '```',
    ``,
    `Trường "content.narration" cứ để chuỗi rỗng — hệ thống tự ghép từ các cảnh.`,
  ].join('\n');
}

/** Appended verbatim on a retry so the model sees exactly what was wrong. */
export function buildRetryPrompt(originalPrompt: string, problems: string): string {
  return [
    originalPrompt,
    ``,
    `---`,
    ``,
    `## Lần trước chưa đạt`,
    ``,
    problems,
    ``,
    `Hãy trả lại JSON đã sửa. Vẫn chỉ JSON, không kèm gì khác.`,
  ].join('\n');
}
