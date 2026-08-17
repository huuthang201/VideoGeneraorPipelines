import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import type { ReactNode } from 'react';
import type { TransitionName } from '../../domain/scene';
import type { Theme } from '../themes/theme';

/**
 * Scene entry transitions.
 *
 * These are deliberately *not* built on TransitionSeries. A real transition
 * consumes timeline time by overlapping two scenes, which would break the
 * invariant the whole design rests on: that `scene.from` is the exact running
 * sum of preceding durations, so caption timings stay aligned with the audio.
 *
 * Instead each scene plays for exactly its allotted frames and simply animates
 * itself in over the first few. Slightly less cinematic than a true crossfade,
 * and worth it to keep audio sync provable rather than approximate.
 */
export const SceneTransition: React.FC<{
  transition: TransitionName;
  theme: Theme;
  isFirst: boolean;
  children: ReactNode;
}> = ({ transition, theme, isFirst, children }) => {
  const frame = useCurrentFrame();

  // The opening scene has nothing to transition from.
  if (isFirst || transition === 'cut') {
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }

  const duration = theme.motion.transitionDurationFrames;
  const t = interpolate(frame, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const style = ((): React.CSSProperties => {
    switch (transition) {
      case 'fade':
        return { opacity: t };
      case 'slide':
        return { transform: `translateX(${(1 - t) * 100}%)` };
      case 'whoosh':
        return {
          opacity: Math.min(1, t * 1.6),
          transform: `translateX(${(1 - t) * 42}%) scale(${1.06 - t * 0.06})`,
        };
      default:
        return {};
    }
  })();

  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};
