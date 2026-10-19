/**
 * The prompt for finding real photographs, one scene at a time.
 *
 * The storyboard's own image queries are written before anybody knows what
 * exists, in the vocabulary of a stock library - "water pump station", "storm
 * drain grate" - and a stock library answers them with a pump station in
 * England. What a reportage needs is the other kind of picture: the pumping
 * station the sentence is about, the street it happened on, the flood of the
 * year it is being compared with. Those exist, sometimes, on Wikimedia Commons,
 * filed under names nobody can guess - "Yen So Park" as a Commons search
 * returns a category about Al Gore - so this call is given the web and told to
 * look, and to open what it finds before naming it.
 */

export interface ResearchScene {
  id: string;
  narration: string;
  /** The storyboard's own stock query, as a hint to what the scene shows. */
  imageQuery: string;
  /** The heading of the section this scene belongs to. */
  section: string;
}

export function buildImageResearchPrompt(input: {
  episodeTitle: string;
  summary: string;
  scenes: readonly ResearchScene[];
  /** Commons categories the storyboard already names, reusable where they fit. */
  knownCategories: readonly string[];
  /** Articles whose photographs the system already has, with permission. */
  pressSources: readonly string[];
  /** How many sources one scene may be given. */
  maxPerScene: number;
  /**
   * `places`: real photographs of what each scene names, or the same kind of
   * thing in the same place. `other-events`: the video's own event is already
   * covered by permitted photographs and nothing else may be shown, so look
   * only for scenes that name a *different* event, and that event's pictures.
   */
  mode: 'places' | 'other-events';
}): string {
  if (input.mode === 'other-events') return otherEventsPrompt(input);
  return [
    `Bạn đi tìm ẢNH THẬT cho từng cảnh của một video phóng sự tiếng Việt.`,
    ``,
    `## Video`,
    ``,
    `Tiêu đề: ${input.episodeTitle}`,
    `Tóm tắt: ${input.summary}`,
    ``,
    `## Ảnh thật là gì`,
    ``,
    `Ảnh chụp ĐÚNG nơi, ĐÚNG vật, ĐÚNG sự việc mà câu nói nhắc tới: đúng con phố, đúng`,
    `ngôi trường, đúng trạm bơm, đúng cây cầu, đúng trận lụt của năm được nhắc đến. Nếu`,
    `không có, thì ảnh cùng loại chụp ở CHÍNH nơi đó (cùng thành phố, cùng tỉnh, cùng nước).`,
    `Không phải ảnh minh hoạ chung chung chụp ở đâu cũng được - một trạm bơm ở Anh, một`,
    `cánh đồng ở Mỹ. Hệ thống đã có kho ảnh chung; thứ nó thiếu, và thứ bạn được nhờ tìm, là`,
    `ảnh thật của nơi đang được kể.`,
    ``,
    `## Tìm ở đâu`,
    ``,
    `Chỉ **Wikimedia Commons** (commons.wikimedia.org) - ảnh ở đó có giấy phép mở, được`,
    `phép dùng trên YouTube. Không trả về ảnh từ báo, mạng xã hội hay trang nào khác.`,
    ...(input.pressSources.length > 0
      ? [
          ``,
          `Ảnh trong các bài báo sau hệ thống ĐÃ CÓ SẴN (đã được toà soạn cho phép), đừng tìm lại:`,
          ...input.pressSources.map((url) => `- ${url}`),
        ]
      : []),
    ``,
    `## Cách tìm - hãy thật cẩn thận`,
    ``,
    `1. Với từng cảnh, xác định cái CỤ THỂ câu nói nhắc tới: một địa danh, một công trình,`,
    `   một tổ chức, một sự kiện có ngày tháng. Nếu câu nói chỉ là nhận xét chung, không`,
    `   có nơi hay vật cụ thể nào, bỏ qua cảnh đó.`,
    `2. Tìm trên Commons bằng WebSearch, ví dụ \`"Yên Sở" pumping station site:commons.wikimedia.org\`.`,
    `   Tên trên Commons thường là tiếng Anh hoặc tiếng Việt có dấu: \`Category:Đông Ngạc\`,`,
    `   \`Category:2008 Hanoi floods\`. Có thể mở thẳng bằng WebFetch:`,
    `   \`https://commons.wikimedia.org/wiki/Category:Tên_category\`, hoặc tra danh sách category:`,
    `   \`https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=14&format=json&srsearch=từ+khoá\`.`,
    `3. **Mở trang category hoặc file bằng WebFetch trước khi ghi tên nó.** Kiểm tra: trang có`,
    `   thật, có ảnh chụp (không chỉ bản đồ, logo, sơ đồ, tài liệu scan), và ảnh chụp đúng`,
    `   cái câu nói nhắc tới - đúng nơi, và nếu câu nói về một thời điểm thì đúng thời điểm.`,
    `4. Một category rộng (\`Category:Hanoi\`) chứa đủ thứ, không phải ảnh của cảnh này. Hãy`,
    `   xuống category con đúng nhất, hoặc chỉ ra từng file cụ thể (\`File:...\`).`,
    `5. **Không có ảnh của đúng cái đó thì tìm ảnh CÙNG LOẠI, Ở CÙNG NƠI.** Không có ảnh trạm`,
    `   bơm được nhắc tới thì một trạm bơm ở Hà Nội; không có ảnh con phố ấy ngập thì ảnh phố`,
    `   Hà Nội ngập; câu nói về cống thoát nước Hà Nội thì nắp cống, rãnh nước ở Hà Nội hay Việt`,
    `   Nam (ví dụ category kiểu \`Manhole covers in Vietnam\`, \`Rain in Hanoi\`, \`Floods in`,
    `   Vietnam\`, \`Motorcycles in Hanoi\`). Vẫn là ảnh thật của nơi đó, và tốt hơn nhiều so`,
    `   với ảnh cùng loại chụp ở nước khác. Tỉnh nào được nhắc tới thì tìm ảnh của tỉnh đó.`,
    `   **Nhưng không đổi thời điểm:** ảnh của một sự kiện KHÁC ở cùng nơi (trận lụt năm 2008,`,
    `   một vụ tai nạn khác) không phải "ảnh cùng loại" cho sự việc đang kể - người xem sẽ tưởng`,
    `   đó là ảnh của lần này. Chỉ đưa ảnh sự kiện khác cho câu nói về CHÍNH sự kiện đó (ví dụ`,
    `   câu so sánh với trận lụt 2008). Ảnh cùng loại phải là ảnh không gắn với một sự kiện`,
    `   nào: nắp cống, con phố ngày thường, trạm bơm, hồ nước.`,
    `6. Thử nhiều cách gọi: tiếng Việt có dấu, không dấu, tiếng Anh. Dành thời gian cho việc`,
    `   này - cả video phụ thuộc vào nó.`,
    `7. Nhiều cảnh liền nhau nói về cùng một nơi thì có thể dùng chung nguồn.`,
    ...(input.knownCategories.length > 0
      ? [
          ``,
          `Kịch bản đã có sẵn các category này, dùng lại được nếu đúng với cảnh:`,
          ...input.knownCategories.map((name) => `- ${name}`),
        ]
      : []),
    ``,
    `**Không đoán tên.** Một tên category không tồn tại chỉ làm phí thời gian của hệ thống;`,
    `một category có thật nhưng sai chỗ còn tệ hơn, vì ảnh của nó sẽ lên màn hình. Không`,
    `tìm được ảnh thật cho một cảnh thì để mảng rỗng - đó là câu trả lời đúng.`,
    ``,
    `## Các cảnh`,
    ``,
    ...input.scenes.flatMap((scene) => [
      `[${scene.id}]${scene.section ? ` (đoạn: ${scene.section})` : ''}`,
      `  ${scene.narration}`,
      `  (từ khoá ảnh kho của kịch bản: "${scene.imageQuery}")`,
    ]),
    ``,
    `## Trả về`,
    ``,
    `Một object JSON duy nhất, khoá là id cảnh, giá trị là tối đa ${input.maxPerScene} tên trang`,
    `Commons (\`Category:...\` hoặc \`File:...\`), đúng như trên Commons. Không giải thích, không`,
    `rào markdown:`,
    ``,
    '```json',
    JSON.stringify(
      Object.fromEntries(
        input.scenes
          .slice(0, 2)
          .map((scene, i) => [scene.id, i === 0 ? ['Category:Tên category đã mở và kiểm tra'] : []]),
      ),
      null,
      2,
    ),
    '```',
  ].join('\n');
}

