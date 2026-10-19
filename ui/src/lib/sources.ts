/**
 * The links in a piece of text, and what each one can be used for.
 *
 * Mirrors `extractSources` and `isImageSource` on the server - the same regex,
 * the same trailing-punctuation trim, the same rule for what supplies pictures -
 * so what the interface lists while somebody types is exactly what the research
 * call will be told. It is duplicated rather than imported because the
 * interface is built separately from the engine and cannot reach into `src/`.
 */

export interface DetectedSource {
  url: string;
  /** A Wikimedia Commons category: its pictures can go into the video. */
  images: boolean;
}

const MAX_SOURCES = 12;

export function detectSources(text: string): DetectedSource[] {
  const found = text.match(/https?:\/\/[^\s<>"'`]+/giu) ?? [];
  const cleaned = found.map((u) => u.replace(/[)\]}.,;:!?'"]+$/u, ''));

  return [...new Set(cleaned)].slice(0, MAX_SOURCES).map((url) => ({
    url,
    images: /commons\.wikimedia\.org/iu.test(url) && /Category:/u.test(decodeURIComponent(url)),
  }));
}
