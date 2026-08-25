import type { AnimationName } from '../../domain/scene';

/**
 * Ken Burns presets.
 *
 * Every scene is a still photograph held for seconds or for half a minute, so
 * this file is the entire reason the result reads as a video rather than as a
 * slideshow. It is also the reason it can read as *restless*, which is why the
 * amplitudes are not here: they come from the theme (see MotionAmplitude), and
 * they are sized to the scene length.
 *
 * That sizing is the sharpest difference between the two theme packs. A move
 * has to complete its travel inside the scene to be felt at all, so the fact
 * pack's amplitudes are several times the podcast pack's - and the podcast
 * pack's are small on purpose, because a move that is obvious over three
 * seconds is intrusive over thirty.
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
 * Per theme rather than global because the right amount of movement is both a
 * style decision and a format one: within a pack the night theme moves least
 * and the daylight one most, and across the packs a four-second scene has to
 * travel several times as far as a thirty-second one.
 */
export interface MotionAmplitude {
  /** Extra scale at the end of a zoom, e.g. 0.08 means 1.0 -> 1.08. */
  zoom: number;
  /** Total overscan held during a pan; half of it is travelled each way. */
  panOverscan: number;
  /** Scale travel for `drift`, the almost-imperceptible default. */
  drift: number;
}

/**
 * Fallback only, for a caller that has no theme to hand.
 *
 * Every real render passes the amplitude from its theme pack, so this value is
 * never what a finished video moves by. It is set to the fact pack's numbers
 * because a too-large move is obvious the moment anyone looks, where a
 * too-small one silently reads as a frozen frame.
 */
export const DEFAULT_AMPLITUDE: MotionAmplitude = {
  zoom: 0.22,
  panOverscan: 1.24,
  drift: 0.12,
};

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const STATIC: ImageMotion = { scale: 1, translateXRatio: 0, translateYRatio: 0 };

/**
 * Eases the ends of a move so it does not start and stop abruptly.
 *
 * A linear pan is visible precisely at its two ends, where the picture goes
 * from still to moving in one frame. Smoothstep costs nothing and removes the
 * only two moments a viewer would have noticed the camera at all.
 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

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
  const t = smoothstep(clamp01(progress));

  const zoomMin = 1;
  const zoomMax = 1 + amplitude.zoom;
  const panOverscan = amplitude.panOverscan;
  // Half the slack each way, so the visible edge never leaves the source.
  const panTravel = (panOverscan - 1) / 2;

  switch (animation) {
    case 'none':
      return STATIC;

    case 'drift':
      return { scale: lerp(1, 1 + amplitude.drift, t), translateXRatio: 0, translateYRatio: 0 };

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
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
