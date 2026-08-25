// Inlined into the bundle as a data: URI by the webpack rule in
// src/video/bundler.ts (and mirrored in remotion.config.ts for Studio).
import regularFontUrl from '../../public/fonts/BeVietnamPro-Regular.ttf';
import boldFontUrl from '../../public/fonts/BeVietnamPro-Bold.ttf';

/**
 * Be Vietnam Pro, embedded in the bundle (SIL OFL).
 *
 * The point is determinism. Left to its own devices, Chrome Headless Shell fell
 * back to a serif face, which means the same storyboard would render
 * differently depending on which fonts happen to be installed on the machine.
 *
 * The face itself was chosen when this engine wrote Vietnamese and is kept now
 * that it writes English: a clean, low-contrast grotesque with a complete Latin
 * set that still renders Vietnamese correctly, which the project names, the UI
 * and the folder names on disk are all written in.
 *
 * ## Why there is no delayRender() here
 *
 * There used to be one, wrapping a `loadFont()` call, so that no frame could be
 * drawn against the fallback face. It is the single most expensive line this
 * codebase has had: it failed a seven-minute episode twice and an eight-minute
 * one three times, always with
 *
 *   A delayRender() "Loading Be Vietnam Pro" was called but not cleared
 *   after 298000ms
 *
 * and always after tens of minutes of Claude, speech and rendering had already
 * been paid for.
 *
 * The message is a red herring in two ways. First, the font was not slow -
 * embedding it as a data: URI, so there is no request at all, changed nothing.
 * Second, the handle *was* cleared: instrumenting the page showed every tab
 * logging both its `delayRender` and its matching `continueRender` within
 * milliseconds of opening. What the timeout actually measures is the age of a
 * handle Remotion still believes is open, and it fires at exactly
 * `timeoutInMilliseconds` after the page opened - so any render whose page
 * lives longer than the timeout dies, no matter what the page is doing. A
 * six-minute episode survived by seconds; an eight-minute one could not.
 *
 * None of it was necessary. `@remotion/renderer` awaits `document.fonts.ready`
 * before it captures every single frame (seek-to-frame.js), which is a stronger
 * guarantee than a one-off handle at page load: it holds for frame one and for
 * frame fourteen thousand. So the font is registered as an ordinary
 * `@font-face` and the load is kicked off immediately, which is enough to make
 * it pending before the first frame is drawn. No handle, no timeout, nothing to
 * misattribute.
 *
 * ## Two weights, not three
 *
 * 400 for body and subtitles, 700 for scene titles - a title set in the same
 * weight as its subtitle has no hierarchy, and hierarchy is most of what makes
 * type look composed rather than placed. Extra-bold stays unloaded: it is a
 * shout, and nothing here shouts.
 *
 * Both faces cover Vietnamese, which stopped being incidental when the
 * subtitles went bilingual - the second line is Vietnamese, with its stacked
 * diacritics, drawn at speed under the first.
 */
export const FONT_FAMILY = 'Be Vietnam Pro';

const FONT_FACE_CSS = [400, 700]
  .map(
    (weight) => `@font-face {
  font-family: "${FONT_FAMILY}";
  src: url(${weight === 700 ? boldFontUrl : regularFontUrl}) format("truetype");
  font-weight: ${weight};
  font-style: normal;
  /* block, not swap: a frame drawn in the fallback face while the real one
     loads is a frame with different metrics, and the whole reason the font is
     bundled is that every run must look the same. */
  font-display: block;
}`,
  )
  .join('\n');

/**
 * `document.fonts` is typed without `load` in this TypeScript lib, so the one
 * method used is declared here rather than casting the call site to `any`.
 */
interface FontLoader {
  load(font: string): Promise<unknown>;
}

if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = FONT_FACE_CSS;
  document.head.appendChild(style);

  // Starts both loads now rather than when the first glyph is laid out, so the
  // faces are already pending entries in document.fonts when Remotion awaits
  // document.fonts.ready ahead of the first frame.
  for (const weight of [400, 700]) {
    void (document.fonts as unknown as FontLoader)
      .load(`${weight} 16px "${FONT_FAMILY}"`)
      .catch(() => {
        // Nothing useful to do here: if an embedded face cannot be parsed the
        // frames fall back, and that is visible in the output rather than silent.
      });
  }
}

/**
 * Fallbacks are listed for the Studio preview only. In a render the embedded
 * face is always available by the time the first frame is drawn.
 */
export const FONT_STACK = `"${FONT_FAMILY}", "Helvetica Neue", Arial, sans-serif`;
