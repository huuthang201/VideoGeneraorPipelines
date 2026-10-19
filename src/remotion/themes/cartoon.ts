import type { StyleName } from '../../domain/config';
import { FACT_THEMES } from './fact';
import type { Theme } from './types';

/**
 * The cartoon pack: the shorts geometry, its own colours.
 *
 * Derived for the same reason `psych.ts` is - the layout numbers describe the
 * *format*, not the channel. The subtitle sits a fifth of the way up because
 * that is where the Shorts player overlay stops; the title reserves two lines
 * because that is how often nine Vietnamese syllables wrap. Copying those would
 * mean the next time one is corrected it gets corrected on one channel only.
 *
 * What differs is that this channel's frame is *drawn*, and drawn frames are
 * flatter and more saturated than photographs. The subtitle therefore needs a
 * harder edge than it does over a photo: the highlight is pushed towards a
 * brighter, cooler yellow so it separates from a backdrop that may itself be
 * warm grass or a violet wall.
 */
const ACCENTS: Record<StyleName, { accent: string; captionHighlight: string }> = {
  calm: { accent: '#8fd0ff', captionHighlight: '#ffe14d' },
  warm: { accent: '#ffc48a', captionHighlight: '#ffd84d' },
  night: { accent: '#a8b6ff', captionHighlight: '#8ff0e2' },
};

export const CARTOON_THEMES: Record<StyleName, Theme> = Object.fromEntries(
  (Object.keys(FACT_THEMES) as StyleName[]).map((style) => [
    style,
    {
      ...FACT_THEMES[style],
      pack: 'cartoon',
      colors: { ...FACT_THEMES[style].colors, ...ACCENTS[style] },
    } satisfies Theme,
  ]),
) as Record<StyleName, Theme>;
