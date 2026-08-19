import type { AnimationName } from '../../domain/scene';

/**
 * Animation presets (spec §24, §32).
 *
 * Spec §32 gives one flat whitelist, but the twelve names in it are really two
 * different things: some describe how the *image* moves (Ken Burns), the rest
 * describe how *content* enters. Rather than make Claude reason about that
 * distinction, one name drives both - the image motion is looked up here, and
 * anything that is not a camera move falls back to a gentle default drift so no
 * scene is ever completely static (which is what §24 is guarding against).
 */

export interface ImageMotion {
  /** Uniform scale. Always >= 1 so panning never exposes the frame edge. */
  scale: number;
  /** Horizontal offset as a fraction of frame width. */
  translateXRatio: number;
  /** Vertical offset as a fraction of frame height. */
  translateYRatio: number;
}

/**
 * How far the camera travels, as a fraction of the frame.
 *
 * These are per-theme rather than global because the right amount of movement
 * is a style decision, not a constant: a fast TikTok cut wants visible push-in,
 * while the minimal style is built around stillness.
 *
 * The original values (14% zoom, 6% pan) were far too timid. Spread across a
 * five to nine second scene that reads as a static photograph, which defeats
 * the point of Ken Burns in spec §24 - the whole reason it exists is to get
 * twenty-five seconds of video out of three still images.
 */
export interface MotionAmplitude {
  /** Extra scale at the end of a zoom, e.g. 0.3 means 1.0 -> 1.3. */
  zoom: number;
  /** Total overscan held during a pan; half of it is travelled each way. */
  panOverscan: number;
  /** Scale travel for animations that are not camera moves. */
  drift: number;
}

export const DEFAULT_AMPLITUDE: MotionAmplitude = {
  zoom: 0.18,
  panOverscan: 1.18,
  drift: 0.07,
};

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const STATIC: ImageMotion = { scale: 1, translateXRatio: 0, translateYRatio: 0 };

/**
 * Image transform for a scene at a given point in its life.
 *
 * @param animation whitelisted name chosen by Claude
 * @param progress  0 at the scene's first frame, 1 at its last
 */
export function getImageMotion(
  animation: AnimationName,
  progress: number,
  amplitude: MotionAmplitude = DEFAULT_AMPLITUDE,
): ImageMotion {
  const t = clamp01(progress);

  const zoomMin = 1;
  const zoomMax = 1 + amplitude.zoom;
  const panOverscan = amplitude.panOverscan;
  // Half the slack each way, so the visible edge never leaves the source.
  const panTravel = (panOverscan - 1) / 2;
  const driftMax = 1 + amplitude.drift;

  switch (animation) {
    case 'none':
      return STATIC;

    case 'zoom-in':
      return { scale: lerp(zoomMin, zoomMax, t), translateXRatio: 0, translateYRatio: 0 };

    case 'zoom-out':
      return { scale: lerp(zoomMax, zoomMin, t), translateXRatio: 0, translateYRatio: 0 };

    case 'pan-left':
      return { scale: panOverscan, translateXRatio: lerp(panTravel, -panTravel, t), translateYRatio: 0 };

    case 'pan-right':
      return { scale: panOverscan, translateXRatio: lerp(-panTravel, panTravel, t), translateYRatio: 0 };

    case 'pan-up':
      return { scale: panOverscan, translateXRatio: 0, translateYRatio: lerp(panTravel, -panTravel, t) };

    case 'pan-down':
      return { scale: panOverscan, translateXRatio: 0, translateYRatio: lerp(-panTravel, panTravel, t) };

    // Content-entry animations: the image itself just drifts.
    case 'fade':
    case 'spring':
    case 'slide-left':
    case 'slide-right':
    case 'slide-up':
      return { scale: lerp(1, driftMax, t), translateXRatio: 0, translateYRatio: 0 };
  }
}

export type ContentEntry = 'fade' | 'spring' | 'slide-left' | 'slide-right' | 'slide-up' | 'none';

/**
 * How the headline enters. Camera moves carry the motion themselves, so their
 * text just fades in rather than competing with the pan.
 */
export function getContentEntry(animation: AnimationName): ContentEntry {
  switch (animation) {
    case 'fade':
      return 'fade';
    case 'spring':
      return 'spring';
    case 'slide-left':
      return 'slide-left';
    case 'slide-right':
      return 'slide-right';
    case 'slide-up':
      return 'slide-up';
    case 'none':
      return 'none';
    default:
      return 'fade';
  }
}


function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
