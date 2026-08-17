import type { WordTiming } from './types';

/**
 * Maps a single narration track back onto the scenes that produced it.
 *
 * Spec §15-16 asks for exactly one voice.mp3, and spec §17 forbids the model
 * from guessing timestamps. Reconciling those means synthesising the joined
 * narration once and then working out, from the returned word timings, where
 * each scene's slice of speech actually ends.
 *
 * Matching is done on *character position*, not on token identity. Exact token
 * matching looks tidier but is brittle: the service expands numbers into words
 * ("399" -> "ba trăm chín chín"), drops punctuation, and occasionally merges
 * clitics, so a token-by-token walk desynchronises on the first surprise and
 * every later scene inherits the error. Character position degrades smoothly
 * instead - an unexpected expansion shifts a boundary by a word or two rather
 * than corrupting everything downstream.
 */

export interface SceneNarration {
  id: string;
  narration: string;
}

export interface AlignedScene {
  id: string;
  /** Absolute ms within the single voice track. */
  startMs: number;
  endMs: number;
  /** The words belonging to this scene, still in absolute ms. */
  words: WordTiming[];
}

export interface AlignmentResult {
  scenes: AlignedScene[];
  /**
   * 0..1 similarity between what we asked to be spoken and what the timings
   * say was spoken. Low values mean the boundaries are approximate; the caller
   * logs a warning rather than failing, since the audio itself is still fine.
   */
  confidence: number;
  /** True when character matching was abandoned for proportional splitting. */
  usedFallback: boolean;
}

/**
 * Strips everything that does not affect how much *speech* a string represents:
 * case, punctuation, and whitespace. What remains is a comparable character
 * count.
 */
export function normalizeForAlignment(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[.,!?;:()\[\]{}"'`‘’“”–—…-]/g, '')
    .replace(/\s+/g, '');
}

function weightOf(text: string): number {
  // A word contributes at least 1 so a token that normalises away entirely
  // (a lone "-", say) still advances the cursor.
  return Math.max(1, normalizeForAlignment(text).length);
}

export function alignScenesToWords(
  scenes: readonly SceneNarration[],
  words: readonly WordTiming[],
): AlignmentResult | null {
  if (scenes.length === 0) return null;
  if (words.length === 0) return null;

  const sceneWeights = scenes.map((s) => weightOf(s.narration));
  const totalSceneWeight = sceneWeights.reduce((a, b) => a + b, 0);

  const wordWeights = words.map((w) => weightOf(w.text));
  const totalWordWeight = wordWeights.reduce((a, b) => a + b, 0);

  if (totalSceneWeight === 0 || totalWordWeight === 0) return null;

  // Scale scene targets into the word-weight space so a systematic expansion
  // (numbers read aloud) shifts every boundary consistently instead of pushing
  // the error onto the final scene.
  const scale = totalWordWeight / totalSceneWeight;

  const cumulativeWordWeight: number[] = [];
  let running = 0;
  for (const w of wordWeights) {
    running += w;
    cumulativeWordWeight.push(running);
  }

  const assignments: number[][] = scenes.map(() => []);
  let cursor = 0;
  let sceneTarget = 0;

  for (let k = 0; k < scenes.length; k++) {
    sceneTarget += sceneWeights[k]! * scale;
    const isLast = k === scenes.length - 1;

    // Every remaining word goes to the last scene so none are dropped.
    if (isLast) {
      for (let i = cursor; i < words.length; i++) assignments[k]!.push(i);
      cursor = words.length;
      break;
    }

    let end = cursor;
    while (end < words.length && cumulativeWordWeight[end]! < sceneTarget) end++;

    // Choose whichever side of the target lands closer, so a boundary falling
    // mid-word does not systematically bias one direction.
    if (end < words.length && end > cursor) {
      const overshoot = cumulativeWordWeight[end]! - sceneTarget;
      const undershoot = sceneTarget - cumulativeWordWeight[end - 1]!;
      if (overshoot > undershoot) end -= 1;
    }

    // A scene with narration must own at least one word, otherwise it would get
    // a zero-length slot and later be clamped to an arbitrary minimum.
    const minimumEnd = sceneWeights[k]! > 1 ? cursor : cursor - 1;
    if (end < minimumEnd) end = minimumEnd;

    // Leave enough words for the scenes that follow.
    const remainingScenes = scenes.length - k - 1;
    const maxEnd = words.length - 1 - remainingScenes;
    if (end > maxEnd) end = maxEnd;

    for (let i = cursor; i <= end && i < words.length; i++) assignments[k]!.push(i);
    cursor = Math.max(cursor, end + 1);
  }

  // Built with a loop rather than map because a scene with no words of its own
  // (empty narration) has to inherit the previous scene's end, which means
  // reading entries as they are produced.
  const aligned: AlignedScene[] = [];
  let lastEndMs = words[0]!.fromMs;

  for (let k = 0; k < scenes.length; k++) {
    const sceneWords = assignments[k]!.map((i) => words[i]!);
    const first = sceneWords[0];
    const last = sceneWords[sceneWords.length - 1];

    const startMs = first ? first.fromMs : lastEndMs;
    const endMs = last ? last.toMs : lastEndMs;
    lastEndMs = endMs;

    aligned.push({ id: scenes[k]!.id, startMs, endMs, words: sceneWords });
  }

  return {
    scenes: enforceMonotonic(aligned),
    confidence: similarity(
      scenes.map((s) => normalizeForAlignment(s.narration)).join(''),
      words.map((w) => normalizeForAlignment(w.text)).join(''),
    ),
    usedFallback: false,
  };
}

/** Boundaries must never move backwards, whatever the matching produced. */
function enforceMonotonic(scenes: AlignedScene[]): AlignedScene[] {
  let previousEndMs = 0;
  return scenes.map((scene) => {
    const startMs = Math.max(scene.startMs, previousEndMs);
    const endMs = Math.max(scene.endMs, startMs);
    previousEndMs = endMs;
    return { ...scene, startMs, endMs };
  });
}

/**
 * Dice coefficient over character bigrams - a cheap similarity measure that is
 * tolerant of insertions, which is exactly the failure mode here (spoken
 * numbers adding characters that were never in the script).
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1);
  }

  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    const count = bigrams.get(gram) ?? 0;
    if (count > 0) {
      bigrams.set(gram, count - 1);
      hits++;
    }
  }

  return (2 * hits) / (a.length - 1 + (b.length - 1));
}

/**
 * Last resort when there are no word timings at all: split the measured audio
 * duration between scenes in proportion to how much text each carries.
 *
 * Captions cannot be word-highlighted in this mode, but the video still lines
 * up with the voice at scene granularity, which beats falling back to the
 * model's invented durations.
 */
export function alignByProportion(
  scenes: readonly SceneNarration[],
  totalDurationMs: number,
): AlignmentResult {
  const weights = scenes.map((s) => weightOf(s.narration));
  const total = weights.reduce((a, b) => a + b, 0) || 1;

  let cursor = 0;
  const aligned: AlignedScene[] = scenes.map((scene, k) => {
    const share = (weights[k]! / total) * totalDurationMs;
    const startMs = cursor;
    const endMs = k === scenes.length - 1 ? totalDurationMs : cursor + share;
    cursor = endMs;
    return { id: scene.id, startMs, endMs, words: [] };
  });

  return { scenes: enforceMonotonic(aligned), confidence: 0, usedFallback: true };
}
