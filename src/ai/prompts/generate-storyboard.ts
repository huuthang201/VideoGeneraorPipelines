import type { ProductInfo } from '../../domain/project';
import type { Brief } from '../../domain/brief';
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
  /** Whether the image backend is available for this run. */
  allowBroll: boolean;
  maxBrollScenes: number;
  femaleVoice: string;
  maleVoice: string;
  /** Optional user-supplied creative direction (spec: UI "bối cảnh"/"hook" boxes). */
  brief?: Brief | null;
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
    `## Bối cảnh do người dùng cung cấp`,
    ``,
    input.brief?.context
      ? [
          `Người dùng muốn video xoay quanh bối cảnh/tình huống sau. Hãy dựng`,
          `kịch bản bám theo ý này thay vì tự nghĩ bối cảnh khác:`,
          `"${input.brief.context}"`,
        ].join('\n')
      : `(Người dùng không cung cấp bối cảnh cụ thể — tự chọn bối cảnh hợp với ảnh.)`,
    ``,
    `## Ý tưởng hook do người dùng cung cấp`,
    ``,
    input.brief?.hook
      ? [
          `Người dùng muốn cảnh đầu tiên (hook, 3 giây đầu) truyền tải đúng ý sau.`,
          `Viết lại cho tự nhiên và đúng giọng văn ở phần dưới, đừng chép nguyên`,
          `văn nếu câu gốc chưa đủ hài, nhưng phải giữ đúng ý:`,
          `"${input.brief.hook}"`,
        ].join('\n')
      : `(Người dùng không cung cấp ý hook — tự nghĩ hook theo hướng dẫn bên dưới.)`,
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
    `## Giọng văn — phần quan trọng nhất`,
    ``,
    `Mục tiêu là làm người xem BẬT CƯỜI, không phải chỉ nghe thân mật.`,
    `Dùng từ ngữ trẻ mới chỉ tạo ra giọng gần gũi. Muốn hài thì cần kỹ thuật.`,
    ``,
    `### Bốn kỹ thuật, dùng ít nhất hai`,
    ``,
    `1. TUNG HỨNG — dựng một câu bình thường rồi bẻ lái ở cuối.`,
    `   "Mua bàn phím cơ để gõ code cho nhanh. Giờ tôi gõ nhanh hơn thật,`,
    `    chủ yếu là gõ tin nhắn xin lỗi vì trễ deadline."`,
    ``,
    `2. NÓI QUÁ ĐẾN VÔ LÝ — phóng đại tới mức buồn cười, nhưng đừng phóng đại`,
    `   THÔNG SỐ sản phẩm (xem phần quy tắc sự thật).`,
    `   "Cái đèn bàn này sáng tới mức mẹ tôi tưởng nhà có người tới xem mắt."`,
    ``,
    `3. TỰ TRÀO — kể một tình huống ai cũng từng dính và tự nhận mình ngốc.`,
    `   "Tôi từng giặt áo len bằng nước nóng. Giờ nó vừa con búp bê của cháu tôi."`,
    ``,
    `4. CHI TIẾT CỤ THỂ — chi tiết càng cụ thể càng buồn cười. Đừng nói chung chung.`,
    `   Nhạt:  "rất tiện lợi khi đi làm"`,
    `   Hài:   "nhét vừa ngăn bên hông balo, chỗ xưa giờ chỉ đựng vỏ kẹo"`,
    ``,
    `### Giọng đọc là giọng nam trầm, đọc tỉnh bơ`,
    ``,
    `Tận dụng điều đó: câu càng buồn cười mà đọc càng nghiêm túc thì càng hiệu quả.`,
    `Viết như đang kể chuyện thật, không phải như đang cố pha trò. Đừng chèn`,
    `"haha", "kkk", hay emoji — để nội dung tự gây cười.`,
    ``,
    `### Bắt buộc`,
    ``,
    `- Ít nhất MỘT cảnh phải có một câu thực sự buồn cười, không chỉ dễ thương.`,
    `- Hook phải là một câu đùa hoặc một tình huống oái oăm, không phải câu hỏi`,
    `  quảng cáo. "Sản phẩm này có gì hay?" là hỏng.`,
    `- CTA cũng đùa được, đừng năn nỉ mua.`,
    ``,
    `### Tuyệt đối tránh`,
    ``,
    `- "Sản phẩm được thiết kế với..." — giọng tờ rơi.`,
    `- "mang đến trải nghiệm tuyệt vời" — sáo rỗng, không ai nói vậy.`,
    `- Liệt kê tính năng khô khan. Kể chuyện dùng nó thì hơn.`,
    `- Cố tỏ ra hài bằng cách chêm thật nhiều từ lóng. Lố còn tệ hơn nhạt.`,
    `- CHÉP LẠI câu đùa trong các ví dụ trên. Chúng chỉ minh hoạ kỹ thuật;`,
    `  câu đùa phải xuất phát từ chính sản phẩm trong ảnh.`,
    ``,
    `### So sánh`,
    ``,
    `  Nhạt: "Chiếc ghế này có tựa lưng công thái học, ngồi rất thoải mái."`,
    `  Được: "Ngồi ba tiếng liền mà lưng không kêu ca gì.`,
    `         Lần đầu trong đời cái ghế tử tế với tôi hơn đồng nghiệp."`,
    ``,
    `  Nhạt: "Nồi chiên không dầu giúp món ăn ít dầu mỡ hơn."`,
    `  Được: "Tôi nướng gà bằng cái này. Khói ít tới mức hàng xóm không`,
    `         sang hỏi thăm nữa. Hơi tiếc, tôi thích được hỏi thăm."`,
    ``,
    `## Yêu cầu nội dung`,
    ``,
    `- Toàn bộ nội dung bằng TIẾNG VIỆT.`,
    `- "narration" của mỗi cảnh là câu sẽ được đọc thành tiếng, TỐI ĐA 200 ký tự.`,
    `  Đủ cho một câu dựng và một câu bẻ lái. Dài hơn sẽ bị từ chối.`,
    `- "headline" là chữ hiện trên màn hình: tối đa 28 ký tự, ngắn và đập vào mắt.`,
    `  Headline cũng nên tếu, đừng chỉ lặp lại narration.`,
    `- Cảnh đầu tiên phải là "hook" và phải khiến người xem dừng lại trong 1 giây.`,
    `  Hook hay nhất thường là một câu hỏi cắc cớ hoặc một tình huống buồn cười.`,
    `- Cảnh cuối cùng phải là "cta". CTA cũng nhẹ nhàng đùa được, đừng ép mua.`,
    `- Tổng độ dài mong muốn khoảng ${input.targetDurationSec} giây.`,
    `- Dùng 4 đến 6 cảnh.`,
    `- Mỗi ảnh nên được dùng ít nhất một lần nếu hợp lý.`,
    ``,
    `## Cảnh b-roll (ảnh do AI sinh)`,
    ``,
    input.allowBroll
      ? [
          `Ba tấm ảnh sản phẩm khó gánh nổi ${input.targetDurationSec} giây mà không lặp lại.`,
          `Bạn được thêm cảnh loại "broll": ảnh bối cảnh do AI sinh, xen giữa các cảnh sản phẩm.`,
          ``,
          `Cảnh "broll" khác mọi loại khác ở chỗ:`,
          `- KHÔNG có trường "asset" (để chuỗi rỗng) — ảnh chưa tồn tại.`,
          `- BẮT BUỘC có trường "imagePrompt": mô tả ảnh cần sinh, viết bằng TIẾNG ANH.`,
          ``,
          `### Ba quy tắc tuyệt đối cho imagePrompt`,
          ``,
          `1. KHÔNG được nhắc tới sản phẩm. Không tên, không thương hiệu, không loại`,
          `   sản phẩm. Ảnh sinh là BỐI CẢNH quanh sản phẩm — quán cà phê lúc đêm,`,
          `   bàn làm việc bừa bộn, đường phố lúc tan tầm. Sản phẩm chỉ xuất hiện`,
          `   qua ảnh chụp thật mà người bán cung cấp.`,
          ``,
          `2. KHÔNG được minh hoạ một tính năng mà info.json không có. Một tấm ảnh`,
          `   mưa xối xả nói "chống nước" mạnh hơn mọi câu chữ. Ảnh cũng là một`,
          `   lời khẳng định, nên phải có nguồn y như lời nói.`,
          ``,
          `3. KHÔNG đặt chữ vào ảnh. Model sinh chữ rất tệ, sẽ ra chữ méo vô nghĩa.`,
          ``,
          `### Viết imagePrompt thế nào`,
          ``,
          `Tiếng Anh, một câu dài, tả: chủ thể · bối cảnh · ánh sáng · góc máy ·`,
          `độ sâu trường ảnh · tông màu. Ưu tiên cảnh rộng, tránh cận mặt người`,
          `(model hay lỗi ở mặt và tay).`,
          ``,
          `Ví dụ tốt:`,
          `  "cinematic wide shot of a quiet Hanoi coffee shop at night, warm`,
          `   pendant lights, rain streaking the window, empty wooden tables,`,
          `   shallow depth of field, moody amber and teal grading"`,
          ``,
          `Ví dụ BỊ CHẶN:`,
          `  "a thermos on a desk"          → nhắc tới sản phẩm`,
          `  "a bag surviving heavy rain"   → minh hoạ tính năng`,
          `  "a sign saying SALE 50%"       → có chữ, và là khuyến mãi bịa`,
          ``,
          `Dùng nhiều nhất ${Math.floor(input.maxBrollScenes)} cảnh broll. Phần lớn video`,
          `vẫn phải là sản phẩm thật.`,
        ].join('\n')
      : `Lần này KHÔNG dùng cảnh "broll". Chỉ dùng ảnh thật đã cung cấp.`,
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
    `- type: ${(input.allowBroll ? SCENE_TYPES : SCENE_TYPES.filter((t) => t !== 'broll')).join(' | ')}`,
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
