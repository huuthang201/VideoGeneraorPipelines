import type { StyleName } from '../../domain/config';
import type { Theme } from './types';

/**
 * The fact-short theme pack: sized for a 9:16 frame watched on a phone held
 * close, for a few seconds at a time, and often with the sound off - which
 * makes the subtitle the whole point rather than an aid.
 *
 * Read it against `podcast.ts`, which is the same three styles tuned the
 * opposite way; that file lists the differences and the reasoning.
 *
 * The two values here that are not merely "more of the same":
 *
 * - **`caption.bottomRatio` is 0.2**, a fifth of the frame, which is much
 *   higher than a subtitle usually sits. That is the Shorts overlay: the
 *   channel name, the title and the description occupy the bottom of the
 *   player, and anything drawn under them is simply not readable here.
 * - **`captionHighlight` is a real colour rather than white.** On a muted play
 *   the highlight is the only thing telling the viewer where in the sentence
 *   the narrator is, and white on a bright photograph does not carry.
 */
export const FACT_THEMES: Record<StyleName, Theme> = {
  /**
   * Daylight. Light type on a lightly dimmed photograph, cool neutral accents -
   * the default, and the one that suits outdoor and daytime backdrops.
   */
  calm: {
    name: 'calm',
    pack: 'fact',
    colors: {
      background: '#0f1214',
      scrim: 'rgba(8,12,16,0.34)',
      text: '#ffffff',
      textMuted: 'rgba(255,255,255,0.74)',
      accent: '#9fd6d2',
      accentText: '#0f1214',
      captionText: '#ffffff',
      // A real colour rather than plain white: on a muted play the highlight is
      // the only thing telling the viewer where in the line the voice is.
      captionHighlight: '#ffe066',
    },
    title: {
      sizeRatio: 0.075,
      fontWeight: '700',
      lineHeight: 1.16,
      letterSpacingEm: -0.012,
      uppercase: false,
      maxWidthRatio: 0.86,
    },
    caption: {
      sizeRatio: 0.062,
      fontWeight: '700',
      lineHeight: 1.24,
      bottomRatio: 0.2,
    },
    captionBlockLines: 2,
    scrim: { solidRatio: 0.26, reachRatio: 0.8 },
    motion: {
      entryDurationFrames: 12,
      transitionDurationFrames: 8,
      amplitude: { zoom: 0.22, panOverscan: 1.24, drift: 0.12 },
    },
    progressBar: { visible: true, heightRatio: 0.005, color: 'rgba(255,255,255,0.6)' },
  },

  /**
   * Amber and soft. For history, memory, anything with an old photograph in it -
   * the facts that are being told rather than explained.
   */
  warm: {
    name: 'warm',
    pack: 'fact',
    colors: {
      background: '#17100b',
      scrim: 'rgba(30,16,6,0.38)',
      text: '#fff6ea',
      textMuted: 'rgba(255,246,234,0.72)',
      accent: '#e8b487',
      accentText: '#17100b',
      captionText: '#fff6ea',
      captionHighlight: '#ffbf5e',
    },
    title: {
      sizeRatio: 0.073,
      fontWeight: '700',
      lineHeight: 1.18,
      letterSpacingEm: -0.008,
      uppercase: false,
      maxWidthRatio: 0.84,
    },
    caption: {
      sizeRatio: 0.061,
      fontWeight: '700',
      lineHeight: 1.26,
      bottomRatio: 0.2,
    },
    captionBlockLines: 2,
    scrim: { solidRatio: 0.26, reachRatio: 0.8 },
    motion: {
      entryDurationFrames: 14,
      transitionDurationFrames: 10,
      amplitude: { zoom: 0.2, panOverscan: 1.22, drift: 0.11 },
    },
    progressBar: { visible: true, heightRatio: 0.0045, color: 'rgba(232,180,135,0.65)' },
  },

  /**
   * Dark and cool. Deep scrim and the calmest motion of the three - for space,
   * the deep sea, night, and anything where the photograph is mostly darkness
   * already.
   */
  night: {
    name: 'night',
    pack: 'fact',
    colors: {
      background: '#05070d',
      scrim: 'rgba(3,5,12,0.52)',
      text: '#e8ecf7',
      textMuted: 'rgba(232,236,247,0.62)',
      accent: '#8ea2d8',
      accentText: '#05070d',
      captionText: '#f2f5ff',
      captionHighlight: '#8fd0ff',
    },
    title: {
      sizeRatio: 0.07,
      fontWeight: '700',
      lineHeight: 1.2,
      letterSpacingEm: 0.0,
      uppercase: false,
      maxWidthRatio: 0.82,
    },
    caption: {
      sizeRatio: 0.06,
      fontWeight: '700',
      lineHeight: 1.28,
      bottomRatio: 0.2,
    },
    captionBlockLines: 2,
    scrim: { solidRatio: 0.26, reachRatio: 0.8 },
    motion: {
      entryDurationFrames: 16,
      transitionDurationFrames: 12,
      amplitude: { zoom: 0.18, panOverscan: 1.2, drift: 0.1 },
    },
    progressBar: { visible: true, heightRatio: 0.004, color: 'rgba(142,162,216,0.6)' },
  },
};
