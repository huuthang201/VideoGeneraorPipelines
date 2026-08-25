import type { CaptionPage } from '../../domain/timeline';
import type { WordTiming } from '../../tts/types';
import type { Scene } from './domain/scene';

/**
 * Caption pagination for a fact short: where one subtitle line ends and the
 * next begins.
 *
 * A page breaks where the *voice* breaks - at a full stop, or at a silence long
 * enough to be heard as one - rather than at a word count, because a subtitle
 * that changes in the middle of a phrase reads as a glitch. The word ceiling is
 * a backstop for a run-on clause, not a target.
 *
 * See the podcast module's version for the same job done for a bilingual
 * subtitle, which has to divide a translation across the pages as well.
 */
const SENTENCE_END = /[.!?…:]["')\]]?$/u;

/** Punctuation a page may be cut at when the ceiling forces a break. */
const SOFT_BREAK = /[,;–—-]$/u;

/** A backstop, not a target - most pages end at a pause well before this. */
const MAX_WORDS_PER_PAGE = 12;

/**
 * Fewest words a soft break may leave on either side of the cut.
 *
 * Cutting at a comma two words in produces a page nobody can read in the time
 * it is up, and hands the next page ten - which then hits the ceiling again.
 */
const MIN_WORDS_AFTER_SOFT_BREAK = 4;

/**
 * A silence between two words long enough to be heard as a break.
 *
 * 260ms is past an ordinary inter-word gap and short of a full stop's pause, so
 * it catches the commas and the mid-sentence beats that a fact script is full
 * of ("Và đây là phần lạ nhất - nó vẫn ăn được").
 */
const PAUSE_BREAK_MS = 260;

function paginate(
  words: readonly WordTiming[],
  sceneStartMs: number,
  durationInFrames: number,
  fps: number,
): CaptionPage[] {
  if (words.length === 0) return [];

  const sceneDurationMs = (durationInFrames / fps) * 1000;
  const pages: CaptionPage[] = [];
  let current: WordTiming[] = [];

  /**
   * Emits the first `count` words as a page and keeps the rest for the next
   * one. Called with the whole buffer at a sentence or a pause, and with a
   * prefix when the ceiling forced a cut at a comma.
   */
  const flush = (count: number = current.length) => {
    if (count <= 0 || current.length === 0) return;

    const page = current.slice(0, count);
    const rest = current.slice(count);

    const tokens = page.map((w) => ({
      text: w.text,
      fromMs: clamp(w.fromMs - sceneStartMs, 0, sceneDurationMs),
      toMs: clamp(w.toMs - sceneStartMs, 0, sceneDurationMs),
    }));

    const startMs = tokens[0]!.fromMs;
    const endMs = tokens[tokens.length - 1]!.toMs;

    // A page whose words were entirely clipped away carries no information.
    if (endMs > startMs) {
      pages.push({
        text: page.map((w) => w.text).join(' '),
        // Always empty here: this module subtitles in one language. The field
        // exists because the podcast module's pages carry a translated line.
        translation: '',
        startMs,
        // Hold the page until the next one starts rather than blinking out the
        // instant the last word ends. Shorter than the long-form version's
        // hold: at four seconds a scene, a line lingering half a second past
        // its last word is a line still on screen under the next picture.
        durationMs: Math.min(endMs - startMs + 260, sceneDurationMs - startMs),
        tokens,
      });
    }

    current = rest;
  };

  words.forEach((word, index) => {
    current.push(word);

    const next = words[index + 1];
    const gapToNext = next ? next.fromMs - word.toMs : Infinity;

    if (SENTENCE_END.test(word.text) || gapToNext >= PAUSE_BREAK_MS) {
      flush();
      return;
    }

    if (current.length >= MAX_WORDS_PER_PAGE) flush(softBreakAt(current));
  });
  flush();

  return pages;
}

/**
 * Where to cut a full page: after the last comma that leaves enough on both
 * sides of the cut, or at the ceiling when there is no usable comma.
 */
function softBreakAt(current: readonly WordTiming[]): number {
  for (let i = current.length - MIN_WORDS_AFTER_SOFT_BREAK; i >= MIN_WORDS_AFTER_SOFT_BREAK; i--) {
    if (SOFT_BREAK.test(current[i - 1]!.text)) return i;
  }
  return current.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The module's caption builder, in the shape `buildTimeline` expects.
 *
 * `scene` is unused here - the subtitle is one language and needs nothing from
 * the storyboard beyond the words the voice actually produced. The podcast
 * module's builder does use it, which is why it is in the signature.
 */
export function buildCaptions(input: {
  words: readonly WordTiming[];
  sceneStartMs: number;
  durationInFrames: number;
  fps: number;
  scene: Scene;
}): CaptionPage[] {
  return paginate(input.words, input.sceneStartMs, input.durationInFrames, input.fps);
}
