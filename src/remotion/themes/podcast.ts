import type { StyleName } from '../../domain/config';
import type { Theme } from './types';

/**
 * The podcast theme pack: sized for a 16:9 frame watched at a distance, over
 * five to ten minutes, often while the viewer is doing something else.
 *
 * Read it against `fact.ts`, which is the same three styles tuned the opposite
 * way. Every difference between the two files is deliberate and measured:
 *
 * - **Type is smaller** (title 0.062 against 0.075 of the short edge). A
 *   laptop or a television at arm's length or further does not need the size a
 *   phone does, and a headline that large in 16:9 stops looking like a title.
 * - **Captions sit low** (0.1 against 0.2 of frame height) and carry a
 *   translucent background. There is no Shorts overlay eating the bottom fifth
 *   of the player here, so the subtitle can go where a subtitle goes; the plate
 *   behind it is what keeps two lines of bilingual text readable over a bright
 *   photograph.
 * - **Captions are weight 400, not 700.** Two lines competing at equal weight
 *   is what makes a bilingual subtitle unreadable.
 * - **Motion is slow and small** (zoom 0.08 against 0.22, entry 34 frames
 *   against 12). A scene here runs twenty to forty seconds, so the move has to
 *   be felt rather than watched - and anything that reads as an impact is a
 *   defect in a video someone is falling asleep to.
 */
export const PODCAST_THEMES: Record<StyleName, Theme> = {
  /**
   * Daylight. Light type on a lightly dimmed photograph, cool neutral accents -
   * the default, and the one that suits outdoor and daytime backdrops.
   */
  calm: {
    name: 'calm',
    pack: 'podcast',
    colors: {
      background: '#0f1214',
      scrim: 'rgba(8,12,16,0.34)',
      text: '#ffffff',
      textMuted: 'rgba(255,255,255,0.74)',
      accent: '#9fd6d2',
      accentText: '#0f1214',
      captionText: '#ffffff',
      captionHighlight: '#ffffff',
    },
    title: {
      sizeRatio: 0.062,
      fontWeight: '700',
      lineHeight: 1.2,
      letterSpacingEm: -0.012,
      uppercase: false,
      maxWidthRatio: 0.78,
    },
    caption: {
      sizeRatio: 0.042,
      fontWeight: '400',
      lineHeight: 1.32,
      bottomRatio: 0.1,
      background: 'rgba(8,12,16,0.5)',
    },
    captionBlockLines: 2 + 1.5 * 0.78 + 0.9,
    scrim: { solidRatio: 0, reachRatio: 0.62 },
    motion: {
      entryDurationFrames: 34,
      transitionDurationFrames: 24,
      amplitude: { zoom: 0.08, panOverscan: 1.1, drift: 0.05 },
    },
    progressBar: { visible: true, heightRatio: 0.0035, color: 'rgba(255,255,255,0.55)' },
  },

  /**
   * Amber and soft. For memory, stories, late afternoon - anything where the
   * episode is being told rather than explained.
   */
  warm: {
    name: 'warm',
    pack: 'podcast',
    colors: {
      background: '#17100b',
      scrim: 'rgba(30,16,6,0.38)',
      text: '#fff6ea',
      textMuted: 'rgba(255,246,234,0.72)',
      accent: '#e8b487',
      accentText: '#17100b',
      captionText: '#fff6ea',
      captionHighlight: '#ffd9a8',
    },
    title: {
      sizeRatio: 0.06,
      fontWeight: '700',
      lineHeight: 1.22,
      letterSpacingEm: -0.008,
      uppercase: false,
      maxWidthRatio: 0.76,
    },
    caption: {
      sizeRatio: 0.041,
      fontWeight: '400',
      lineHeight: 1.34,
      bottomRatio: 0.1,
      background: 'rgba(30,16,6,0.52)',
    },
    captionBlockLines: 2 + 1.5 * 0.78 + 0.9,
    scrim: { solidRatio: 0, reachRatio: 0.62 },
    motion: {
      entryDurationFrames: 40,
      transitionDurationFrames: 28,
      amplitude: { zoom: 0.07, panOverscan: 1.09, drift: 0.045 },
    },
    progressBar: { visible: true, heightRatio: 0.003, color: 'rgba(232,180,135,0.6)' },
  },

  /**
   * Dark and quiet. Deep scrim, lower contrast type, the slowest motion of the
   * three - for sleep, rain, night skies, anything listened to with the lights
   * off.
   */
  night: {
    name: 'night',
    pack: 'podcast',
    colors: {
      background: '#05070d',
      scrim: 'rgba(3,5,12,0.52)',
      text: '#e8ecf7',
      textMuted: 'rgba(232,236,247,0.62)',
      accent: '#8ea2d8',
      accentText: '#05070d',
      captionText: '#dfe5f3',
      captionHighlight: '#ffffff',
    },
    title: {
      sizeRatio: 0.056,
      fontWeight: '700',
      lineHeight: 1.26,
      letterSpacingEm: 0.0,
      uppercase: false,
      maxWidthRatio: 0.72,
    },
    caption: {
      sizeRatio: 0.04,
      fontWeight: '400',
      lineHeight: 1.38,
      bottomRatio: 0.1,
      background: 'rgba(3,5,12,0.55)',
    },
    captionBlockLines: 2 + 1.5 * 0.78 + 0.9,
    scrim: { solidRatio: 0, reachRatio: 0.62 },
    motion: {
      entryDurationFrames: 48,
      transitionDurationFrames: 34,
      amplitude: { zoom: 0.055, panOverscan: 1.07, drift: 0.035 },
    },
    progressBar: { visible: false, heightRatio: 0, color: 'transparent' },
  },
};
