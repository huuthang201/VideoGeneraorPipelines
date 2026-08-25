import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../themes/theme';

/**
 * Thin progress line across the top of the frame.
 *
 * It does a different job at this length than it did at ten minutes. Nobody
 * needs to know how much of a forty-second video is left - but a line visibly
 * moving towards the end of the frame is the cheapest possible signal that the
 * video is nearly over and there is a payoff coming, which is exactly the
 * moment a viewer decides whether to keep watching or swipe.
 */
export const ProgressBar: React.FC<{ theme: Theme }> = ({ theme }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();

  if (!theme.progressBar.visible) return null;

  const progress = durationInFrames > 0 ? Math.min(1, frame / durationInFrames) : 0;

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start' }}>
      <div
        style={{
          width: `${progress * 100}%`,
          height: Math.max(1, Math.min(width, height) * theme.progressBar.heightRatio),
          backgroundColor: theme.progressBar.color,
        }}
      />
    </AbsoluteFill>
  );
};
