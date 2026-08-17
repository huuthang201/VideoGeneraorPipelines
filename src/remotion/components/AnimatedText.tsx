import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CSSProperties, ReactNode } from 'react';
import type { AnimationName } from '../../domain/scene';
import { getContentEntry } from '../animations/presets';
import type { Theme } from '../themes/theme';
import { FONT_STACK } from '../fonts';

export interface AnimatedTextProps {
  children: ReactNode;
  animation: AnimationName;
  theme: Theme;
  /** Frames to wait before the entry begins - used to stagger stacked lines. */
  delayFrames?: number;
  style?: CSSProperties;
}

/**
 * Headline text with a themed entry animation.
 *
 * The entry style comes from `getContentEntry`, which deliberately collapses
 * camera moves down to a plain fade: when the image is already panning, sliding
 * the text as well makes the frame feel busy rather than dynamic.
 */
export const AnimatedText: React.FC<AnimatedTextProps> = ({
  children,
  animation,
  theme,
  delayFrames = 0,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entry = getContentEntry(animation);
  const local = frame - delayFrames;

  const duration = theme.motion.entryDurationFrames;
  const linear = interpolate(local, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const springValue = spring({
    frame: local,
    fps,
    config: { damping: theme.motion.springDamping, stiffness: theme.motion.springStiffness },
  });

  const { opacity, transform } = entryStyle(entry, linear, springValue);

  return (
    <div
      style={{
        opacity,
        transform,
        fontFamily: FONT_STACK,
        color: theme.colors.text,
        fontSize: theme.headline.fontSize,
        fontWeight: theme.headline.fontWeight,
        lineHeight: theme.headline.lineHeight,
        letterSpacing: theme.headline.letterSpacing,
        textTransform: theme.headline.uppercase ? 'uppercase' : 'none',
        maxWidth: `${theme.headline.maxWidthRatio * 100}%`,
        // Product photos are unpredictable; a soft shadow keeps white type
        // readable over a light background without needing a full scrim.
        textShadow: '0 4px 24px rgba(0,0,0,0.55)',
        ...style,
      }}
    >
      {children}
    </div>
  );
};

function entryStyle(
  entry: ReturnType<typeof getContentEntry>,
  linear: number,
  springValue: number,
): { opacity: number; transform: string } {
  const travel = 64;

  switch (entry) {
    case 'none':
      return { opacity: 1, transform: 'none' };
    case 'fade':
      return { opacity: linear, transform: 'none' };
    case 'spring':
      return { opacity: linear, transform: `scale(${0.86 + springValue * 0.14})` };
    case 'slide-left':
      return { opacity: linear, transform: `translateX(${(1 - springValue) * travel}px)` };
    case 'slide-right':
      return { opacity: linear, transform: `translateX(${(1 - springValue) * -travel}px)` };
    case 'slide-up':
      return { opacity: linear, transform: `translateY(${(1 - springValue) * travel}px)` };
  }
}
