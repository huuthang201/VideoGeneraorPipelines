import { z } from 'zod';
import {
  baseDraftFields,
  baseStoryboardFields,
  checkSceneOrder,
  countWords,
  lengthVerdict,
  narrationFromScenes,
  PublishMetaSchema,
} from '../../../domain/storyboard';
import { SceneSchema, type Scene } from './scene';

/**
 * More scenes than the other modules, and shorter ones.
 *
 * A scene is one line of dialogue, so forty-five seconds of conversation is
 * twelve to twenty exchanges rather than nine paragraphs. The ceiling is a
 * runaway guard: past twenty-four the model has stopped writing a scene and
 * started writing a chat log.
 */
export const MIN_SCENES = 4;
export const MAX_SCENES = 24;

/**
 * How many flat backgrounds one video may use.
 *
 * Two. A flat colour changing every scene does not read as a change of place,
 * it reads as a flicker - there is no parallax, no furniture, nothing to say
 * the characters moved. One background for the whole video is perfectly normal;
 * a second earns its place when the subject genuinely shifts.
 */
export const MAX_BACKGROUNDS = 2;

/** How many sound effects one video may carry. See the note in the checker. */
export const MAX_SFX = 2;

const ContentSchema = z.strictObject({
  summary: z.string().min(1),
  /** Derived: the lines joined. Kept in the file for script.txt. */
  narration: z.string().default(''),
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

/** Same allowance as the shorts modules, and for the same sixty-second cliff. */
const SHORTFALL_TOLERANCE = 0.8;
export const OVERRUN_TOLERANCE = 1.15;

/**
 * The rules a schema cannot state, in the language they get echoed back in.
 *
 * Every one of these is a way a draft can parse perfectly and still produce a
 * video that looks broken. They are worth reading as a list of the mistakes a
 * model actually makes when handed a stage.
 */
export function checkStoryboardStructure(
  draft: StoryboardDraft,
  targetWords: number | null = null,
  /** Effect ids that exist on disk. Empty means none may be used. */
  availableSfx: readonly string[] = [],
): string[] {
  const scenes = draft.scenes;

  const problems = checkSceneOrder(scenes, {
    firstNotIntro: (got) => `Cảnh đầu tiên phải có type "intro", đang là "${got}".`,
    lastNotOutro: (got) => `Cảnh cuối cùng phải có type "outro", đang là "${got}".`,
    duplicateId: (id) => `Trùng id cảnh: "${id}".`,
  });

  for (const scene of scenes) {
    const onStage = scene.cast.map((c) => c.character);

    // A speaker who is not on screen has no mouth to move: the line plays over
    // a stage the voice does not belong to.
    if (!onStage.includes(scene.speaker)) {
      problems.push(
        `Cảnh "${scene.id}": speaker là "${scene.speaker}" nhưng nhân vật đó không có trong ` +
          `cast (${onStage.join(', ')}). Người nói phải đang ở trên khung hình.`,
      );
    }

    if (new Set(onStage).size !== onStage.length) {
      problems.push(`Cảnh "${scene.id}": cùng một nhân vật xuất hiện hai lần trong cast.`);
    }

    // Two characters in one slot are drawn on top of each other.
    const slots = scene.cast.map((c) => c.position);
    if (new Set(slots).size !== slots.length) {
      problems.push(
        `Cảnh "${scene.id}": hai nhân vật cùng đứng ở "${slots[0]}". Một bên trái, một bên phải.`,
      );
    }
  }

  problems.push(...checkContinuity(scenes));

  /*
   * A sound effect naming a file nobody has is the one failure that would only
   * appear at render, after a script, a search and four TTS calls have been
   * paid for. Caught here it costs a retry.
   */
  const sfxUsed = scenes.filter((s) => s.sfx);
  for (const scene of sfxUsed) {
    if (!availableSfx.includes(scene.sfx!)) {
      problems.push(
        `Cảnh "${scene.id}" dùng sfx "${scene.sfx}", không có file đó. ` +
          (availableSfx.length
            ? `Chỉ được dùng: ${availableSfx.join(', ')}.`
            : 'Máy này chưa có tiếng động nào - bỏ trống trường sfx.'),
      );
    }
  }

  // Punctuation stops being punctuation when every sentence has it.
  if (sfxUsed.length > MAX_SFX) {
    problems.push(
      `Video dùng ${sfxUsed.length} tiếng động, tối đa ${MAX_SFX}. Rắc mỗi cảnh một tiếng thì ` +
        'không cảnh nào còn được nhấn.',
    );
  }
  if (scenes[0]?.sfx) {
    problems.push('Cảnh mở đầu không được có tiếng động: hai giây đầu phải là nội dung.');
  }

  const backgrounds = new Set(scenes.map((s) => s.background));
  if (backgrounds.size > MAX_BACKGROUNDS) {
    problems.push(
      `Video dùng ${backgrounds.size} nền khác nhau (${[...backgrounds].join(', ')}). Tối đa ` +
        `${MAX_BACKGROUNDS}: nền phẳng đổi liên tục không đọc ra là đổi chỗ, chỉ thấy nhấp nháy.`,
    );
  }

  // A two-hander where only one of them ever speaks is not a conversation, and
  // the second character becomes scenery.
  const cast = new Set(scenes.flatMap((s) => s.cast.map((c) => c.character)));
  const speakers = new Set(scenes.map((s) => s.speaker));
  if (cast.size >= 2 && speakers.size < 2) {
    problems.push(
      `Có ${cast.size} nhân vật trên khung hình nhưng chỉ ${[...speakers].join(', ')} nói. ` +
        'Nhân vật kia thành đồ trang trí - hãy để cả hai cùng thoại.',
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
        `Kịch bản mới ${words} từ, cần khoảng ${targetWords}. Viết thêm lượt thoại, đừng kéo dài ` +
          'từng câu.',
      );
    }
    if (verdict === 'long') {
      problems.push(
        `Kịch bản ${words} từ, vượt mức ${targetWords}. Cắt bớt lượt thoại - quá 60 giây thì ` +
          'YouTube không còn coi là Short.',
      );
    }
  }

  return problems;
}

/**
 * Continuity between one cut and the next.
 *
 * Two rules, and both exist because the alternative looks like a bug rather
 * than like a choice.
 *
 * **A character keeps its side.** Nothing in the frame says the camera moved,
 * so a character that was on the left and is now on the right has teleported.
 * Real dialogue scenes hold their staging for exactly this reason.
 *
 * **Consecutive scenes share someone.** If scene four is the cat alone and
 * scene five is the dog alone, the viewer has been dropped into a different
 * video. Sharing one character is what makes a cut read as the same
 * conversation continuing.
 */
function checkContinuity(scenes: readonly Scene[]): string[] {
  const problems: string[] = [];

  for (let i = 1; i < scenes.length; i++) {
    const prev = scenes[i - 1]!;
    const scene = scenes[i]!;

    for (const here of scene.cast) {
      const before = prev.cast.find((c) => c.character === here.character);
      if (before && before.position !== here.position) {
        problems.push(
          `"${here.character}" đang ở "${before.position}" ở cảnh "${prev.id}" mà sang cảnh ` +
            `"${scene.id}" lại ở "${here.position}". Nhân vật không được đổi bên giữa hai cảnh liền nhau.`,
        );
      }
    }

    const shared = scene.cast.some((c) => prev.cast.some((b) => b.character === c.character));
    if (!shared) {
      problems.push(
        `Cảnh "${scene.id}" không còn nhân vật nào của cảnh "${prev.id}". Hai cảnh liền nhau ` +
          'phải có ít nhất một nhân vật chung, nếu không người xem tưởng sang video khác.',
      );
    }
  }

  return problems;
}
