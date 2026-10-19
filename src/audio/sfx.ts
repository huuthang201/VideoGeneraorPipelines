import { readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Sound effects, and the rule that keeps them from breaking a channel.
 *
 * The vocabulary below is fixed, like the poses and the expressions - a model
 * that can name any sound will eventually name one nobody has, and the run
 * fails at the last step of a video that was otherwise finished.
 *
 * But the whitelist alone is not enough, because these are *files* and the
 * folder starts empty. So the list offered to the model is the intersection of
 * this vocabulary and what is actually on disk: `available()` scans
 * `assets/sfx/`, and the prompt is built from what it returns. Drop three files
 * in and the model may use three; drop none and the prompt never mentions
 * sound effects at all.
 *
 * That is deliberately different from `MUSIC_FILE`, which fails the run when it
 * names a file that is not there. Naming a specific track is a person's
 * decision and a typo should be loud; picking a sound effect is the model's,
 * and a channel publishing every four hours must not stop because it reached
 * for a laugh it did not have.
 */

export interface SoundEffect {
  id: string;
  /** What it is for, in the prompt's own language. */
  label: string;
}

/** The whole vocabulary. A file is `assets/sfx/<id>.mp3`. */
export const SOUND_EFFECTS: SoundEffect[] = [
  { id: 'trong-cheo', label: 'trống chèo - sau một câu đùa nhạt hoặc một lời tự nhận ngu' },
  { id: 'boing', label: 'tiếng nảy - khi ai đó làm điều ngớ ngẩn' },
  { id: 'khung-dia', label: 'đĩa than khựng lại - khi câu chuyện quay ngoắt' },
  { id: 'vut', label: 'tiếng vụt - khi một nhân vật xuất hiện hoặc biến mất' },
  { id: 'leng-keng', label: 'tiếng leng keng - khi loé ra một ý tưởng (thường là ý tồi)' },
  { id: 'uych', label: 'tiếng đổ uỵch - khi ai đó ngã hoặc bỏ cuộc' },
  { id: 'lap-lanh', label: 'tiếng lấp lánh - khi hé lộ điều gì đó' },
  { id: 'de-keu', label: 'tiếng dế kêu - im lặng ngượng ngùng sau một câu không ai cười' },
];

const BY_ID = new Map(SOUND_EFFECTS.map((s) => [s.id, s]));

/** Which extensions count. Whatever ffmpeg and a browser both read. */
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.ogg']);

/**
 * The effects this installation actually has, in vocabulary order.
 *
 * Returns the id and the file, so the caller can both name it to the model and
 * stage it into the render bundle without scanning twice.
 */
export async function availableSoundEffects(
  sfxDir: string,
): Promise<{ id: string; label: string; file: string }[]> {
  const entries = await readdir(sfxDir, { withFileTypes: true }).catch(() => []);

  const files = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) continue;
    const id = path.basename(entry.name, ext);
    // First one wins, so two extensions of the same effect is not an error.
    if (BY_ID.has(id) && !files.has(id)) files.set(id, path.join(sfxDir, entry.name));
  }

  return SOUND_EFFECTS.filter((s) => files.has(s.id)).map((s) => ({
    id: s.id,
    label: s.label,
    file: files.get(s.id)!,
  }));
}
