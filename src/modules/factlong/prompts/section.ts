import { ANIMATIONS, SCENE_EFFECTS, SCENE_OVERLAYS, TRANSITIONS } from '../../../domain/scene';
import { MAX_NARRATION_CHARS } from '../domain/scene';
import { COMMONS_PREFIX, type Fact, type Outline, type SectionPlan } from '../domain/outline';
import { SECONDS_PER_SCENE, WORDS_PER_MINUTE } from '../pacing';

/**
 * One section of the script.
 *
 * Given the plan, the facts it may use, and the two sentences either side of
 * it, this writes a few hundred syllables and the scenes to carry them. It has
 * no tools: everything checkable was settled by the outline call, and a section
 * free to search would find a different number from the one section two used.
 *
 * The neighbouring text is the part that makes ten separate calls sound like
 * one narrator. Without the previous section's last sentence, every section
 * opens by re-introducing the subject - "Trận lũ ở Nepal..." ten times over -
 * because each call is, from its own point of view, starting a video.
 */

export interface SectionPromptInput {
  outline: Outline;
  section: SectionPlan;
  index: number;
  /** Scene ids start here, so the assembled video numbers straight through. */
  firstSceneNumber: number;
  /** The last sentence already written, or empty for the first section. */
  previousTail: string;
  /** What the next section will cover, so this one can hand over. */
  nextHeading: string;
  channelName: string;
}

function factLines(facts: readonly Fact[], ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  const chosen = facts.filter((f) => wanted.has(f.id));
  if (chosen.length === 0) return ['  (Phần này không được giao dữ kiện riêng nào.)'];

  return chosen.map(
    (f) => `  [${f.id}] ${f.claim}${f.asOf ? `  (số liệu tính đến ${f.asOf})` : ''}`,
  );
}

