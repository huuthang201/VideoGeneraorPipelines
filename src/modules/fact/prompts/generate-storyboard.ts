import type { StoryboardPromptInput } from '../../shorts/prompts';
import {
  imageQuerySection,
  lengthSection,
  sceneFieldsSection,
  shapeOf,
  validValuesSection,
  voiceMechanicsSection,
} from '../../shorts/prompt-parts';
import { MAX_IMAGE_QUERIES, MIN_IMAGE_QUERIES } from '../../shorts/domain/storyboard';

/**
 * The single prompt: one Claude reasoning per video.
 *
 * Its job is narrow on purpose. The model is not asked for dimensions, frame
 * rate, or durations that matter - those either belong to the system or are
 * derived later from real audio. What it is uniquely good at, and what nothing
 * else in the pipeline can do, is know a fact worth thirty seconds of someone's
 * attention, say it in Vietnamese that sounds like a person talking, and decide
 * which photograph belongs under which part of it.
 *
 * The prompt is written in Vietnamese even though the codebase around it is in
 * English. That is not inconsistency: the deliverable is Vietnamese prose, and a
 * prompt in one language asking for prose in another reliably produces prose
 * with the first language's rhythm in it - which in a language with tones and
 * particles is immediately audible.
 *
 * ## What is hard here is not length
 *
 * In the long-form engine this grew out of, length was the fight: a model asked
 * for ten minutes returns two. At forty-five seconds the model has no trouble
 * filling the budget, and the checks in `checkStoryboardStructure` guard both
 * ends because *overrunning* is now the expensive failure - past sixty seconds
 * YouTube stops treating the upload as a Short.
 *
 * The fight here is truthfulness and the first two seconds. A "fact" video is
 * worth nothing if the fact is invented, and it is watched by nobody if the
 * opening line is a wind-up. Both get more of this prompt than anything else.
 */

