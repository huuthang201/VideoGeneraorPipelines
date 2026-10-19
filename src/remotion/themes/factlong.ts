import type { StyleName } from '../../domain/config';
import type { Theme } from './types';
import { FACT_THEMES } from './fact';

/**
 * The long-form theme pack for the fact channel.
 *
 * Derived from `FACT_THEMES` rather than written out, because it *is* the fact
 * channel - the colours, the accents and the highlight are the channel's
 * identity and a viewer arriving from a short should recognise it. Three copies
 * of the same palette would be three places to change it.
 *
 * What is overridden is everything that was a decision about **a phone held
 * close for thirty seconds**, and none of it survives the move to a landscape
 * frame watched for a quarter of an hour:
 *
 * - **`caption.bottomRatio` drops from 0.2 to 0.075.** A fifth of the frame is
 *   where the shorts put a subtitle because the Shorts player draws the channel
 *   name, the title and the description over the bottom of the video. There is
 *   no such overlay on an ordinary video, so a subtitle floating a fifth of the
 *   way up looks like a mistake.
 * - **The type shrinks.** A short's subtitle is set at 0.062 of the short edge
 *   because it has to be read in a second and a half by someone scrolling. Here
 *   the same words are on screen for four or five seconds, the frame is nearly
 *   twice as wide so a line wraps far less, and type that size stops being a
 *   subtitle and becomes a caption card.
 * - **Motion calms down.** The shorts' zoom amplitude is 0.22 because every
 *   scene is five seconds and stillness reads as a frozen frame. At eleven
 *   seconds a scene, the same amplitude is a slow lurch across the whole
 *   picture, and over seventeen minutes it is tiring.
 *
 * `captionBlockLines` stays at the shorts' 2: the subtitle is still one heavy
 * Vietnamese line with no plate behind it, and that is what the number reserves
 * room for.
 */
function longForm(base: Theme): Theme {
  return {
    ...base,
    pack: 'factlong',
    title: {
      ...base.title,
      // A section heading on a wide frame, not a phone-sized announcement.
      sizeRatio: base.title.sizeRatio * 0.72,
      maxWidthRatio: 0.7,
    },
    caption: {
      ...base.caption,
      sizeRatio: base.caption.sizeRatio * 0.74,
      bottomRatio: 0.075,
    },
    motion: {
      ...base.motion,
      // Slower entries too: a cut every eleven seconds does not need to
      // announce itself the way a cut every five does.
      entryDurationFrames: Math.round(base.motion.entryDurationFrames * 1.6),
      transitionDurationFrames: Math.round(base.motion.transitionDurationFrames * 1.75),
      amplitude: {
        zoom: base.motion.amplitude.zoom * 0.45,
        panOverscan: 1 + (base.motion.amplitude.panOverscan - 1) * 0.5,
        drift: base.motion.amplitude.drift * 0.5,
      },
    },
    /**
     * A progress bar earns its place here in a way it does not on a short.
     *
     * On a thirty-second video it is decoration - nobody wonders how much is
     * left. On a seventeen-minute one it is the answer to the question a viewer
     * actually has at minute nine, so it is kept, and made fainter so it is
     * there when looked for and invisible otherwise.
     */
    progressBar: {
      ...base.progressBar,
      visible: true,
      heightRatio: 0.0035,
    },
  };
}

export const FACTLONG_THEMES: Record<StyleName, Theme> = {
  calm: longForm(FACT_THEMES.calm),
  warm: longForm(FACT_THEMES.warm),
  night: longForm(FACT_THEMES.night),
};
