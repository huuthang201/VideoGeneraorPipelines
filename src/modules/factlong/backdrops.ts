import { readFile } from 'node:fs/promises';
import { resolveSearchedBackdrops } from '../shorts/backdrops';
import { researchSceneImages } from './image-research';
import { BriefSchema, permittedArticlesOf } from './domain/brief';
import { jobPaths } from '../../config/env';
import type { Storyboard } from './domain/storyboard';
import type { AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import type { ResolvedBackdrops } from '../contract';

/**
 * The photographs, searched the same way every other module searches - plus,
 * when the channel owner has the papers' permission, the photographs inside the
 * articles the brief links to.
 *
 * Worth knowing what the search alone cannot do, because it shapes the writing.
 * Openverse indexes openly-licensed stock, and a disaster that happened last
 * week is not in it; Wikimedia Commons sometimes is, a handful of files per
 * category. So without permission a video about a real event is narrated mostly
 * over photographs of the *kind* of place and the *kind* of thing. The papers
 * that covered the event have the actual pictures - and those can only come in
 * by the owner's say-so, recorded on the project's brief.
 */
export async function resolveBackdrops(input: {
  storyboard: Storyboard;
  config: AppConfig;
  logger: Logger;
}): Promise<ResolvedBackdrops> {
  const permittedArticles = await permittedArticlesFor(input.config, input.storyboard.project.id);
  if (permittedArticles.length > 0) {
    input.logger.step(
      `Dùng ảnh gốc từ ${permittedArticles.length} bài báo (chủ kênh xác nhận đã được phép), ` +
        'giữ nguyên ảnh và ghi nguồn trên khung hình',
    );
  }

  /*
   * A video about an event its owner has photographs of shows that event and
   * nothing else. The owner's words for it were one hundred per cent: every
   * scene a picture of the event the scene is talking about. So no stock query
   * is searched at all, and the research looks only for the *other* events the
   * script names - the flood it is compared with - rather than for places.
   */
  const eventOnly = permittedArticles.length > 0;

  const researched = await researchSceneImages({
    storyboard: input.storyboard,
    config: input.config,
    logger: input.logger,
    pressSources: permittedArticles,
    mode: eventOnly ? 'other-events' : 'places',
  });

  return resolveSearchedBackdrops({
    permittedArticles,
    // Ninety scenes cannot all have a picture of their own that fits, and on a
    // long video a wrong one stays up for ten seconds. See `blankScenes`.
    blankScenes: 'reuse',
    ...(eventOnly
      ? {
          storyboardQueries: false,
          // Thirty-odd photographs for ninety scenes: each will be seen more
          // than once, and seeing the event again is the rule, not the fault.
          maxUses: EVENT_ONLY_MAX_USES,
        }
      : {}),
    scenes: input.storyboard.scenes.map((scene) => ({
      id: scene.id,
      narration: scene.narration,
      imageQuery: scene.imageQuery,
      extraQueries: researched.get(scene.id) ?? [],
    })),
    config: input.config,
    logger: input.logger,
    reviewFormat: (eventOnly ? EVENT_ONLY_BRIEF : GENERAL_BRIEF).join('\n\n'),
  });
}

/** Most scenes one of an event's own photographs may appear on. */
const EVENT_ONLY_MAX_USES = 4;

const OPENING =
  'Bạn đang chọn ảnh nền cho một video tiếng Việt dài mười lăm đến hai mươi phút, ' +
  'khung ngang 16:9, dạng phóng sự - kể một chuyện có thật thật chi tiết. ' +
  'Một ảnh ở đây nằm trên màn hình khoảng mười giây, tức là lâu gấp đôi một video ngắn, ' +
  'nên ảnh sai chủ đề bị nhìn thấy rõ hơn nhiều.';

/*
 * When, as well as where. A photograph of the 2008 Hà Nội flood is a real
 * picture of the right city under the right kind of water, and under a
 * sentence about the night of the sixteenth of September 2026 it is a false
 * one: the viewer takes it for this flood.
 */
const RIGHT_MOMENT =
  '**Ảnh phải đúng thời điểm.** Ảnh của một sự kiện khác, dù cùng nơi (ví dụ trận lụt ' +
  'Hà Nội năm 2008), chỉ dùng cho câu nói về CHÍNH sự kiện đó - chẳng hạn câu so sánh với ' +
  'năm 2008. Đặt nó dưới câu kể về sự việc lần này là nói sai: người xem sẽ tưởng đó là ' +
  'ảnh của lần này. Xem tiêu đề và truy vấn của ảnh để biết nó chụp năm nào.';

/**
 * The brief for a video that may show only the events it talks about.
 *
 * Short, because the choice is narrow: the sheet holds the event's own
 * photographs and, for a few scenes, another event's. What is left to judge is
 * which of the event's photographs fits which sentence, and which event a
 * sentence is about.
 */
const EVENT_ONLY_BRIEF = [
  OPENING,
  '**Mọi cảnh phải là ảnh của ĐÚNG sự kiện câu nói đang kể.** Ảnh "article:" là ảnh báo ' +
    'chí chụp chính sự việc của video (được toà soạn cho phép): dùng cho mọi câu nói về ' +
    'sự việc này - diễn biến, hiện trường, cứu hộ, thiệt hại, và cả những câu giải thích ' +
    'nguyên nhân, bối cảnh, hậu quả của nó. Ảnh "commons:" là ảnh của một sự kiện KHÁC mà ' +
    'kịch bản nhắc tới: chỉ dùng cho câu nói về chính sự kiện đó.',
  'Không có ảnh kho, không có ảnh minh hoạ - trên tờ chỉ có ảnh sự kiện. Việc của bạn là ' +
    'chọn tấm SÁT câu nói nhất: câu về cứu hộ thì ảnh cứu hộ, câu về dòng nước xiết thì ảnh ' +
    'nước xiết, câu về phố ngập thì ảnh phố ngập, câu về người dân thì ảnh người dân.',
  RIGHT_MOMENT,
  '**Người trong ảnh.** Chú thích của ảnh báo cho biết ai trong ảnh; dựa vào đó. Đừng đặt ' +
    'ảnh một người khác vào câu nói về nạn nhân hay gia đình nạn nhân nếu chú thích không ' +
    'nói đó chính là họ - người xem sẽ tin là vậy.',
];

/** The brief for an ordinary long video, where stock is allowed as a last resort. */
const GENERAL_BRIEF = [
  OPENING,
  /*
   * Where, not only what. A stock search for "water pump station" answers
   * with a snowed-in brick pump house in England, and the review took it for a
   * sentence about Hà Nội's Yên Sở station - it is a pump station, after all.
   * So were an English tidal-zone sign, a road closure in a desert and a water
   * works in the Midlands. Every one is on the word and off the place, and a
   * viewer spots that before the subtitle ends.
   */
  '**Ảnh phải ở đúng nơi câu nói nhắc tới.** Khi câu nói về một nơi cụ thể, đừng dùng ' +
    'ảnh rõ ràng chụp ở nơi khác: biển báo bằng thứ tiếng khác, kiểu nhà cửa, khí hậu khác ' +
    '(tuyết, sa mạc), xe cộ, đường phố, con người và trang phục của nước khác. Đúng từ khoá ' +
    'mà sai nơi chốn thì người xem nhận ra ngay là ảnh lấy bừa - tệ hơn cả để trống. Ảnh ' +
    'đúng nơi mà không dính gì tới câu nói (một biển hiệu cửa hàng, một cái máy cày) cũng ' +
    'là ảnh lấy bừa.',
  RIGHT_MOMENT,
  /*
   * A reportage about a real person is where a stock photograph of a stranger
   * stops being filler and starts being a claim. The review put a woman praying
   * at a temple under "the mother came to take her son home", and a young man
   * beside a scooter a few scenes after the missing student was introduced.
   * Neither is who a viewer will take them for.
   */
  '**Người thật trong câu chuyện.** Video kể về những người có thật - nạn nhân, gia đình, ' +
    'nhân chứng. Đừng đặt ảnh một người lạ nhìn rõ mặt vào câu nói về họ, hay ở gần những ' +
    'câu nói ấy: người xem sẽ hiểu đó chính là nạn nhân, là mẹ của nạn nhân - sai với một ' +
    'người đang có thật và đang có tang. Ảnh hiện trường, đám đông, lực lượng cứu hộ, người ' +
    'đứng xa không rõ mặt thì được.',
  /*
   * The order a picture is reached for. Stock last, and not merely last: in a
   * video about something real, a keyword match of the wrong thing is what the
   * owner calls a picture unrelated to the event.
   */
  '**Thứ tự ưu tiên.** Ảnh thật trên Wikimedia Commons tìm riêng cho cảnh - truy vấn ' +
    'dạng "commons:Category:…" hoặc "commons:File:…", là ảnh của đúng nơi, đúng vật câu nói ' +
    'nhắc tới. Ảnh kho chung chung đứng cuối: chỉ dùng khi câu nói về đúng một vật hay hiện ' +
    'tượng chung và ảnh cho thấy đúng cái đó. Với một câu nói về sự việc, thà để trống còn ' +
    'hơn đặt ảnh kho.',
];

/**
 * The articles this project may take photographs from, read off its brief.
 *
 * Read at render time rather than written into the storyboard, so the
 * permission is one switch on one project: turning it on and re-rendering picks
 * up the paper's photographs without rewriting a script that took an hour, and
 * turning it off takes them out again. Commons category links are left out -
 * those are open-licence picture sources already, pinned when the outline is
 * written.
 */
async function permittedArticlesFor(config: AppConfig, projectId: string): Promise<string[]> {
  const raw = await readFile(jobPaths(config.jobsDir, projectId).briefJson, 'utf8').catch(() => null);
  if (!raw) return [];

  const parsed = BriefSchema.safeParse(JSON.parse(raw) as unknown);
  return parsed.success ? permittedArticlesOf(parsed.data) : [];
}
