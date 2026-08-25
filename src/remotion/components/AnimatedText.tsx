import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CSSProperties, ReactNode } from 'react';
import type { Theme } from '../themes/theme';
import { FONT_STACK } from '../fonts';

export interface AnimatedTextProps {
  children: ReactNode;
  theme: Theme;
  /** Frames to wait before the entry begins - used to stagger stacked lines. */
  delayFrames?: number;
  style?: CSSProperties;
}

/**
 * A scene's on-screen title.
 *
 * Set larger than the subtitle and with an accent rule beside it. Both exist
 * for the same reason: the subtitle is now bold too, so a title that differs
 * from it only in weight does not read as a title - it reads as a caption that
 * happens to be bigger. The rule also gives the block a left edge to sit
 * against, which is what stops bottom-left text from looking dropped rather
 * than placed.
 *
 * One entry, everywhere: a short fade with a few pixels of upward travel, over
 * about a third of a second. Springs, slides and pops are not in the
 * vocabulary at all - not because they would be too loud for the format, but
 * because they would fight the camera move underneath and the subtitle beside
 * them, and a title in this frame is the third most important thing in it.
 *
 * The travel is a fraction of the type size rather than a pixel count, so it
 * stays proportionate in either frame shape.
 */
export const AnimatedText: React.FC<AnimatedTextProps> = ({
  children,
  theme,
  delayFrames = 0,
  style,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const local = frame - delayFrames;

  const fontSize = Math.min(width, height) * theme.title.sizeRatio;
  const duration = theme.motion.entryDurationFrames;

  const progress = interpolate(local, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const rule = style?.textAlign === 'center' ? null : (
    <div
      style={{
        width: Math.max(2, fontSize * 0.055),
        alignSelf: 'stretch',
        borderRadius: fontSize,
        backgroundColor: theme.colors.accent,
        // Grows into place with the text rather than being there first.
        transform: `scaleY(${progress})`,
        transformOrigin: 'bottom',
        flexShrink: 0,
      }}
    />
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: fontSize * 0.42,
        opacity: progress,
        transform: `translateY(${(1 - progress) * fontSize * 0.35}px)`,
        maxWidth: `${theme.title.maxWidthRatio * 100}%`,
      }}
    >
      {rule}
      <div
        style={{
          fontFamily: FONT_STACK,
          color: theme.colors.text,
          fontSize,
          fontWeight: theme.title.fontWeight,
          lineHeight: theme.title.lineHeight,
          letterSpacing: `${theme.title.letterSpacingEm}em`,
          textTransform: theme.title.uppercase ? 'uppercase' : 'none',
          // Photographs are unpredictable; a soft shadow keeps light type
          // readable over a light sky without needing a heavier scrim.
          textShadow: '0 4px 28px rgba(0,0,0,0.55)',
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  );
};
