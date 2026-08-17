import { loadFont } from '@remotion/fonts';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';

/**
 * Be Vietnam Pro, bundled locally (SIL OFL).
 *
 * M0 preflight showed the machine already has Vietnamese glyph coverage, so
 * this is not about avoiding tofu - it is about determinism. Left to its own
 * devices, Chrome Headless Shell fell back to a serif face, which means the
 * same storyboard would render differently depending on which fonts happen to
 * be installed. Bundling the file removes that variable, and Be Vietnam Pro is
 * drawn specifically for Vietnamese diacritics, so stacked marks sit correctly
 * rather than colliding with ascenders.
 *
 * The delayRender handle matters as much as the font: without it the first
 * frames encode against the fallback face and the text visibly jumps.
 */
export const FONT_FAMILY = 'Be Vietnam Pro';

export const FONT_WEIGHTS = {
  regular: '400',
  bold: '700',
  extraBold: '800',
} as const;

const handle = delayRender(`Loading ${FONT_FAMILY}`);

Promise.all([
  loadFont({
    family: FONT_FAMILY,
    url: staticFile('fonts/BeVietnamPro-Regular.ttf'),
    weight: FONT_WEIGHTS.regular,
    format: 'truetype',
  }),
  loadFont({
    family: FONT_FAMILY,
    url: staticFile('fonts/BeVietnamPro-Bold.ttf'),
    weight: FONT_WEIGHTS.bold,
    format: 'truetype',
  }),
  loadFont({
    family: FONT_FAMILY,
    url: staticFile('fonts/BeVietnamPro-ExtraBold.ttf'),
    weight: FONT_WEIGHTS.extraBold,
    format: 'truetype',
  }),
])
  .then(() => continueRender(handle))
  .catch((err) => cancelRender(err));

/**
 * Fallbacks are listed for the Studio preview only. In a render the bundled
 * face is always available by the time the first frame is drawn.
 */
export const FONT_STACK = `"${FONT_FAMILY}", "Helvetica Neue", Arial, sans-serif`;
