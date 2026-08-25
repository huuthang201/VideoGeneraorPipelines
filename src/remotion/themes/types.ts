import type { ModuleId, StyleName } from '../../domain/config';
import type { MotionAmplitude } from '../animations/presets';

/**
 * Styles are data, not components.
 *
 * Every scene component reads from a Theme, so adding a fourth style means
 * adding one object - not forking three React trees that then drift apart. The
 * same holds one level up: the two modules render the *same* components and
 * differ only in the numbers in their theme pack. See `podcast.ts` and
 * `fact.ts`, and `getTheme` in `theme.ts` for how one is chosen.
 *
 * ## Why type sizes are ratios
 *
 * The frame is 1080x1920 or 1920x1080 depending on how the video is being
 * published, and a font size in pixels cannot be right for both: 96px is a
 * headline in a vertical frame and a banner in a horizontal one. Every size
 * here is therefore a fraction of the frame's *short* edge, resolved to pixels
 * in the component from `useVideoConfig()`. The short edge rather than the
 * diagonal or the width because that is what actually bounds how much text fits
 * on a line at a readable size - and because it happens to be 1080 in both
 * shapes, which is why the same ratio gives the same physical size either way.
 */
export interface Theme {
  name: StyleName;
  /**
   * Which pack this theme came from.
   *
   * Carried on the theme itself so a component that already receives one does
   * not need the module threaded down to it separately. Only the caption
   * renderer branches on it, and it does so because the two modules subtitle
   * differently enough to be two components rather than two sets of numbers -
   * see CaptionRenderer.
   */
  pack: ModuleId;

  colors: {
    background: string;
    /** Scrim laid over the image so text stays legible on any photograph. */
    scrim: string;
    text: string;
    textMuted: string;
    accent: string;
    accentText: string;
    captionText: string;
    /** Colour of the word currently being spoken. */
    captionHighlight: string;
  };

  title: {
    /** Fraction of the frame's short edge. */
    sizeRatio: number;
    fontWeight: string;
    lineHeight: number;
    /** Tracking in em, so it scales with the resolved size. */
    letterSpacingEm: number;
    uppercase: boolean;
    /** Fraction of the safe area the title may occupy. */
    maxWidthRatio: number;
  };

  caption: {
    sizeRatio: number;
    fontWeight: string;
    lineHeight: number;
    /**
     * Distance from the bottom of the frame, as a fraction of its height.
     *
     * Where a subtitle goes in the podcast pack; a fifth of the way up in the
     * fact pack, to clear the Shorts player overlay.
     */
    bottomRatio: number;
    /**
     * Draws a soft plate behind the caption - helps on busy photographs.
     *
     * Optional because only the podcast pack uses one: it is what keeps two
     * lines of bilingual text readable over a bright sky. A single line of
     * heavy type does not need it, and the plate would only eat frame.
     */
    background?: string | null;
  };

  /**
   * How many caption-sized lines to reserve above the subtitle, so a scene's
   * own title never lands on top of it.
   *
   * Per module because the two subtitle blocks are different objects. The fact
   * pack reserves two: nine Vietnamese syllables at that size wraps to two
   * lines in a 9:16 frame often enough to plan for. The podcast pack reserves
   * more than four - two for the English, which wraps at twelve words; plus the
   * Vietnamese line at 78% size, which wraps too; plus the plate's own padding.
   *
   * Under-reserving this is not a cosmetic bug: the title lands on top of the
   * subtitle, and only on the busiest sentences, so it survives a casual review
   * and shows up in the finished video.
   */
  captionBlockLines: number;

  /**
   * How far up the frame the bottom scrim reaches.
   *
   * Explicit numbers rather than something derived from the caption geometry,
   * because the two packs do not sit at the same multiple of it and inventing
   * a formula that split the difference would change how both of them look.
   *
   * The band that has to stay readable is wherever the subtitle is, plus the
   * lines it wraps to. In the podcast pack the caption sits low and the
   * gradient stops at 62%. In the fact pack the caption sits a fifth of the way
   * up to clear the Shorts overlay and wraps to two large lines, so the scrim
   * has to hold full strength to 26% and reach 80% - a gradient stopping at 62%
   * there leaves the top line of a two-line caption on bare photograph.
   */
  scrim: {
    /** Fraction of frame height held at full strength before the fade begins. */
    solidRatio: number;
    /** Fraction of frame height at which the gradient is fully transparent. */
    reachRatio: number;
  };

  motion: {
    /**
     * Frames a title takes to enter.
     *
     * Long in the podcast pack, where nothing snaps; quick in the fact pack,
     * where a scene may only last four seconds.
     */
    entryDurationFrames: number;
    /** Frames a cross-scene transition takes when not a hard cut. */
    transitionDurationFrames: number;
    /** How far the Ken Burns camera travels. See MotionAmplitude. */
    amplitude: MotionAmplitude;
  };

  /** Thin progress line, so the viewer can see how much is left. */
  progressBar: {
    visible: boolean;
    /** Fraction of the frame's short edge. */
    heightRatio: number;
    color: string;
  };
}
