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
import {
  FactSchema,
  MAX_EVENT_QUERIES,
  MAX_IMAGE_QUERIES,
  MIN_IMAGE_QUERIES,
} from './outline';

/**
 * How many scenes a video may hold.
 *
 * A hundred and forty. That is not a style choice, it is what eleven seconds a
 * scene comes to over twenty minutes, plus room for a faster-cut stretch. The
 * floor is the shared `MIN_SCENES`, which only guards a degenerate draft - a
 * real one here is never near it.
 */
export const MAX_SCENES = 140;

const ContentSchema = z.strictObject({
  /** One or two sentences on what the video covers - the internal blurb. */
  summary: z.string().min(1),
  /**
   * The full spoken script. Derived, not authored: always the scene lines
   * joined, because that is what gets synthesised and split back apart.
   */
  narration: z.string().default(''),
  /**
   * The video's visual themes: the generic ones, then the event ones carrying
   * the `commons:` prefix that routes them to Wikimedia Commons.
   *
   * The ceiling is the sum of both limits rather than `MAX_IMAGE_QUERIES`, and
   * that is not tidiness - it is a bug this file already shipped. The outline
   * validates the two lists separately, so twelve themes plus five event
   * categories are individually legal and their concatenation was not. Nine
   * section calls were written and thrown away at the assembly step by a cap
   * that had not been widened with the field it guards.
   */
  imageQueries: z
    .array(z.string().min(1))
    .min(MIN_IMAGE_QUERIES)
    .max(MAX_IMAGE_QUERIES + MAX_EVENT_QUERIES),
  /**
   * The research the script was written from, carried into the finished file.
   *
   * Kept rather than discarded once the sections are written, and that is the
   * point of the module. A video making a hundred factual claims about a real
   * disaster should be able to say where each of them came from a month later,
   * when somebody asks whether the death toll it quoted was ever right. It also
   * survives into `storyboard.json`, so a re-run reuses the same research
   * instead of quietly finding different numbers.
   */
  facts: z.array(FactSchema).default([]),
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
 * What one section call must return.
 *
 * Only the scenes. Everything else about the video - its title, its themes, its
 * facts - was decided by the outline, and letting a section restate any of it
 * is how section nine ends up with a different death toll from section two.
 */
export const SectionDraftSchema = z.strictObject({
  scenes: z.array(SceneSchema).min(1).max(MAX_SCENES),
});
export type SectionDraft = z.infer<typeof SectionDraftSchema>;

/**
 * How far a *section* may miss its own word budget.
 *
 * Looser than the whole video's band, deliberately. A section is a few hundred
 * syllables and the errors are independent, so they largely cancel across ten
 * of them; holding each one to three percent would mean rewriting good sections
 * to fix arithmetic the next section already undid. The band that matters is
 * checked once, on the assembled script.
 */
const SECTION_SHORTFALL = 0.75;
const SECTION_OVERRUN = 1.3;

/** The band ratios the assembled script is measured against. */
export interface LengthBand {
  shortfall: number;
  overrun: number;
}

/**
 * Turns the channel's second-band into ratios of the word budget.
 *
 * Same shape and same reasoning as the shorts module's - the check runs before
 * anything is synthesised, and the word-to-seconds conversion is accurate
 * enough to carry it. Falls back to a wide band when the configured numbers do
 * not bracket the target, because a band that excludes its own target rejects
 * every draft and fails the run.
 */
export function lengthBandFrom(target: number, min: number, max: number): LengthBand {
  if (!(min > 0 && max > min && min <= target && target <= max)) {
    return { shortfall: 0.85, overrun: 1.15 };
  }
  return { shortfall: min / target, overrun: max / target };
}

/** Anything outside plain ASCII, which for a query means Vietnamese tone marks. */
const NON_ASCII = /[^\u0000-\u007f]/u;

/** Checks one section's scenes as they come back, before the next call is made. */
export function checkSection(
  draft: SectionDraft,
  budget: number,
  queries: readonly string[],
): string[] {
  const problems: string[] = [];

  for (const scene of draft.scenes) {
    if (!queries.includes(scene.imageQuery)) {
      problems.push(
        `Cảnh "${scene.id}" dùng imageQuery "${scene.imageQuery}", không có trong danh sách đã ` +
          `khai ở dàn ý: ${queries.join(' | ')}. Mỗi cảnh phải chọn đúng một trong số đó.`,
      );
    }
    if (NON_ASCII.test(scene.imageQuery)) {
      problems.push(
        `imageQuery của cảnh "${scene.id}" ("${scene.imageQuery}") có dấu tiếng Việt. Kho ảnh ` +
          'chỉ đánh chỉ mục bằng tiếng Anh.',
      );
    }
  }

  const words = countWords(draft.scenes.map((s) => s.narration).join(' '));
  const verdict = lengthVerdict(words, budget, {
    shortfall: SECTION_SHORTFALL,
    overrun: SECTION_OVERRUN,
  });
  if (verdict === 'short') {
    problems.push(
      `Phần này chỉ có ${words} từ, cần khoảng ${budget} từ. Viết thêm chi tiết THẬT từ danh ` +
        'sách sự kiện đã cho - đừng kéo dài bằng cách nhắc lại điều đã nói.',
    );
  } else if (verdict === 'long') {
    problems.push(
      `Phần này có ${words} từ, vượt xa mức ${budget} từ được giao. Cắt bớt: phần bạn định nói ` +
        'thêm gần như chắc chắn thuộc về một phần khác của dàn ý.',
    );
  }

  return problems;
}

/**
 * Structural rules applied to the assembled video, after every section is in.
 *
 * Written in Vietnamese like the prompts it is echoed back into. Note what it
 * does *not* check: individual facts. There is no regex that can tell a true
 * death toll from a false one, and pretending otherwise would be worse than
 * the honest arrangement - the model researches once, names its sources in
 * `content.facts`, and a person can read them.
 */
export function checkStoryboardStructure(
  draft: StoryboardDraft,
  targetWords: number | null = null,
  band: LengthBand = { shortfall: 0.85, overrun: 1.15 },
): string[] {
  const scenes = draft.scenes;
  const queries = draft.content.imageQueries;

  const problems = checkSceneOrder(scenes, {
    firstNotIntro: (got) => `Cảnh đầu tiên phải có type "intro", đang là "${got}".`,
    lastNotOutro: (got) => `Cảnh cuối cùng phải có type "outro", đang là "${got}".`,
    duplicateId: (id) => `Trùng id cảnh: "${id}".`,
  });

  for (const scene of scenes) {
    if (!queries.includes(scene.imageQuery)) {
      problems.push(
        `Cảnh "${scene.id}" dùng imageQuery "${scene.imageQuery}", không có trong ` +
          `content.imageQueries.`,
      );
    }
  }

  /*
   * A video this long shot against three themes is a video whose pictures all
   * look alike by minute six, whatever the search returned. Checked against the
   * queries actually *used* rather than the ones declared, because declaring
   * twelve and using three is the failure that happens.
   */
  const used = new Set(scenes.map((s) => s.imageQuery)).size;
  if (used < MIN_IMAGE_QUERIES) {
    problems.push(
      `Cả video chỉ dùng ${used} chủ đề hình trong khi đã khai ${queries.length}. Video dài mà ` +
        `quanh đi quẩn lại vài tấm ảnh thì người xem bỏ giữa chừng - hãy dùng ít nhất ` +
        `${MIN_IMAGE_QUERIES} chủ đề.`,
    );
  }

  if (targetWords !== null && targetWords > 0) {
    const words = countWords(narrationFromScenes(draft));
    const verdict = lengthVerdict(words, targetWords, band);
    if (verdict === 'short') {
      problems.push(
        `Cả kịch bản chỉ có ${words} từ, cần khoảng ${targetWords} từ để video chạy đúng độ dài.`,
      );
    } else if (verdict === 'long') {
      problems.push(`Cả kịch bản có ${words} từ, vượt mức ${targetWords} từ.`);
    }
  }

  return problems;
}
