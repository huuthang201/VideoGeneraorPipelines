import { AbsoluteFill, useVideoConfig } from 'remotion';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Keeps content clear of platform chrome (spec §19).
 *
 * TikTok and Shorts both paint their own UI over the video: a caption/handle
 * block along the bottom, a column of like/comment/share buttons down the right,
 * and status/back affordances at the top. Anything we draw underneath those is
 * effectively invisible, so every text layer renders inside this box.
 *
 * Insets are fractions of the frame and are resolved to *pixels* here rather
 * than emitted as CSS percentages. That is not a style preference: percentage
 * padding resolves against the containing block's width, so at 9:16 a
 * `paddingTop: 12%` would actually inset 130px instead of 230px and quietly
 * push text into the very region this component exists to avoid.
 */
export const SAFE_AREA = {
  top: 0.12,
  bottom: 0.18,
  /** Widest inset - this is the interaction button column. */
  right: 0.2,
  left: 0.06,
} as const;

export interface SafeAreaProps {
  children: ReactNode;
  style?: CSSProperties;
  /**
   * Skips the right inset. Use for full-width elements that carry no reading
   * matter, such as a scrim or a progress bar.
   */
  ignoreInteractionColumn?: boolean;
  /**
   * Overrides the bottom inset, as a fraction of frame height. Bottom-aligned
   * scenes use this to reserve the caption band - see `contentBottomInsetRatio`.
   */
  bottomInsetRatio?: number;
}

export const SafeArea: React.FC<SafeAreaProps> = ({
  children,
  style,
  ignoreInteractionColumn = false,
  bottomInsetRatio,
}) => {
  const { width, height } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        paddingTop: height * SAFE_AREA.top,
        paddingBottom: height * (bottomInsetRatio ?? SAFE_AREA.bottom),
        paddingLeft: width * SAFE_AREA.left,
        paddingRight: width * (ignoreInteractionColumn ? SAFE_AREA.left : SAFE_AREA.right),
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

