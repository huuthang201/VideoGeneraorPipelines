import { z } from 'zod';
import {
  MIN_SCENES,
  PublishMetaSchema,
  baseDraftFields,
  baseStoryboardFields,
  checkSceneOrder,
  countWords,
  lengthVerdict,
  narrationFromScenes,
} from '../../../domain/storyboard';
import { SceneSchema } from './scene';

/**
 * How many scenes a video may hold.
 *
 * The ceiling is what a sixty second video needs at roughly four seconds a
 * scene, plus room for a faster-cut one. The floor is three because a video
 * still has to open and close: hook, at least one fact, payoff.
 */
export const MAX_SCENES = 18;

/**
 * How many image queries one video may name.
 *
 * Not a style preference - it is the rate limit made into a schema. The free
 * tier of the image search allows two hundred requests a day, and the engine
 * spends one per distinct query; at four a video, a channel publishing hourly
 * uses about a hundred, which leaves room for retries and for a second run of
 * the same day's work. One query per scene would blow the budget before noon.
 *
 * Two is the floor because a video that shoots every scene against the same
 * search is a video whose pictures all look alike, whatever the search returns.
 */
export const MIN_IMAGE_QUERIES = 2;
export const MAX_IMAGE_QUERIES = 4;

const ContentSchema = z.strictObject({
  /** One or two sentences saying what the fact is - the internal blurb. */
  summary: z.string().min(1),
  /**
   * The full spoken script. Derived, not authored: it is always the scene
   * lines joined, because that is what actually gets synthesised and split
   * back apart. Kept in the file for script.txt, but defaulted so a
   * hand-written storyboard need not repeat itself - and so a copy that
   * disagrees with the scenes cannot fail an otherwise valid file.
   */
  narration: z.string().default(''),
  /** The video's visual themes. */
  imageQueries: z.array(z.string().min(1)).min(MIN_IMAGE_QUERIES).max(MAX_IMAGE_QUERIES),
});

export const StoryboardSchema = z.strictObject({
  ...baseStoryboardFields(),
  content: ContentSchema,
  scenes: z.array(SceneSchema).min(MIN_SCENES).max(MAX_SCENES),
});

export type Storyboard = z.infer<typeof StoryboardSchema>;

export const StoryboardDraftSchema = z.strictObject({
  ...baseDraftFields(),
  content: ContentSchema,
  scenes: z.array(SceneSchema).min(MIN_SCENES).max(MAX_SCENES),
});

export type StoryboardDraft = z.infer<typeof StoryboardDraftSchema>;

export { PublishMetaSchema };

/**
 * How far the spoken script may miss the requested length before the draft is
 * sent back.
 *
 * Both ends are tight here, and that is the difference from the podcast module.
 * There, overrunning means a longer episode than asked for - a preference. Here
 * the ceiling is the format itself: past sixty seconds YouTube stops treating
 * the upload as a Short, so a script that overruns by half does not make a long
 * short, it makes an ordinary video nobody will be served. The floor still
 * guards the familiar failure - a model asked for forty-five seconds returning
 * fifteen and calling it done.
 */
const SHORTFALL_TOLERANCE = 0.8;
export const OVERRUN_TOLERANCE = 1.15;

/**
 * Structural rules that a plain schema cannot express, applied to a draft that
 * has already parsed. Returns human-readable violations - they get echoed back
 * to the model verbatim on retry, which is far more effective than asking it to
 * "try again".
 *
 * Written in Vietnamese, like the prompt they are appended to. Mixing the two
 * languages in one conversation is how a model starts answering in the wrong
 * one, and the deliverable here is Vietnamese prose.
 *
 * @param targetWords the word budget the prompt asked for, or null to skip the
 *                    length check (a hand-written storyboard has no budget)
 */
export function checkStoryboardStructure(
  draft: StoryboardDraft,
  targetWords: number | null = null,
): string[] {
  const scenes = draft.scenes;
  const queries = draft.content.imageQueries;

  const problems = checkSceneOrder(scenes, {
    firstNotIntro: (got) => `Cảnh đầu tiên phải có type "intro", đang là "${got}".`,
    lastNotOutro: (got) => `Cảnh cuối cùng phải có type "outro", đang là "${got}".`,
    duplicateId: (id) => `Trùng id cảnh: "${id}".`,
  });

  for (const query of queries) {
    if (/[^\u0000-\u007f]/u.test(query)) {
      problems.push(
        `imageQuery "${query}" có dấu tiếng Việt. Kho ảnh chỉ đánh chỉ mục bằng tiếng Anh.`,
      );
    }
  }

  for (const scene of scenes) {
    if (!queries.includes(scene.imageQuery)) {
      problems.push(
        `Cảnh "${scene.id}" dùng imageQuery "${scene.imageQuery}", không có trong ` +
          `content.imageQueries: ${queries.join(' | ')}. Mỗi cảnh phải chọn đúng một trong ` +
          'những truy vấn đã khai báo.',
      );
    }

    if (/[^\u0000-\u007f]/u.test(scene.imageQuery)) {
      problems.push(
        `imageQuery của cảnh "${scene.id}" ("${scene.imageQuery}") có dấu tiếng Việt. Kho ảnh ` +
          'chỉ đánh chỉ mục bằng tiếng Anh, nên truy vấn phải viết bằng tiếng Anh không dấu.',
      );
    }
  }

  // Two scenes in a row against the same query still get different photographs
  // - the engine hands each scene its own candidate from the pool - so the
  // spread that matters is across the whole video rather than per cut.
  const usedQueries = new Set(scenes.map((s) => s.imageQuery)).size;
  if (scenes.length >= 6 && usedQueries < 2) {
    problems.push(
      `Cả ${scenes.length} cảnh đều dùng chung một imageQuery. Hãy chia ra ít nhất hai chủ đề ` +
        'hình khác nhau, nếu không cả video sẽ toàn ảnh na ná nhau.',
    );
  }

  if (targetWords !== null && targetWords > 0) {
    const words = countWords(narrationFromScenes(draft));
    const verdict = lengthVerdict(words, targetWords, {
      shortfall: SHORTFALL_TOLERANCE,
      overrun: OVERRUN_TOLERANCE,
    });
    if (verdict === 'short') {
      problems.push(
        `Kịch bản chỉ có ${words} từ, ngắn hơn nhiều so với ${targetWords} từ cần thiết để video ` +
          'chạy đúng độ dài. Viết thêm chi tiết thật cho mỗi cảnh, hoặc thêm cảnh - không được ' +
          'kéo dài bằng cách nhắc lại điều đã nói.',
      );
    } else if (verdict === 'long') {
      problems.push(
        `Kịch bản có ${words} từ so với mục tiêu ${targetWords} từ, tức là video sẽ dài quá ` +
          'khung Short. Cắt bớt cho gọn: bỏ câu dẫn, bỏ ý phụ, giữ đúng phần thông tin.',
      );
    }
  }

  return problems;
}
