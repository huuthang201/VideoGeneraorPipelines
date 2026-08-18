import { AbsoluteFill, useVideoConfig } from 'remotion';
import type { ReactNode } from 'react';
import type { TimelineScene } from '../../domain/timeline';
import type { Theme } from '../themes/theme';
import { ProductImage } from '../components/ProductImage';
import { CaptionRenderer } from '../components/CaptionRenderer';

export interface SceneProps {
  scene: TimelineScene;
  theme: Theme;
}

/**
 * Everything the four scene types share: the photo, a legibility scrim, and the
 * caption track. Each scene supplies only its own text layout as children.
 *
 * Keeping this in one place is what lets styles stay data (spec §33) - a new
 * look is a new Theme, not a new copy of this tree.
 */
export const SceneShell: React.FC<
  SceneProps & { children: ReactNode; scrimPosition?: 'bottom' | 'full' | 'top' }
> = ({ scene, theme, children, scrimPosition = 'bottom' }) => {
  const { width, height } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <ProductImage
        src={scene.image.src}
        width={scene.image.width}
        height={scene.image.height}
        fit={scene.image.fit}
        animation={scene.animation}
        durationInFrames={scene.durationInFrames}
        frameWidth={width}
        frameHeight={height}
        backgroundColor={theme.colors.background}
        amplitude={theme.motion.amplitude}
      />

      <AbsoluteFill style={{ background: scrimGradient(scrimPosition, theme.colors.scrim) }} />

      {children}

      <CaptionRenderer pages={scene.captionPages} theme={theme} />
    </AbsoluteFill>
  );
};

function scrimGradient(position: 'bottom' | 'full' | 'top', scrim: string): string {
  switch (position) {
    case 'full':
      return scrim;
    case 'top':
      return `linear-gradient(to bottom, ${scrim} 0%, transparent 55%)`;
    case 'bottom':
      return `linear-gradient(to top, ${scrim} 0%, transparent 55%)`;
  }
}
