import type { ProductInfo } from '../../../domain/project';
import type { Brief } from '../domain/brief';
import {
  ANIMATIONS,
  SCENE_EFFECTS,
  SCENE_OVERLAYS,
  SCENE_TYPES,
  TRANSITIONS,
} from '../../../domain/scene';
import { MAX_IMAGE_QUERY_CHARS, MAX_NARRATION_CHARS } from '../domain/scene';
import { MAX_IMAGE_QUERIES, MAX_SCENES, MIN_IMAGE_QUERIES } from '../domain/storyboard';
import { STYLES } from '../../../domain/config';
import { WORDS_PER_MINUTE } from '../pacing';
import { VIETNAMESE_VOICES } from '../../../tts/types';

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

export interface PromptInput {
  projectId: string;
  /** Falls back to the project id when nothing better is known yet. */
  workingTitle: string;
  info: ProductInfo | null;
  targetDurationSec: number;
  defaultStyle: string;
  defaultVoice: string;
  /** Channel name for the closing call to subscribe. Empty means no call. */
  channelName: string;
  /** Optional user-supplied direction (the UI's topic/opening boxes). */
  brief?: Brief | null;
}

/** Words the script needs to run its intended length. See WORDS_PER_MINUTE. */
export function targetWordsFor(targetDurationSec: number): number {
  return Math.round((targetDurationSec / 60) * WORDS_PER_MINUTE);
}

/**
 * How long one scene holds, in seconds, before the picture wants to change.
 *
 * Five seconds. Long enough that the eye finishes with the photograph, short
 * enough that the video never stops moving - and it lines up with the writing,
 * because five seconds of this voice is about one full Vietnamese sentence.
 */
const SECONDS_PER_SCENE = 5;