export function buildSectionPrompt(input: SectionPromptInput): string {
  const { outline, section } = input;
  const sceneCount = Math.max(
    2,
    Math.round(section.wordBudget / ((SECONDS_PER_SCENE / 60) * WORDS_PER_MINUTE)),
  );
  const wordsPerScene = Math.round(section.wordBudget / sceneCount);
  const isFirst = input.index === 0;
  const isLast = input.nextHeading === '';

  return [
    `Bạn đang viết MỘT PHẦN của kịch bản một video tiếng Việt dài, khung ngang,`,
    `giọng nam miền Bắc đọc trên nền ảnh chụp.`,
    ``,
    `Video tên: "${outline.episodeTitle}"`,
    `Nội dung chung: ${outline.summary}`,
    ``,
    `## Phần bạn viết`,
    ``,
    `Phần ${input.index + 1}: **${section.heading}**`,
    ``,
    `${section.angle}`,
    ``,
    `Độ dài: **khoảng ${section.wordBudget} từ**, chia thành khoảng ${sceneCount} cảnh, mỗi cảnh`,
    `khoảng ${wordsPerScene} từ. Đây là khung cứng - viết quá ngắn hay quá dài đều bị trả lại,`,
    `và một phần viết dài sẽ lấn mất chỗ của phần sau chứ không làm video hay hơn.`,
    ``,
    `## Dữ kiện được dùng`,
    ``,
    `Đây là toàn bộ những gì đã được tra cứu và kiểm chứng cho phần này:`,
    ``,
    ...factLines(outline.facts, section.factIds),
    ``,
    `**Quy tắc quan trọng nhất: không thêm dữ kiện nào ngoài danh sách trên.**`,
    ``,
    `Bạn KHÔNG được thêm con số, ngày tháng, tên riêng, tên tổ chức hay tên nghiên`,
    `cứu nào khác - kể cả khi bạn tin là mình biết. Sự việc này có thể mới hơn`,
    `kiến thức sẵn có của bạn, và một con số bạn nhớ được gần như chắc chắn là của`,
    `một sự việc khác. Bước tra cứu đã xong rồi; việc của bạn bây giờ là VIẾT.`,
    ``,
    `Bạn được phép, và nên: diễn đạt lại cho dễ nghe, sắp xếp lại thứ tự, giải`,
    `thích cơ chế bằng lời của mình, và so sánh với thứ người Việt hình dung được`,
    `("cao bằng toà nhà bốn mươi tầng", "dài bằng quãng Hà Nội đi Ninh Bình").`,
    `Những so sánh đó là cách diễn đạt, không phải dữ kiện mới - miễn là phép`,
    `tính đúng.`,
    ``,
    `Nếu số từ được giao nhiều hơn số dữ kiện có thể lấp đầy, hãy giải thích SÂU`,
    `hơn: cơ chế hoạt động ra sao, vì sao lại thế, điều đó có nghĩa gì với người`,
    `đang sống ở đó. Đừng lấp bằng cách nhắc lại.`,
    ``,
    isFirst
      ? [
          `## Đây là phần mở đầu video`,
          ``,
          `Câu đầu tiên phải nói ngay chuyện gì đã xảy ra, ở đâu, khi nào. Không`,
          `chào hỏi, không "hôm nay chúng ta sẽ tìm hiểu", không hỏi tu từ.`,
          ``,
          `Sức nặng đến từ sự chính xác, không từ tính từ. Một câu nêu đúng`,
          `con số đã đủ nặng - không cần "kinh hoàng", "gây sốc", "bạn sẽ không`,
          `tin nổi".`,
        ].join('\n')
      : [
          `## Nối vào phần trước`,
          ``,
          `Phần trước vừa kết thúc bằng:`,
          ``,
          `  "...${input.previousTail}"`,
          ``,
          `Viết tiếp mạch đó. **Đừng giới thiệu lại sự việc** - người xem đã nghe`,
          `${input.index} phần rồi. Vào thẳng nội dung của phần này.`,
        ].join('\n'),
    ``,
    isLast
      ? [
          `## Đây là phần kết`,
          ``,
          `Chốt lại bằng điều đáng nhớ nhất, hoặc điều còn bỏ ngỏ. Không tóm tắt`,
          `lại cả video.`,
          ...(input.channelName
            ? [
                ``,
                `Rồi mời theo dõi kênh, bằng đúng tên **${input.channelName}**, một câu ngắn,`,
                `tự nhiên, gắn vào chính chuyện vừa kể. Không "nhớ like và share",`,
                `không "bấm chuông thông báo".`,
              ]
            : []),
        ].join('\n')
      : [
          `## Chuyển sang phần sau`,
          ``,
          `Phần tiếp theo sẽ nói về: **${input.nextHeading}**`,
          ``,
          `Câu cuối của bạn nên dẫn sang đó một cách tự nhiên, nhưng đừng nói`,
          `trước nội dung của nó.`,
        ].join('\n'),
    ``,
    `## Giọng văn`,
    ``,
    `Người đọc là một người đàn ông miền Bắc, giọng rõ, điềm đạm, không lên gân.`,
    ``,
    `### Hài hước, nhưng bằng sự thật`,
    ``,
    `Kênh này vui, và cái vui đến từ chi tiết có thật kể đúng chỗ - không phải từ`,
    `câu đùa chêm vào. Ba cách dùng được:`,
    ``,
    `- **Con số vô lý, để nguyên, không bình luận.** "Hợp đồng ghi rõ ông ta được`,
    `  trả tiền để đi bộ quanh hồ, mỗi ngày một vòng, trong hai mươi năm."`,
    `- **Đặt cạnh nhau hai thứ chênh nhau.** Khoảng cách giữa chúng tự nó buồn`,
    `  cười, không cần chỉ ra.`,
    `- **Nói tỉnh bơ.** Kể chuyện lố bịch bằng giọng bình thường ăn hơn hẳn kể nó`,
    `  bằng giọng đang cố làm người ta cười.`,
    ``,
    `**Đừng giải thích câu đùa.** Nói xong thì đi tiếp. Không "haha", không "cười`,
    `ỉa", không emoji, không chọc cười bằng cách hạ thấp ai đó.`,
    ``,
    `Không phải phần nào cũng cần cười. Nếu phần này là giải thích cơ chế thì`,
    `giải thích cho hay - đó cũng là thứ giữ chân người xem.`,
    ``,
    `Bỏ hẳn phần hài khi chuyện còn làm ai đó đau: thảm hoạ gần đây, nạn nhân`,
    `hoặc người thân còn sống. Chuyện đã xa hai trăm năm thì vẫn hóm hỉnh được -`,
    `nhưng cười cái tình huống, đừng bao giờ cười người đã chết.`,
    ``,
    `### Chi tiết, không chung chung`,
    ``,
    `Đây là chỗ video dài khác video ngắn. Mỗi khi định viết một câu chung chung,`,
    `hãy tìm trong danh sách dữ kiện xem có con số hay cái tên nào thay được`,
    `không.`,
    ``,
    `  Chung chung:  "thời đó người ta dùng thứ này rất nhiều"`,
    `  Cụ thể:       "riêng năm một chín hai ba, thành phố Chicago tiêu thụ hết`,
    `                bốn nghìn tấn"`,
    ``,
    `Và luôn đi tới **vì sao**. "Nó xảy ra" là một câu; "nó xảy ra vì" là một`,
    `đoạn người ta xem hết.`,
    ``,
    `- **Nối ý bằng dấu phẩy và từ nối** ("nên", "vì", "mà", "rồi", "trong khi")`,
    `  thay vì cắt thành nhiều câu ngắn. Giọng máy nghỉ khá lâu sau mỗi dấu chấm,`,
    `  nên mười câu ngắn thành mười khoảng lặng và video nghe như đọc gạch đầu`,
    `  dòng.`,
    `- Tiếng Việt nói, không phải tiếng Việt viết. Đọc to lên thử.`,
    `- Xưng hô trung tính: "bạn" cho người xem. Không "các bạn ơi", không "mình".`,
    `- Viết số bằng chữ khi nó được đọc lên: "một nghìn hai trăm" chứ không`,
    `  "1.200"; "phần trăm" chứ không "%"; "độ C" chứ không "°C".`,
    `- Tên riêng nước ngoài: viết dạng người Việt hay đọc, hoặc kèm cách đọc.`,
    `- Chỉ tiếng Việt. Không chèn câu tiếng Anh nào vào lời đọc.`,
    `- KHÔNG viết chỉ dẫn sân khấu, không VIẾT HOA để nhấn, không thẻ SSML,`,
    `  không emoji, không markdown - tất cả sẽ bị đọc thành tiếng.`,
    ``,
    `## Từng cảnh`,
    ``,
    `Một cảnh là một ảnh nền cộng một đoạn lời đọc. Lời đọc là MỘT mạch văn duy`,
    `nhất và các cảnh chỉ là chỗ bạn cắt nó ra để đổi hình - cảnh không cần kết`,
    `thúc trọn một câu.`,
    ``,
    `1. "id" - đánh số liên tục bắt đầu từ "scene-${String(input.firstSceneNumber).padStart(3, '0')}".`,
    `2. "type" - ${isFirst ? '"intro" cho cảnh đầu tiên, còn lại "segment".' : isLast ? '"segment", trừ cảnh cuối cùng của cả video là "outro".' : 'tất cả là "segment".'}`,
    `3. "narration" - khoảng ${wordsPerScene} từ, tối đa ${MAX_NARRATION_CHARS} ký tự.`,
    `4. "imageQuery" - chọn MỘT trong những truy vấn đã khai ở dàn ý.`,
    ``,
    `   Ảnh minh hoạ (một loại nơi chốn, không phải chính sự việc):`,
    ...outline.imageQueries.map((q) => `     "${q}"`),
    ...(outline.eventImageQueries.length
      ? [
          ``,
          `   **Ảnh chụp CHÍNH thứ đang được kể:**`,
          ...outline.eventImageQueries.map((q) => `     "${COMMONS_PREFIX}${q}"`),
          ``,
          `   Dùng nhóm thứ hai mỗi khi cảnh nói về **đúng cái đó** - đúng con`,
          `   vật ấy, đúng toà nhà ấy, đúng người ấy, đúng nơi ấy. Ảnh đúng cái`,
          `   đang kể luôn thắng ảnh đúng loại.`,
          ``,
          `   Dùng nhóm thứ nhất cho những đoạn nói chuyện chung: cơ chế hoạt`,
          `   động, bối cảnh, so sánh với thứ khác.`,
          ``,
          `   Nếu một category là của sự kiện KHÁC (một trận lũ năm khác, một vụ`,
          `   việc khác), chỉ dùng nó cho cảnh đang nói về chính sự kiện đó. Đặt`,
          `   ảnh sự kiện cũ lên cảnh kể chuyện mới là đưa ảnh cũ ra làm tin mới.`,
          ``,
          `   Số ảnh của nhóm thứ hai rất ít - thường chỉ dăm bảy tấm cho cả`,
          `   video - nên đừng gán nó cho mọi cảnh, hệ thống sẽ phải phát lại cùng`,
          `   một tấm. Chỉ những cảnh thật sự cần.`,
        ]
      : []),
    ``,
    `   **Chọn theo ĐÚNG CÂU cảnh này đang nói, không theo phần.** Cảnh nói về`,
    `   con ong thì lấy truy vấn về ong, dù cả phần đang nói về mật. Có một bước`,
    `   sau sẽ nhìn ảnh thật và đặt lại cho khớp, nhưng nó chỉ được chọn trong`,
    `   nhóm ảnh của truy vấn bạn khai - khai sai thì nó không cứu được.`,
    ``,
    `   Đổi truy vấn giữa các cảnh - cả phần dùng chung một truy vấn thì cả phần`,
    `   trông như một tấm ảnh.`,
    `5. "title" - vài chữ hiện trên màn hình, tối đa 70 ký tự. Đặt title ở cảnh`,
    `   ĐẦU TIÊN của phần này (dùng đúng tên phần: "${section.heading}"), rồi để`,
    `   CHUỖI RỖNG cho tất cả các cảnh còn lại. Phụ đề đã chạy sẵn dưới màn hình.`,
    `6. "animation" - ${ANIMATIONS.join(' | ')}`,
    `   Đổi kiểu giữa các cảnh; một kiểu cho cả phần là cách nhanh nhất làm video`,
    `   trông rẻ.`,
    `7. "transition" - ${TRANSITIONS.join(' | ')}. "cut" là mặc định, "fade" cho`,
    `   cảnh đầu phần và chỗ chuyển ý lớn.`,
    `8. "effect" - ${SCENE_EFFECTS.join(' | ')}. Phần lớn để "none".`,
    `9. "overlay" - ${SCENE_OVERLAYS.join(' | ')}. Đặt thưa tay: nếu cảnh nào cũng`,
    `   có thứ gì đó chuyển động thì không cảnh nào nổi bật.`,
    `10. "duration" - ước lượng bằng giây, chỉ để tham khảo.`,
    ``,
    `## Định dạng trả về`,
    ``,
    `DUY NHẤT một object JSON, không gì khác:`,
    ``,
    '```json',
    JSON.stringify(
      {
        scenes: [
          {
            id: `scene-${String(input.firstSceneNumber).padStart(3, '0')}`,
            type: isFirst ? 'intro' : 'segment',
            imageQuery: outline.imageQueries[0] ?? 'mountain river valley',
            title: section.heading,
            narration: 'Câu mở của phần này, viết liền mạch,',
            duration: SECONDS_PER_SCENE,
            animation: 'zoom-in',
            transition: 'fade',
            effect: 'none',
            overlay: 'none',
          },
          {
            id: `scene-${String(input.firstSceneNumber + 1).padStart(3, '0')}`,
            type: 'segment',
            imageQuery: outline.imageQueries[1] ?? 'himalaya mountains',
            title: '',
            narration: 'và câu tiếp theo chạy tiếp từ đó, không bắt đầu lại.',
            duration: SECONDS_PER_SCENE,
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
  ].join('\n');
}
