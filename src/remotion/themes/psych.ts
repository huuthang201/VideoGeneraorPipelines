import type { StyleName } from '../../domain/config';
import { FACT_THEMES } from './fact';
import type { Theme } from './types';

/**
 * "Não Có Vấn Đề"'s theme pack: the fact pack's geometry, its own colours.
 *
 * Derived rather than written out, and the split is not laziness - it is where
 * the two channels actually differ.
 *
 * **Everything about the shape is the format, not the channel.** The subtitle
 * sits a fifth of the way up the frame because that is where the Shorts player
 * overlay stops, the title reserves two lines because that is how often nine
 * Vietnamese syllables wrap at this size, the motion is quick because a scene
 * lasts five seconds. None of those numbers know what the video is about, and
 * copying them would mean the next time one is corrected it gets corrected on
 * one channel only - which is precisely the bug this repository has already
 * shipped once, in the caption reservation.
 *
 * **The accent colours are the channel.** They are what a viewer recognises
 * scrolling past, and they are the one thing that should not be shared. The
 * fact pack's accents are natural-history colours - sea green, amber, dusk
 * blue. These are cooler and more electric, which reads as *mind* rather than
 * *nature*, and the highlight stays a saturated non-white for the same reason
 * it does there: on a muted play it is the only thing telling the viewer where
 * in the sentence the voice has got to.
 */

/** Only what makes this channel look like itself. Everything else is inherited. */
const ACCENTS: Record<StyleName, { accent: string; captionHighlight: string }> = {
  /** Daylight, everyday situations - the default. A cool violet against skin tones. */
  calm: { accent: '#b7a6f0', captionHighlight: '#ffe066' },
  /** Memory, the past, anything that wants to feel remembered rather than seen. */
  warm: { accent: '#f0a6c8', captionHighlight: '#ffc4dd' },
  /** Late, interior, the videos about what the mind does when nobody is watching. */
  night: { accent: '#7fe3d4', captionHighlight: '#8ff0e2' },
};

export const PSYCH_THEMES: Record<StyleName, Theme> = Object.fromEntries(
  (Object.keys(FACT_THEMES) as StyleName[]).map((style) => [
    style,
    {
      ...FACT_THEMES[style],
      pack: 'psych',
      colors: { ...FACT_THEMES[style].colors, ...ACCENTS[style] },
    } satisfies Theme,
  ]),
) as Record<StyleName, Theme>;
