import type { CharacterId } from '../../remotion/characters/palette';

/**
 * Which voice belongs to which character, permanently.
 *
 * This file is the answer to "the voice of each character must be fixed across
 * videos". It is a constant rather than a storyboard field on purpose: if the
 * model could choose, it would eventually choose differently, and a character
 * that sounds like someone else in episode forty is a different character.
 * Same reasoning as the frame size, which `runPipeline` overwrites from
 * configuration on every run rather than reading from the file.
 *
 * All four are northern, matching the other channels. Beyond that the pairing
 * is about telling them apart with the eyes shut: two women and two men, and
 * within each pair one storytelling voice against one plainer one, so a
 * listener knows who is speaking before the sentence resolves.
 *
 * `Thanh Bình` is deliberately absent. It narrates Fact Shorts and Não Có Vấn
 * Đề, and a third channel using it would sound like those two wearing a
 * costume.
 */
export const CHARACTER_VOICES: Record<CharacterId, string> = {
  /** Nữ · Bắc · kể chuyện. The warmest of the four. */
  'meo-trang': 'Ngọc Linh',
  /** Nam · Bắc · tự nhiên. Casual, the one that sounds like a friend talking. */
  'meo-van': 'Phạm Tuyên',
  /** Nữ · Bắc · tự nhiên. Plainer than Ngọc Linh, which is how the two women stay apart. */
  'cho-den': 'Trúc Ly',
  /** Nam · Bắc · tin tức. Crisper than Phạm Tuyên, for the same reason. */
  'cho-dom': 'Minh Đức',
};

/**
 * Speaking pace, and an honest note about it.
 *
 * The shorts modules get one number because they have one narrator. This one
 * has four, and the engine's own notes are emphatic that the voice is the
 * largest factor in pace - Thanh Bình reads 318 wpm where Thái Sơn reads 248,
 * a 28% gap between two voices from the same engine.
 *
 * A script cannot be budgeted per voice, because who speaks which line is not
 * known until the script exists. So this is one blended figure and the ±15%
 * tolerance absorbs the rest, which is the same slack that already lets a good
 * script finish its last sentence.
 *
 * It is a placeholder until measured. `npm run tts:pace <script.txt>` does the
 * measurement, and it has to be run on a real dialogue script through these
 * four voices - never on a passage of prose, and never on one voice.
 */
export const CARTOON_WORDS_PER_MINUTE = 300;
