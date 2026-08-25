import { AbsoluteFill, useVideoConfig } from 'remotion';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Keeps content clear of the edges, and of whatever the platform paints over
 * them.
 *
 * The insets depend on the shape of the frame, which is the whole reason this
 * is computed rather than declared. A vertical video published to the Shorts
 * feed has the channel name and description along the bottom and a column of
 * buttons down the right, and anything drawn under those is invisible. A 16:9
 * video on YouTube has no such furniture - only the scrubber along the bottom
 * edge - so the same generous right inset would just push the text into the
 * middle of the frame for no reason.
 *
 * Insets are fractions of the frame and are resolved to *pixels* here rather
 * than emitted as CSS percentages. That is not a style preference: percentage
 * padding resolves against the containing block's width, so at 9:16 a
 * `paddingTop: 12%` would actually inset 130px instead of 230px and quietly
 * push text into the very region this component exists to avoid.
 */
export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Vertical: leaves room for feed chrome on the bottom and right. */
export const PORTRAIT_SAFE_AREA: SafeAreaInsets = {
  top: 0.1,
  bottom: 0.16,
  left: 0.06,
  right: 0.18,
};

/** Horizontal: symmetric margins, with a little more at the bottom. */
export const LANDSCAPE_SAFE_AREA: SafeAreaInsets = {
  top: 0.08,
  bottom: 0.12,
  left: 0.07,
  right: 0.07,
};

export function safeAreaFor(width: number, height: number): SafeAreaInsets {
  return height > width ? PORTRAIT_SAFE_AREA : LANDSCAPE_SAFE_AREA;
}

export interface SafeAreaProps {
  children: ReactNode;
  style?: CSSProperties;
  /**
   * Skips the wider right inset. Use for full-width elements that carry no
   * reading matter, such as a scrim or a progress bar.
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
  const insets = safeAreaFor(width, height);

  return (
    <AbsoluteFill
      style={{
        paddingTop: height * insets.top,
        paddingBottom: height * (bottomInsetRatio ?? insets.bottom),
        paddingLeft: width * insets.left,
        paddingRight: width * (ignoreInteractionColumn ? insets.left : insets.right),
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
