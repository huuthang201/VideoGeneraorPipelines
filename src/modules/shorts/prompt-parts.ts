import {
  ANIMATIONS,
  SCENE_EFFECTS,
  SCENE_OVERLAYS,
  SCENE_TYPES,
  TRANSITIONS,
} from '../../domain/scene';
import { MAX_IMAGE_QUERY_CHARS, MAX_NARRATION_CHARS } from './domain/scene';
import { MAX_IMAGE_QUERIES, MAX_SCENES, MIN_IMAGE_QUERIES } from './domain/storyboard';
import { STYLES } from '../../domain/config';
import { SECONDS_PER_SCENE, targetWordsFor } from './pacing';
import { VIETNAMESE_VOICES } from '../../tts/types';

/**
 * The parts of a prompt that describe the machine rather than the channel.
 *
 * A prompt here has two kinds of paragraph in it, and telling them apart is
 * what keeps two channels from slowly becoming two codebases.
 *
 * Some paragraphs are *editorial*: what this channel is about, what counts as
 * true here, how it sounds, what it says at the end. Those belong to the
 * channel and always will.
 *
 * The rest is the model being taught **how this system behaves** - that the
 * stock library indexes objects and not actions, that adding a third word to a
 * query drops the result count off a cliff, that the speech engine pauses hard
 * at a full stop and barely at a comma, which enum values the schema accepts.
 * None of that has an opinion about subject matter. It is measured behaviour of
 * Openverse, of VieNeu-TTS and of `StoryboardDraftSchema`, and if it is written
 * out once per channel then a lesson learned the expensive way - "rodent teeth"
 * returns museum skulls - gets fixed in one prompt and stays wrong in the
 * other.
 *
 * So: this file is the machine, and `<channel>/prompts/` is the channel.
 */

/** Scenes, and how many words each gets, for a video of this length. */
export function shapeOf(targetDurationSec: number) {
  const targetWords = targetWordsFor(targetDurationSec);
  const sceneCount = Math.min(
    MAX_SCENES,
    Math.max(4, Math.round(targetDurationSec / SECONDS_PER_SCENE)),
  );
  return {
    seconds: Math.round(targetDurationSec),
    targetWords,
    sceneCount,
    wordsPerScene: Math.round(targetWords / sceneCount),
  };
}

export interface PromptShape {
  seconds: number;
  targetWords: number;
  sceneCount: number;
  wordsPerScene: number;
}

/** The word budget, and why missing it is expensive rather than untidy. */
export function lengthSection({ seconds, targetWords, sceneCount, wordsPerScene }: PromptShape): string[] {
  return [
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
  ];
}

/**
 * How to write a query that finds photographs.
 *
 * Every rule here was paid for by a video that came out with the wrong picture
 * in it, and every number is a real result count from the live search. It is
 * about Openverse, not about facts or psychology, so both channels get it.
 */
export function imageQuerySection(): string[] {
  return [
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
  ];
}

/** Writing for a machine whose only expressive tool is your punctuation. */
export function voiceMechanicsSection(): string[] {
  return [
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
  ];
}

/** The eight fields a scene carries, and what each is for. */
export function sceneFieldsSection({ wordsPerScene }: PromptShape): string[] {
  return [
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
  ];
}

/** The enum values the schema will accept, listed from the schema itself. */
export function validValuesSection(defaultStyle: string, defaultVoice: string): string[] {
  return [
    `## Các giá trị hợp lệ`,
    ``,
    `- type: ${SCENE_TYPES.join(' | ')}`,
    `- imageQuery: một trong ${MIN_IMAGE_QUERIES}-${MAX_IMAGE_QUERIES} truy vấn bạn khai ở content.imageQueries`,
    `- animation: ${ANIMATIONS.join(' | ')}`,
    `- transition: ${TRANSITIONS.join(' | ')}`,
    `- effect: ${SCENE_EFFECTS.join(' | ')}`,
    `- overlay: ${SCENE_OVERLAYS.join(' | ')}`,
    `- style: ${STYLES.join(' | ')} (gợi ý: ${defaultStyle})`,
    `  · calm  - sáng, nhẹ, tương phản thấp; ban ngày, ngoài trời`,
    `  · warm  - vàng ấm; lịch sử, ký ức, ảnh cũ`,
    `  · night - tối và lạnh; vũ trụ, biển sâu, ban đêm`,
    `- voice: một trong`,
    ...Object.values(VIETNAMESE_VOICES).map((v) => `    ${v}`),
    `  (dùng ${defaultVoice} trừ khi có lý do rõ ràng để đổi. Tốc độ và cao`,
    `  độ là thiết lập hệ thống, không phải của bạn: bỏ hẳn "rate" và "pitch".)`,
    ``,
    `Chỉ dùng những giá trị này. Không tự nghĩ ra giá trị mới.`,
    ``,
  ];
}

/**
 * Appended verbatim on a retry so the model sees exactly what was wrong.
 *
 * Identical for every channel: it is the rejection machinery talking, not the
 * channel. Echoing the specific violation is what keeps the common case at one
 * call - a model told *what* was wrong fixes it, a model told to try again
 * guesses.
 */
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