export function buildStoryboardPrompt(input: StoryboardPromptInput): string {
  const shape = shapeOf(input.targetDurationSec);
  const { seconds, wordsPerScene } = shape;

  return [
    `Bạn đang viết kịch bản cho MỘT video ngắn tiếng Việt thuộc thể loại "fact" -`,
    `một sự thật có thật, kể trong khoảng ${seconds} giây, khung dọc 9:16, giọng nam`,
    `miền Bắc đọc trên nền ảnh chụp.`,
    ``,
    `Người xem đang lướt. Họ không tìm video này, nó tự hiện ra giữa hàng trăm`,
    `video khác, và họ quyết định ở lại hay vuốt qua trong khoảng hai giây. Rất`,
    `nhiều người xem trong trạng thái TẮT TIẾNG, chỉ đọc phụ đề. Viết với hai điều`,
    `đó trong đầu suốt từ đầu đến cuối.`,
    ``,
    `## Yêu cầu số một: sự thật phải là sự thật`,
    ``,
    `Đây là kênh fact. Một con số bịa ra làm hỏng cả kênh, và không ai kiểm tra hộ`,
    `bạn ngoài chính bạn. Vì vậy:`,
    ``,
    `- Chỉ viết những điều bạn thực sự biết là đúng. Nếu không chắc, chọn sự thật`,
    `  khác - đừng viết một câu đúng "đại khái".`,
    `- Không bịa số liệu, năm, tên nghiên cứu, tên nhà khoa học, tên tổ chức. Thà`,
    `  viết "khoảng ba nghìn năm" còn hơn bịa "3.247 năm" cho ra vẻ chính xác.`,
    `- Không dùng những câu mở kiểu "các nhà khoa học đã chứng minh" trừ khi bạn`,
    `  nói được cụ thể ai và chuyện gì.`,
    `- Không lấy tin đồn mạng làm fact: những chuyện kiểu "người ta chỉ dùng 10%`,
    `  bộ não" đã bị bác bỏ từ lâu, và đăng lại chúng là cách nhanh nhất để mất`,
    `  người xem hiểu chuyện.`,
    `- Nếu sự thật có phần gây tranh cãi, nói rõ ngay trong câu: "phần lớn các nhà`,
    `  nghiên cứu cho rằng...".`,
    ``,
    `Một sự thật cũ mà đúng luôn tốt hơn một sự thật giật gân mà sai.`,
    ``,
    `## Yêu cầu số hai: hai giây đầu tiên`,
    ``,
    `Cảnh đầu tiên là cái quyết định video này có được xem hay không. Câu đầu tiên`,
    `phải NÓI THẲNG vào điều lạ - không chào hỏi, không "hôm nay chúng ta sẽ tìm`,
    `hiểu về", không "bạn có bao giờ tự hỏi".`,
    ``,
    `Tốt:   "Mật ong để ba nghìn năm vẫn ăn được."`,
    `Tốt:   "Có một loài sứa gần như không thể chết già."`,
    `Tệ:    "Xin chào các bạn, hôm nay mình sẽ kể cho các bạn nghe về mật ong."`,
    `Tệ:    "Bạn có bao giờ tự hỏi tại sao mật ong lại đặc biệt không?"`,
    ``,
    `Câu mở phải tự nó đã là một thông tin. Nếu cắt bỏ mọi thứ trừ câu đầu, người`,
    `xem vẫn học được một điều.`,
    ``,
    ...lengthSection(shape),
    `## Nội dung video này`,
    ``,
    input.brief?.context
      ? [
          `ĐÂY LÀ CHỈ DẪN QUAN TRỌNG NHẤT VỀ NỘI DUNG. Video nói đúng về điều này,`,
          `không được đổi sang chủ đề khác dễ viết hơn:`,
          ``,
          `"${input.brief.context}"`,
          ``,
          `Nếu ảnh có sẵn không khớp hoàn hảo, chọn ảnh gần nhất và cứ viết về chủ`,
          `đề đó. Ảnh minh hoạ cho nội dung, chứ không quyết định nội dung.`,
        ].join('\n')
      : [
          `Người dùng chưa chọn chủ đề, nên bạn tự chọn một sự thật từ những gì các`,
          `bức ảnh gợi ra: một hiện tượng tự nhiên, một chi tiết lịch sử, một thói`,
          `quen của loài vật, nguồn gốc của một đồ vật hằng ngày, một con số về vũ`,
          `trụ hoặc cơ thể người.`,
          ``,
          `Chọn thứ mà một người Việt bình thường CHƯA biết nhưng sẽ thấy hợp lý`,
          `ngay khi nghe giải thích. Đó là cảm giác khiến người ta xem hết và gửi`,
          `cho bạn bè.`,
        ].join('\n'),
    ``,
    `## Câu mở đầu`,
    ``,
    input.brief?.hook
      ? [
          `Cảnh đầu tiên phải mang ý này. Viết lại bằng giọng của video chứ đừng`,
          `chép nguyên, nhưng giữ đúng nghĩa:`,
          ``,
          `"${input.brief.hook}"`,
        ].join('\n')
      : [
          `Tự viết câu mở theo đúng nguyên tắc "hai giây đầu tiên" ở trên: một câu`,
          `ngắn, nói thẳng điều lạ nhất của sự thật này.`,
        ].join('\n'),
    ``,
    ...imageQuerySection(),
    `## Tư liệu tham khảo`,
    ``,
    input.info
      ? [
          '```json',
          JSON.stringify(input.info, null, 2),
          '```',
          ``,
          `File này là danh sách trắng cho mọi thứ kiểm chứng được. Bạn được diễn`,
          `đạt lại nội dung trong đó. Bạn KHÔNG được nêu con số, giá, bảo hành,`,
          `khuyến mãi hay chứng nhận nào không có trong file - có một bước kiểm tra`,
          `máy móc sẽ loại chúng, và nó không đọc được ý định của bạn. Điều gì không`,
          `có trong file thì bỏ hẳn.`,
        ].join('\n')
      : [
          `(Không có info.json - video này không quảng cáo sản phẩm nào.)`,
          ``,
          `Viết từ kiến thức chung, và chỉ viết phần bạn chắc chắn. Xem lại mục "sự`,
          `thật phải là sự thật" ở trên: đó là ràng buộc thật sự ở đây, không phải`,
          `một lời nhắc lịch sự.`,
        ].join('\n'),
    ``,
    `## Giọng văn: một lời giải thích liền mạch`,
    ``,
    `Người đọc là một người đàn ông miền Bắc, giọng rõ, điềm đạm, không lên gân.`,
    ``,
    `**Đây là điều quan trọng nhất về cách viết:** cả video phải nghe như MỘT`,
    `người đang giải thích một chuyện cho bạn nghe, liền một mạch từ đầu đến`,
    `cuối - không phải một chuỗi câu rời rạc đọc nối vào nhau.`,
    ``,
    `Giọng đọc máy nghỉ khá lâu sau mỗi dấu chấm. Viết mười câu ngắn thì được`,
    `mười khoảng lặng, và video nghe như đọc từng gạch đầu dòng. Cách chữa nằm`,
    `hoàn toàn ở chỗ bạn đặt dấu câu:`,
    ``,
    `- **Nối các ý bằng dấu phẩy và từ nối** thay vì cắt thành câu riêng: "nên",`,
    `  "vì", "mà", "rồi", "trong khi", "đến mức". Một câu dài có ba dấu phẩy nghe`,
    `  trôi chảy hơn hẳn ba câu ngắn.`,
    `- **Mỗi đoạn giải thích nên là một hai câu dài**, không phải năm câu ngắn.`,
    ``,
    `  Đừng viết:  "Mật ong không hỏng. Lý do nằm ở nước. Mật ong gần như không`,
    `  có nước. Vi khuẩn thì cần nước."`,
    ``,
    `  Hãy viết:   "Mật ong không hỏng được là vì nó gần như không có nước, mà vi`,
    `  khuẩn thì cần nước mới sống nổi, nên vừa chạm vào là chúng mất nước và`,
    `  chết."`,
    ``,
    `- Câu ngắn vẫn dùng được, nhưng để dành cho chỗ thật sự cần nhấn - câu hook`,
    `  mở đầu, và câu chốt cuối. Ở giữa thì viết liền.`,
    `- Tiếng Việt nói, không phải tiếng Việt viết. Đọc thành tiếng thử: nếu nghe`,
    `  như văn bản hành chính thì viết lại.`,
    `- Xưng hô trung tính: "bạn" cho người xem, và tránh "mình", "tớ", "chúng ta`,
    `  hãy cùng". Không "các bạn ơi", không "anh em".`,
    `- Luôn trả lời "tại sao". Một video fact hay không phải là danh sách thông`,
    `  tin, mà là một chuỗi nhân quả: điều lạ → tại sao lại thế → hệ quả.`,
    `- Cụ thể hơn là trừu tượng: gọi tên đúng thứ đó - màu gì, ở đâu, năm nào,`,
    `  to bằng cái gì.`,
    `- So sánh với thứ người Việt hình dung được: "bằng một sân bóng", "nặng hơn`,
    `  một chiếc xe máy" - đừng để trơ một con số lớn không ai tưởng tượng nổi.`,
    `- Không hô hào, không "hãy like và đăng ký kênh nhé", không "sốc", "kinh`,
    `  hoàng", "bạn sẽ không tin nổi". Sự thật tự nó đủ hấp dẫn; nếu không thì`,
    `  chọn sự thật khác.`,
    `- Không emoji, không hashtag, không markdown trong lời đọc.`,
    ``,
    ...voiceMechanicsSection(),
    ...sceneFieldsSection(shape),
    `## Bố cục video`,
    ``,
    `- Cảnh đầu, type "intro": câu hook. Nói thẳng sự thật lạ.`,
    `- Các cảnh giữa, type "segment": giải thích TẠI SAO điều đó đúng. Đây là phần`,
    `  giữ người xem lại - một sự thật không kèm lời giải thích chỉ là một câu`,
    `  status. Đi theo một mạch: nêu hiện tượng, rồi nguyên nhân, rồi hệ quả hoặc`,
    `  một chi tiết bất ngờ.`,
    `- Cảnh cuối, type "outro": chốt lại bằng một câu đáng nhớ, hoặc một chi tiết`,
    `  nhỏ khiến người xem muốn kể lại cho người khác.`,
    ...(input.channelName
      ? [
          ``,
          `  Rồi mời đăng ký kênh, bằng ĐÚNG tên kênh: **${input.channelName}**.`,
          ``,
          `  Viết câu mời đó cho tự nhiên và gắn vào chính sự thật vừa kể, đừng`,
          `  đọc như đọc quảng cáo. Nhắc tên kênh ĐÚNG MỘT LẦN.`,
          ``,
          `  **Mỗi video phải là một câu khác nhau.** Đây là mấy kiểu để bạn thấy`,
          `  khoảng dao động, KHÔNG phải mẫu để chép:`,
          ``,
          `    "Đăng ký ${input.channelName} đi, tuần nào cũng có chuyện lạ như vậy."`,
          `    "Còn khối thứ kỳ hơn cái này nữa, có ở ${input.channelName} hết."`,
          `    "Thấy lạ thì theo ${input.channelName}, mai kể tiếp chuyện khác."`,
          ``,
          `  Hay nhất là móc thẳng vào sự thật vừa kể - nhắc lại chi tiết lạ nhất`,
          `  rồi mời xem tiếp. Một câu thôi, ngắn, đặt cuối cùng. Không "nhớ like`,
          `  và share", không "bấm chuông thông báo", không liệt kê ba thứ.`,
        ]
      : [`  Không xin like, không xin đăng ký.`]),
    ``,
    ...validValuesSection(input.defaultStyle, input.defaultVoice),
    `## Phần đăng YouTube`,
    ``,
    `Video được đăng dưới dạng YouTube Short, nên viết luôn phần đăng - một object`,
    `"publish" gồm "title", "description" và "tags". Tất cả bằng tiếng Việt.`,
    ``,
    `- **title**: tối đa 100 ký tự, nhưng người xem chỉ thấy khoảng 60 ký tự đầu`,
    `  trên khung Short. Nói thẳng sự thật, đúng giọng của video: "Mật ong không`,
    `  bao giờ hỏng" là được; "SỰ THẬT SỐC VỀ MẬT ONG MÀ 99% KHÔNG BIẾT" thì`,
    `  không. Không viết hoa toàn bộ, không emoji.`,
    `- **description**: hai đến ba câu. Câu đầu nhắc lại sự thật, câu sau thêm một`,
    `  chi tiết không có trong video thì càng tốt. KHÔNG viết danh sách chương và`,
    `  KHÔNG viết dòng ghi nguồn nhạc - hệ thống tự sinh cả hai, kèm thẻ #shorts.`,
    `- **tags**: năm đến mười hai thẻ, chữ thường, là những từ người ta thực sự`,
    `  gõ tìm. Trộn thẻ rộng ("fact", "sự thật thú vị", "khám phá") với thẻ riêng`,
    `  của video này ("mật ong", "ai cập cổ đại").`,
    ``,
    `## Định dạng trả về`,
    ``,
    `Trả về DUY NHẤT một object JSON, không gì khác - không giải thích, không rào`,
    `markdown, không thêm chữ nào trước hay sau.`,
    ``,
    '```json',
    JSON.stringify(
      {
        version: '1.0',
        project: { id: input.projectId, episodeTitle: 'Tên của video này' },
        video: { style: input.defaultStyle },
        voice: { voice: input.defaultVoice },
        content: {
          summary: 'Một hai câu nói video này kể sự thật gì, để ghi chú nội bộ.',
          narration: '',
          imageQueries: ['honey jar', 'beehive bees', 'ancient egypt tomb'],
        },
        publish: {
          title: 'Mật ong không bao giờ hỏng',
          description:
            'Người ta tìm được hũ mật ong ba nghìn năm tuổi trong lăng mộ Ai Cập, ' +
            'và nó vẫn ăn được.\n\n' +
            'Lý do nằm ở chỗ mật ong gần như không có nước - mà vi khuẩn thì cần ' +
            'nước để sống.',
          tags: ['fact', 'sự thật thú vị', 'mật ong', 'khám phá', 'kiến thức'],
        },
        scenes: [
          {
            id: 'scene-01',
            type: 'intro',
            imageQuery: 'honey jar',
            title: 'Mật ong không hỏng',
            narration:
              'Mật ong để ba nghìn năm vẫn ăn được - người ta mở những hũ mật chôn ' +
              'trong lăng mộ Ai Cập ra và thấy nó vẫn còn dùng được bình thường,',
            duration: 5,
            animation: 'zoom-in',
            transition: 'fade',
            effect: 'none',
            overlay: 'dust',
          },
          {
            id: 'scene-02',
            type: 'segment',
            imageQuery: 'beehive bees',
            title: '',
            narration:
              'và lý do nằm ở chỗ mật ong gần như không có nước, mà vi khuẩn thì ' +
              'cần nước mới sống nổi, nên vừa chạm vào là chúng mất nước và chết.',
            duration: 5,
            animation: 'pan-right',
            transition: 'cut',
            effect: 'none',
            overlay: 'none',
          },
        ],
      },
      null,
      2,
    ),
    '```',
    ``,
    `Chú ý hai cảnh mẫu ở trên: câu của cảnh đầu chưa kết thúc, nó chạy tiếp sang`,
    `cảnh sau. Đó chính là kiểu viết cần có.`,
    ``,
    `Để "content.narration" là chuỗi rỗng - hệ thống tự nối lời đọc của các cảnh`,
    `lại. Mỗi "imageQuery" của cảnh phải trùng đúng một chuỗi trong`,
    `"content.imageQueries". Tên tạm hiện tại là "${input.workingTitle}"; hãy thay bằng`,
    `tên thật của video.`,
  ].join('\n');
}
