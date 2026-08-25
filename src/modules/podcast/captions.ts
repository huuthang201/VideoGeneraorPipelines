import type { CaptionPage } from '../../domain/timeline';
import type { WordTiming } from '../../tts/types';
import type { Scene } from './domain/scene';

/**
 * Caption pagination for a podcast episode, and the division of the Vietnamese
 * line across the pages.
 *
 * Subtitles here are bilingual, and the two lines are not the same kind of
 * thing. The English is word-timed from the TTS boundaries; the Vietnamese is
 * the meaning of a whole page, held for as long as the page is. There is no
 * honest word-level mapping between the two languages, so `withTranslation`
 * divides `scene.narrationVi` across a scene's pages by *proportion*,
 * preferring sentence boundaries.
 *
 * See the fact module's version for the same job done for a single line.
 */
interface PagedCaption {
  page: CaptionPage;
  /** Which sentence of the scene's narration this page belongs to. */
  sentenceIndex: number;
}

const SENTENCE_END = /[.!?…]["')\]]?$/u;

function buildPagedCaptions(
  words: readonly WordTiming[],
  sceneStartMs: number,
  durationInFrames: number,
  fps: number,
): PagedCaption[] {
  if (words.length === 0) return [];

  const sceneDurationMs = (durationInFrames / fps) * 1000;
  // A ceiling, not a target: most pages end at a full stop well before this.
  const MAX_WORDS_PER_PAGE = 14;

  const pages: PagedCaption[] = [];
  let current: WordTiming[] = [];
  let sentenceIndex = 0;

  const flush = (endsSentence: boolean) => {
    if (current.length === 0) return;

    const tokens = current.map((w) => ({
      text: w.text,
      fromMs: clamp(w.fromMs - sceneStartMs, 0, sceneDurationMs),
      toMs: clamp(w.toMs - sceneStartMs, 0, sceneDurationMs),
    }));

    const startMs = tokens[0]!.fromMs;
    const endMs = tokens[tokens.length - 1]!.toMs;

    // A page whose words were entirely clipped away carries no information.
    if (endMs > startMs) {
      pages.push({
        sentenceIndex,
        page: {
          text: current.map((w) => w.text).join(' '),
          // Filled in by `withTranslation` once every page of the scene is
          // known - the match needs all of their sentence indices, not one.
          translation: '',
          startMs,
          // Hold the page until the next one starts rather than blinking out
          // the instant the last word ends.
          durationMs: Math.min(endMs - startMs + 420, sceneDurationMs - startMs),
          tokens,
        },
      });
    }

    current = [];
    if (endsSentence) sentenceIndex += 1;
  };

  for (const word of words) {
    current.push(word);

    const endsSentence = SENTENCE_END.test(word.text);
    // Every sentence gets its own page, however short. A two-word sentence
    // ("You sit.") is a deliberate beat in the writing, and a minimum length
    // here swallowed it into the next line - which also silently shifted every
    // following sentence index, and put the wrong Vietnamese line under the
    // right English one for the rest of the scene.
    if (endsSentence || current.length >= MAX_WORDS_PER_PAGE) {
      flush(endsSentence);
    }
  }
  flush(true);

  return pages;
}

/**
 * Attaches the Vietnamese line to each page of one scene.
 *
 * Matched by *proportion*, not by counting sentences. Counting was the obvious
 * approach and it failed the first time the model wrote three English sentences
 * as four natural Vietnamese ones: from that point on every page showed the
 * translation of the previous thought, which reads as a straightforwardly wrong
 * subtitle rather than an approximate one.
 *
 * Proportion cannot drift like that. Both languages are laid out on 0..1 by
 * cumulative character length, and a page takes the Vietnamese sentence it
 * overlaps most. A mismatch in sentence count then costs a fraction of a
 * sentence rather than a whole one, and never accumulates.
 *
 * Whole sentences either way: a Vietnamese line cut mid-clause is harder to
 * read than one that lingers a page too long.
 */
function withTranslation(pages: PagedCaption[], narrationVi: string): CaptionPage[] {
  if (pages.length === 0) return [];
  if (!narrationVi.trim()) return pages.map((p) => p.page);

  const sentences = narrationVi
    .trim()
    .split(/(?<=[.!?…])\s+/u)
    .filter(Boolean);

  if (sentences.length === 0) return pages.map((p) => p.page);
  if (sentences.length === 1) {
    return pages.map((p) => ({ ...p.page, translation: sentences[0]! }));
  }

  const pageSpans = cumulativeSpans(pages.map((p) => p.page.text.length));
  const sentenceSpans = cumulativeSpans(sentences.map((sentence) => sentence.length));

  return pages.map(({ page }, index) => {
    const [pageStart, pageEnd] = pageSpans[index]!;

    let best = sentences[sentences.length - 1]!;
    let bestOverlap = -1;

    sentences.forEach((sentence, i) => {
      const [start, end] = sentenceSpans[i]!;
      const overlap = Math.min(end, pageEnd) - Math.max(start, pageStart);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = sentence;
      }
    });

    return { ...page, translation: best };
  });
}

/** Turns a list of lengths into [start, end] fractions of their total. */
function cumulativeSpans(lengths: readonly number[]): [number, number][] {
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const spans: [number, number][] = [];
  let cursor = 0;

  for (const length of lengths) {
    const start = cursor / total;
    cursor += length;
    spans.push([start, cursor / total]);
  }

  return spans;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The module's caption builder, in the shape `buildTimeline` expects. */
export function buildCaptions(input: {
  words: readonly WordTiming[];
  sceneStartMs: number;
  durationInFrames: number;
  fps: number;
  scene: Scene;
}): CaptionPage[] {
  const paged = buildPagedCaptions(
    input.words,
    input.sceneStartMs,
    input.durationInFrames,
    input.fps,
  );
  return withTranslation(paged, input.scene.narrationVi);
}
