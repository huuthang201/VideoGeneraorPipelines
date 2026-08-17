import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../themes/theme';

/**
 * Thin progress indicator across the top of the frame.
 *
 * Rendered at the composition level rather than per scene, so it reflects the
 * whole video's progress. Hidden entirely in the `minimal` theme.
 */
export const ProgressBar: React.FC<{ theme: Theme }> = ({ theme }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  if (!theme.progressBar.visible) return null;

  const progress = durationInFrames > 0 ? Math.min(1, frame / durationInFrames) : 0;

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start' }}>
      <div
        style={{
          width: `${progress * 100}%`,
          height: theme.progressBar.height,
          backgroundColor: theme.progressBar.color,
        }}
      />
    </AbsoluteFill>
  );
};
