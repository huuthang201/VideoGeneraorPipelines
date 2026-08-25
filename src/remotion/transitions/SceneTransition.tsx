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
 * Instead each scene plays for exactly its allotted frames and fades itself in
 * over the first second or so. Not a true crossfade - the previous scene is
 * already gone - so the incoming picture rises out of the theme's background
 * colour rather than out of the last photograph. At this pace that reads as a
 * considered dissolve rather than as a missing frame, and it keeps audio sync
 * provable rather than approximate.
 */
export const SceneTransition: React.FC<{
  transition: TransitionName;
  theme: Theme;
  isFirst: boolean;
  children: ReactNode;
}> = ({ transition, theme, isFirst, children }) => {
  const frame = useCurrentFrame();

  // The opening scene has nothing to transition from - but it does fade up from
  // black, because an episode that starts on a fully lit frame at frame zero
  // feels like it started without you.
  if (transition === 'cut' && !isFirst) {
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }

  const duration = theme.motion.transitionDurationFrames;
  const opacity = interpolate(frame, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};