export function buildStoryboardPrompt(input: PromptInput): string {
  const targetWords = targetWordsFor(input.targetDurationSec);
  const seconds = Math.round(input.targetDurationSec);
  const sceneCount = Math.min(
    MAX_SCENES,
    Math.max(4, Math.round(input.targetDurationSec / SECONDS_PER_SCENE)),
  );
  const wordsPerScene = Math.round(targetWords / sceneCount);

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
    `## Độ dài`,
    ``,
    `Video này dài khoảng ${seconds} giây, tức là **khoảng ${targetWords} từ** lời đọc, tính cả`,
    `phần chào cuối. Chia thành ${sceneCount} cảnh, mỗi cảnh khoảng ${wordsPerScene} từ.`,
    ``,
    `Đây là khung cứng, không phải gợi ý. Viết quá dài thì video vượt 60 giây và`,
    `YouTube không còn coi nó là Short nữa - nghĩa là gần như không ai được đề`,
    `xuất xem. Viết quá ngắn thì hết chỗ cho phần giải thích và video thành một`,
    `câu nói trống rỗng. Bản nháp lệch quá khung sẽ bị trả về kèm số từ đo được.`,
    ``,
    `Cách giữ đúng độ dài là cắt chứ không phải nói nhanh: bỏ câu dẫn, bỏ tính từ`,
    `thừa, bỏ mọi câu không thêm thông tin mới.`,
    ``,
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
    `## Ảnh nền`,
    ``,
    `Bạn KHÔNG chọn từ một thư viện ảnh có sẵn. Hệ thống sẽ tự đi tìm ảnh trên`,
    `kho ảnh miễn phí, dựa đúng vào những từ khoá bạn viết ra ở đây.`,
    ``,
    `Vì vậy hãy khai báo ${MIN_IMAGE_QUERIES}-${MAX_IMAGE_QUERIES} truy vấn ảnh trong "content.imageQueries", rồi mỗi cảnh`,
    `chọn một trong số đó qua trường "imageQuery".`,
    ``,
    `### Cách viết một truy vấn ảnh tìm ra ảnh`,
    ``,
    `- **Bằng tiếng Anh, không dấu.** Mọi kho ảnh mở đều đánh chỉ mục bằng tiếng`,
    `  Anh; truy vấn tiếng Việt trả về gần như không có gì.`,
    `- **Hai đến bốn từ**, tối đa ${MAX_IMAGE_QUERY_CHARS} ký tự. "deep sea jellyfish" tìm được hàng`,
    `  trăm ảnh; "a jellyfish reverting to its polyp stage" không tìm được ảnh nào.`,
    `- **Tả thứ NHÌN THẤY ĐƯỢC**, không phải khái niệm. Kho ảnh đánh chỉ mục theo`,
    `  vật thể trong ảnh. "immortality" không ra ảnh nào dùng được; "jellyfish`,
    `  underwater" thì có.`,
    `- **Tránh tên khoa học, tên riêng hiếm, năm tháng.** "Turritopsis dohrnii"`,
    `  hầu như không có ảnh; "jellyfish" thì vô số.`,
    `- **Tránh những từ thu hẹp góc máy**: "closeup", "macro", "detail of",`,
    `  "cross section". Kho ảnh mở gần như không có ảnh chụp cận đặc tả. Truy vấn`,
    `  "hippo skin closeup" trả về 0 kết quả, còn "hippopotamus in water" trả về`,
    `  hàng chục.`,
    `- **Đừng tìm bộ phận cơ thể.** "rodent teeth", "shark jaw", "bird wing" chỉ`,
    `  ra ảnh tiêu bản, xương và sọ trong bảo tàng - đúng nghĩa đen nhưng nhìn`,
    `  như bài giảng giải phẫu chứ không như video. Hãy tìm **con vật nguyên con**`,
    `  ("mouse rodent animal") và để lời đọc lo phần chi tiết.`,
    `- **Chọn thứ nhiều người chụp.** Con vật quen, phong cảnh quen, đồ vật quen.`,
    `  Nếu bạn không tin có nhiếp ảnh gia nào từng chụp cảnh đó, thì không có ảnh`,
    `  đâu — hãy lùi về một cấp khái quát hơn.`,
    `- **Coi chừng từ tiếng Anh đa nghĩa.** Kho ảnh đầy ảnh thương mại, nên nghĩa`,
    `  đời thường thường lấn át nghĩa tự nhiên. "white mouse" trả về chuột máy`,
    `  tính màu trắng trên bàn làm việc, không phải con chuột bạch. Cách chữa là`,
    `  thêm một từ ghim nghĩa: "mouse rodent", "mouse animal", "crane bird" (chứ`,
    `  không phải cần cẩu), "seal animal", "bat flying animal", "turkey bird".`,
    `  Trước khi viết mỗi truy vấn, tự hỏi: từ này còn nghĩa nào phổ biến hơn`,
    `  không?`,
    `- **Một danh từ chỉ chủ thể, cộng nhiều nhất một từ ghim nghĩa.** Đây là quy`,
    `  tắc quan trọng nhất, vì số kết quả rơi rất nhanh theo từng từ thêm vào:`,
    ``,
    `    "hamster"              → 16 ảnh`,
    `    "guinea pig"           → 18 ảnh`,
    `    "mouse rodent"         → 6 ảnh`,
    `    "rat gnawing wood"     → 0 ảnh`,
    `    "pet rodent cage"      → 0 ảnh`,
    `    "hippo riverbank africa" → 0 ảnh`,
    ``,
    `  Ba truy vấn ngắn mà mỗi cái ra chục ảnh thì tốt hơn hẳn ba truy vấn "đúng ý"`,
    `  mà cái nào cũng rỗng - vì khi rỗng, cảnh đó phải đi mượn ảnh của chủ đề`,
    `  khác, và đó chính là lúc video có ảnh chẳng liên quan gì.`,
    ``,
    `  Đừng mô tả HÀNH ĐỘNG ("gnawing", "running", "sleeping") hay BỐI CẢNH`,
    `  ("cage", "riverbank", "at night") - kho ảnh không đánh chỉ mục theo những`,
    `  thứ đó. Chỉ nêu **con gì / cái gì**.`,
    `- Nếu sự thật nói về thứ không thể chụp được (một khái niệm, một con số, một`,
    `  sự kiện quá khứ), hãy chọn ảnh **gợi không khí**: bối cảnh, chất liệu, nơi`,
    `  chốn liên quan. Ví dụ fact về giấc ngủ thì "bedroom at night", "city`,
    `  lights window".`,
    ``,
    `### Chia chủ đề hình thế nào`,
    ``,
    `Mỗi truy vấn là một MẢNG HÌNH của video, không phải một cảnh. Ví dụ video về`,
    `mật ong: "honey jar", "beehive bees", "ancient egypt tomb". Rồi cảnh nào nói`,
    `về ong thì dùng "beehive bees", cảnh nói về lăng mộ thì dùng "ancient egypt`,
    `tomb".`,
    ``,
    `**Nhưng mọi truy vấn đều phải dính tới chủ thể chính của video.** Đừng dùng`,
    `một truy vấn chỉ để lấy không khí. Video về hà mã mà khai "african savanna`,
    `sunset" thì hệ thống sẽ tìm ra ảnh hoàng hôn có con linh dương — đúng truy`,
    `vấn, sai video. Thà khai ba truy vấn đều có chữ "hippo" trong đó, mỗi cái một`,
    `góc khác nhau, còn hơn một truy vấn phong cảnh chung chung.`,
    ``,
    `Nhiều cảnh dùng chung một truy vấn là bình thường và không sao: hệ thống lấy`,
    `về hơn chục ảnh cho mỗi truy vấn và phát cho mỗi cảnh một ảnh khác nhau. Việc`,
    `của bạn chỉ là chia đúng mảng nội dung.`,
    ``,
    `Ngược lại, một truy vấn quá hẹp là thứ gây hại thật: nếu nó không tìm ra ảnh`,
    `nào, những cảnh dùng nó sẽ phải mượn ảnh của truy vấn khác. Thà khai bốn truy`,
    `vấn rộng và chắc chắn có ảnh, còn hơn một truy vấn đúng ý mà rỗng.`,
    ``,
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
    `### Viết cho một giọng máy phải đọc nó`,
    ``,
    `Lời đọc được tổng hợp bằng máy, và máy chỉ có đúng một nguồn biểu cảm: dấu`,
    `câu của bạn. Nó không hiểu câu nói gì. Mọi chỗ ngắt, mọi chỗ nhấn, là do bạn`,
    `đặt vào.`,
    ``,
    `- **Dấu chấm là một khoảng lặng dài** - đó chính là thứ làm video nghe rời`,
    `  rạc khi bạn dùng quá nhiều. Dấu phẩy chỉ là một nhịp lấy hơi rất ngắn, nên`,
    `  nó là dấu bạn nên dùng nhiều nhất.`,
    `- Dấu gạch ngang mua được một nhịp nghỉ vừa, ngắn hơn dấu chấm: "và nó vẫn`,
    `  ăn được - sau ba nghìn năm."`,
    `- Dấu chấm hỏi làm câu nhấc lên. Dùng thưa thôi, nhưng dùng.`,
    `- Một câu chỉ có một từ thì rất đắt, nhưng đắt vì hiếm: nhiều nhất một lần`,
    `  trong cả video.`,
    `- KHÔNG viết chỉ dẫn sân khấu, không VIẾT HOA để nhấn, không thẻ SSML. Tất cả`,
    `  đều sẽ bị đọc thành tiếng đúng như bạn gõ.`,
    `- Viết số bằng chữ khi đó là con số được đọc lên: "ba nghìn năm" thay vì`,
    `  "3000 năm", "hai phần ba" thay vì "2/3". Ký hiệu cũng vậy: "phần trăm" thay`,
    `  vì "%", "độ C" thay vì "°C".`,
    `- Tên riêng nước ngoài: viết dạng người Việt hay đọc, hoặc kèm cách đọc, để`,
    `  máy không đánh vần từng chữ cái.`,
    `- Chỉ tiếng Việt. Không chèn câu tiếng Anh nào vào lời đọc.`,
    ``,
    `### Tiếng phản ứng chèn vào câu`,
    ``,
    `Giọng đọc phát được ba tiếng phi ngôn ngữ, viết thẳng vào lời đọc trong dấu`,
    `ngoặc vuông. Chúng được PHÁT RA thành tiếng chứ không bị đọc lên thành chữ,`,
    `và cũng không hiện trong phụ đề:`,
    ``,
    `  [cười]         tiếng bật cười ngắn`,
    `  [thở dài]      tiếng thở ra`,
    `  [hắng giọng]   tiếng đằng hắng`,
    ``,
    `Dùng khi câu văn thật sự gọi ra phản ứng đó - một con số vô lý, một điều trái`,
    `khoáy, một chỗ ngoặt bất ngờ:`,
    ``,
    `  "Và nó vẫn ăn được [cười], sau ba nghìn năm."`,
    `  "Cả đàn chỉ còn lại đúng bảy con [thở dài]."`,
    ``,
    `**Một lần trong mỗi video, nhiều nhất là hai.** Hầu như video nào cũng có ít`,
    `nhất một chỗ đáng chèn - chỗ con số vô lý nhất, hoặc ngay trước câu chốt - và`,
    `bỏ trống hết thì lời đọc phẳng lì. Nhưng rắc mỗi câu một lần thì thành khó`,
    `chịu và nghe giả.`,
    ``,
    `Không bao giờ đặt trong cảnh mở đầu: hai giây đầu phải là thông tin, không`,
    `phải tiếng cười.`,
    ``,
    `## Từng cảnh`,
    ``,
    `Mỗi cảnh là một ảnh nền cộng một đoạn lời đọc ngắn. Bạn quyết định:`,
    ``,
    `1. "narration" - phần lời đọc rơi vào cảnh này. Khoảng ${wordsPerScene} từ, tối đa`,
    `   ${MAX_NARRATION_CHARS} ký tự.`,
    ``,
    `   Hãy hiểu đúng chỗ này: lời đọc là MỘT mạch văn duy nhất, và các cảnh chỉ`,
    `   là chỗ bạn cắt mạch văn đó ra để đổi hình. Cảnh KHÔNG cần kết thúc trọn`,
    `   một câu. Một câu dài chạy hết cảnh này sang cảnh sau là hoàn toàn bình`,
    `   thường và còn hay hơn, vì hình đổi trong khi người đọc vẫn đang nói -`,
    `   giống như dựng phim thật.`,
    ``,
    `   Thử nghiệm: nối "narration" của tất cả các cảnh lại bằng dấu cách, đọc to`,
    `   lên. Nếu nghe như một người đang kể liền mạch thì đúng; nếu nghe như đọc`,
    `   từng gạch đầu dòng thì viết lại.`,
    ``,
    `2. "imageQuery" - một trong những truy vấn đã khai báo ở "content.imageQueries",`,
    `   chọn cái hợp với điều đang nói ở cảnh này.`,
    ``,
    `3. "title" - vài chữ hiện trên màn hình, tối đa 40 ký tự. Để CHUỖI RỖNG cho`,
    `   hầu hết các cảnh: phụ đề đã chạy sẵn dưới màn hình rồi, thêm chữ nữa là`,
    `   khung hình rối. Chỉ đặt title ở cảnh mở đầu, và ở nhiều nhất một hoặc hai`,
    `   cảnh thực sự là bước ngoặt.`,
    ``,
    `4. "animation" - chuyển động máy quay trên ảnh tĩnh:`,
    `   ${ANIMATIONS.join(' | ')}`,
    `   Chọn theo bức ảnh: "pan" cho ảnh rộng, "zoom-in" khi có chủ thể rõ,`,
    `   "zoom-out" để mở ra, "drift" khi không cần gì đặc biệt. Đổi kiểu giữa các`,
    `   cảnh - dùng một kiểu cho cả video là cách nhanh nhất làm video trông rẻ.`,
    ``,
    `5. "transition" - ${TRANSITIONS.join(' | ')}. Ở độ dài này "cut" là mặc định.`,
    `   Dùng "fade" cho cảnh mở, cảnh kết, và chỗ chuyển ý lớn.`,
    ``,
    `6. "effect" - ${SCENE_EFFECTS.join(' | ')}. "vignette" làm tối bốn góc, hợp`,
    `   với ảnh rối hoặc cảnh tối. Phần lớn cảnh để "none".`,
    ``,
    `7. "overlay" - lớp hạt chuyển động phủ lên ảnh:`,
    `   ${SCENE_OVERLAYS.join(' | ')}`,
    `   · "dust" - hạt bụi li ti bay lên. Hợp với gần như mọi ảnh.`,
    `   · "bokeh" - đốm sáng nhoè nổi lên. Ban đêm, phố, trong nhà.`,
    `   · "rain" - sợi mưa rơi. Chỉ khi đang thực sự nói về mưa.`,
    `   · "light-sweep" - một vệt sáng chậm quét ngang. Bình minh, cửa sổ, ánh sáng.`,
    `   Đặt cho từng cảnh, và để "none" ở một số cảnh: nếu cảnh nào cũng có thứ gì`,
    `   đó chuyển động thì không cảnh nào còn nổi bật.`,
    ``,
    `8. "duration" - ước lượng của bạn, tính bằng giây. Chỉ để tham khảo: độ dài`,
    `   thật được đo từ file âm thanh, nên không cần chính xác.`,
    ``,
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
    `## Các giá trị hợp lệ`,
    ``,
    `- type: ${SCENE_TYPES.join(' | ')}`,
    `- imageQuery: một trong ${MIN_IMAGE_QUERIES}-${MAX_IMAGE_QUERIES} truy vấn bạn khai ở content.imageQueries`,
    `- animation: ${ANIMATIONS.join(' | ')}`,
    `- transition: ${TRANSITIONS.join(' | ')}`,
    `- effect: ${SCENE_EFFECTS.join(' | ')}`,
    `- overlay: ${SCENE_OVERLAYS.join(' | ')}`,
    `- style: ${STYLES.join(' | ')} (gợi ý: ${input.defaultStyle})`,
    `  · calm  - sáng, nhẹ, tương phản thấp; ban ngày, ngoài trời`,
    `  · warm  - vàng ấm; lịch sử, ký ức, ảnh cũ`,
    `  · night - tối và lạnh; vũ trụ, biển sâu, ban đêm`,
    `- voice: một trong`,
    ...Object.values(VIETNAMESE_VOICES).map((v) => `    ${v}`),
    `  (dùng ${input.defaultVoice} trừ khi có lý do rõ ràng để đổi. Tốc độ và cao`,
    `  độ là thiết lập hệ thống, không phải của bạn: bỏ hẳn "rate" và "pitch".)`,
    ``,
    `Chỉ dùng những giá trị này. Không tự nghĩ ra giá trị mới.`,
    ``,
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

/** Appended verbatim on a retry so the model sees exactly what was wrong. */
export function buildRetryPrompt(originalPrompt: string, problems: string): string {
  return [
    originalPrompt,
    ``,
    `---`,
    ``,
    `## Bản trước đã bị từ chối`,
    ``,
    problems,
    ``,
    `Sửa lại và trả về JSON đã sửa. Vẫn chỉ JSON, không gì khác.`,
  ].join('\n');
}
