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

/** Zoom endpoints. Small on purpose - a heavy zoom reads as cheap. */
const ZOOM_MIN = 1.0;
const ZOOM_MAX = 1.14;

/**
 * Pans hold a constant overscan so there is material to slide into view. The
 * travel distance is derived from it: at 1.12x there is 12% of slack, and using
 * half of that each way keeps the visible edge comfortably inside the source.
 */
const PAN_OVERSCAN = 1.12;
const PAN_TRAVEL = (PAN_OVERSCAN - 1) / 2;

/** Applied to non-camera animations so every scene keeps some life. */
const DRIFT_MIN = 1.0;
const DRIFT_MAX = 1.05;

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const STATIC: ImageMotion = { scale: 1, translateXRatio: 0, translateYRatio: 0 };

/**
 * Image transform for a scene at a given point in its life.
 *
 * @param animation whitelisted name chosen by Claude
 * @param progress  0 at the scene's first frame, 1 at its last
 */
export function getImageMotion(animation: AnimationName, progress: number): ImageMotion {
  const t = clamp01(progress);

  switch (animation) {
    case 'none':
      return STATIC;

    case 'zoom-in':
      return { scale: lerp(ZOOM_MIN, ZOOM_MAX, t), translateXRatio: 0, translateYRatio: 0 };

    case 'zoom-out':
      return { scale: lerp(ZOOM_MAX, ZOOM_MIN, t), translateXRatio: 0, translateYRatio: 0 };

    case 'pan-left':
      return { scale: PAN_OVERSCAN, translateXRatio: lerp(PAN_TRAVEL, -PAN_TRAVEL, t), translateYRatio: 0 };

    case 'pan-right':
      return { scale: PAN_OVERSCAN, translateXRatio: lerp(-PAN_TRAVEL, PAN_TRAVEL, t), translateYRatio: 0 };

    case 'pan-up':
      return { scale: PAN_OVERSCAN, translateXRatio: 0, translateYRatio: lerp(PAN_TRAVEL, -PAN_TRAVEL, t) };

    case 'pan-down':
      return { scale: PAN_OVERSCAN, translateXRatio: 0, translateYRatio: lerp(-PAN_TRAVEL, PAN_TRAVEL, t) };

    // Content-entry animations: the image itself just drifts.
    case 'fade':
    case 'spring':
    case 'slide-left':
    case 'slide-right':
    case 'slide-up':
      return { scale: lerp(DRIFT_MIN, DRIFT_MAX, t), translateXRatio: 0, translateYRatio: 0 };
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

/** True when the animation needs overscan to avoid showing frame edges. */
export function requiresOverscan(animation: AnimationName): boolean {
  return animation.startsWith('pan-');
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
