import type { StyleName } from '../../domain/config';

/**
 * Styles are data, not components (spec §33).
 *
 * Every scene component reads from a Theme, so adding a fourth style means
 * adding one object here - not forking four React trees that then drift apart.
 */
export interface Theme {
  name: StyleName;

  colors: {
    background: string;
    /** Scrim laid over the image so text stays legible on any photo. */
    scrim: string;
    text: string;
    textMuted: string;
    accent: string;
    accentText: string;
    captionText: string;
    /** Colour of the word currently being spoken (spec §18). */
    captionHighlight: string;
  };

  headline: {
    fontSize: number;
    fontWeight: string;
    lineHeight: number;
    letterSpacing: number;
    uppercase: boolean;
    /** Fraction of frame width the headline may occupy. */
    maxWidthRatio: number;
  };

  caption: {
    fontSize: number;
    fontWeight: string;
    lineHeight: number;
    /** Vertical position as a fraction of frame height, from the top. */
    positionRatio: number;
    /** Draws a pill behind the caption - helps on busy product photos. */
    background: string | null;
  };

  motion: {
    /** Frames a headline takes to enter. Shorter reads as more urgent. */
    entryDurationFrames: number;
    /** Frames a cross-scene transition takes when not a hard cut. */
    transitionDurationFrames: number;
    springDamping: number;
    springStiffness: number;
  };

  /** Progress bar across the top showing how far through the video we are. */
  progressBar: {
    visible: boolean;
    height: number;
    color: string;
  };
}

export const THEME_BY_STYLE: Record<StyleName, Theme> = {
  /**
   * Loud, fast, high-contrast. Big type, quick entries, strong accent - built
   * to survive a muted autoplay in a crowded feed.
   */
  'tiktok-fast': {
    name: 'tiktok-fast',
    colors: {
      background: '#08080c',
      scrim: 'rgba(0,0,0,0.42)',
      text: '#ffffff',
      textMuted: 'rgba(255,255,255,0.72)',
      accent: '#ffe14d',
      accentText: '#111111',
      captionText: '#ffffff',
      captionHighlight: '#ffe14d',
    },
    headline: {
      fontSize: 96,
      fontWeight: '800',
      lineHeight: 1.08,
      letterSpacing: -2,
      uppercase: true,
      maxWidthRatio: 0.86,
    },
    caption: {
      fontSize: 66,
      fontWeight: '800',
      lineHeight: 1.15,
      positionRatio: 0.7,
      background: 'rgba(0,0,0,0.55)',
    },
    motion: {
      entryDurationFrames: 8,
      transitionDurationFrames: 6,
      springDamping: 12,
      springStiffness: 220,
    },
    progressBar: { visible: true, height: 8, color: '#ffe14d' },
  },

  /**
   * Clean and product-focused. Cooler palette, calmer motion, lighter type -
   * suits electronics where the object should read as the hero.
   */
  'modern-tech': {
    name: 'modern-tech',
    colors: {
      background: '#0d1117',
      scrim: 'rgba(6,10,18,0.5)',
      text: '#f2f6ff',
      textMuted: 'rgba(242,246,255,0.66)',
      accent: '#4da3ff',
      accentText: '#04121f',
      captionText: '#f2f6ff',
      captionHighlight: '#4da3ff',
    },
    headline: {
      fontSize: 82,
      fontWeight: '700',
      lineHeight: 1.14,
      letterSpacing: -1,
      uppercase: false,
      maxWidthRatio: 0.82,
    },
    caption: {
      fontSize: 58,
      fontWeight: '700',
      lineHeight: 1.2,
      positionRatio: 0.72,
      background: 'rgba(6,10,18,0.6)',
    },
    motion: {
      entryDurationFrames: 14,
      transitionDurationFrames: 12,
      springDamping: 18,
      springStiffness: 140,
    },
    progressBar: { visible: true, height: 5, color: '#4da3ff' },
  },

  /**
   * Quiet. Less text, slower drift, no progress bar - the image does the work
   * and the type stays out of its way.
   */
  minimal: {
    name: 'minimal',
    colors: {
      background: '#f5f3ef',
      scrim: 'rgba(20,18,16,0.28)',
      text: '#ffffff',
      textMuted: 'rgba(255,255,255,0.7)',
      accent: '#1c1a17',
      accentText: '#ffffff',
      captionText: '#ffffff',
      captionHighlight: '#ffd9a0',
    },
    headline: {
      fontSize: 70,
      fontWeight: '400',
      lineHeight: 1.25,
      letterSpacing: 0,
      uppercase: false,
      maxWidthRatio: 0.74,
    },
    caption: {
      fontSize: 52,
      fontWeight: '700',
      lineHeight: 1.25,
      positionRatio: 0.74,
      background: 'rgba(20,18,16,0.45)',
    },
    motion: {
      entryDurationFrames: 20,
      transitionDurationFrames: 18,
      springDamping: 26,
      springStiffness: 90,
    },
    progressBar: { visible: false, height: 0, color: 'transparent' },
  },
};

export function getTheme(style: StyleName): Theme {
  return THEME_BY_STYLE[style];
}

/** Gap between the bottom of scene text and the top of the caption band. */
const CAPTION_CLEARANCE_RATIO = 0.035;

/**
 * Bottom inset for scene content that bottom-aligns, as a fraction of frame
 * height.
 *
 * Captions are positioned independently of the scene's own text - they have to
 * be, since they follow the audio rather than the layout - so without this the
 * two land on top of each other. Reserving the caption band here keeps the
 * headline above it whatever `positionRatio` a theme chooses, instead of each
 * theme needing a hand-tuned padding that breaks when the caption moves.
 */
export function contentBottomInsetRatio(theme: Theme, hasCaptions: boolean): number {
  if (!hasCaptions) return 0.18;
  return Math.max(0.18, 1 - theme.caption.positionRatio + CAPTION_CLEARANCE_RATIO);
}