/**
 * The narrow version, for a video that may show only the events it talks about.
 *
 * Its own event is covered by the paper's photographs, and the owner's rule is
 * that every picture is of the event its scene is about - so a Hà Nội manhole
 * for a sentence about the drains is out, and the only thing left worth
 * looking for is the other events the script names: the 2008 flood it compares
 * this one with, an earlier accident on the same street. Those scenes need
 * their own event's photographs, and everything else is left empty on purpose.
 */
function otherEventsPrompt(input: Parameters<typeof buildImageResearchPrompt>[0]): string {
  return [
    `Bạn đi tìm ảnh cho một video phóng sự tiếng Việt, với một quy tắc tuyệt đối: ảnh của`,
    `mỗi cảnh phải là ảnh của ĐÚNG sự kiện mà cảnh đó đang nói tới.`,
    ``,
    `## Video`,
    ``,
    `Tiêu đề: ${input.episodeTitle}`,
    `Tóm tắt: ${input.summary}`,
    ``,
    `## Việc của bạn`,
    ``,
    `Ảnh của sự kiện chính hệ thống ĐÃ CÓ - ảnh báo chí được toà soạn cho phép:`,
    ...input.pressSources.map((url) => `- ${url}`),
    ``,
    `Việc còn lại là những cảnh nhắc tới MỘT SỰ KIỆN KHÁC có thật: một trận lụt năm khác,`,
    `một vụ việc trước đây, một thảm hoạ ở nơi khác được đem ra so sánh. Với mỗi cảnh như`,
    `vậy, tìm trên **Wikimedia Commons** ảnh chụp ĐÚNG sự kiện ấy (đúng nơi, đúng năm).`,
    ``,
    `Những cảnh chỉ kể về sự kiện chính, hoặc chỉ nói chung chung (nguyên nhân, số liệu,`,
    `bình luận), để mảng rỗng - hệ thống sẽ dùng ảnh báo của sự kiện chính cho chúng. KHÔNG`,
    `tìm ảnh nơi chốn, ảnh "cùng loại", ảnh minh hoạ: quy tắc của video này không cho dùng.`,
    ``,
    `## Cách tìm`,
    ``,
    `1. Dùng WebSearch, ví dụ \`2008 Hanoi flood site:commons.wikimedia.org\`. Tên category`,
    `   trên Commons thường là tiếng Anh hoặc tiếng Việt có dấu, ví dụ \`Category:2008 Hanoi floods\`.`,
    `2. **Mở trang bằng WebFetch trước khi ghi tên nó**, và kiểm tra ảnh đúng là của sự kiện`,
    `   ấy - đúng năm, đúng nơi.`,
    `3. Không đoán tên. Không tìm được thì để mảng rỗng.`,
    ...(input.knownCategories.length > 0
      ? [
          ``,
          `Kịch bản đã có sẵn các category này, dùng lại được nếu đúng sự kiện của cảnh:`,
          ...input.knownCategories.map((name) => `- ${name}`),
        ]
      : []),
    ``,
    `## Các cảnh`,
    ``,
    ...input.scenes.flatMap((scene) => [
      `[${scene.id}]${scene.section ? ` (đoạn: ${scene.section})` : ''}`,
      `  ${scene.narration}`,
    ]),
    ``,
    `## Trả về`,
    ``,
    `Một object JSON duy nhất, khoá là id cảnh, giá trị là tối đa ${input.maxPerScene} tên trang`,
    `Commons (\`Category:...\` hoặc \`File:...\`). Cảnh không nhắc sự kiện khác: mảng rỗng.`,
    `Không giải thích, không rào markdown.`,
  ].join('\n');
}
