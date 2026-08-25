import { AbsoluteFill, useVideoConfig } from 'remotion';
import type { ReactNode } from 'react';
import type { TimelineScene } from '../../domain/timeline';
import type { Theme } from '../themes/theme';
import { SceneImage } from '../components/SceneImage';
import { CaptionRenderer } from '../components/CaptionRenderer';
import { ImageCredit } from '../components/ImageCredit';
import { SceneEffectLayer } from '../effects/SceneEffectLayer';
import { MotionOverlay } from '../effects/MotionOverlay';

export interface SceneProps {
  scene: TimelineScene;
  theme: Theme;
}

/**
 * Everything the three scene types share, stacked in a fixed order:
 *
 *   backdrop -> scrim -> motion overlay -> photo credit -> title -> captions
 *
 * The order is the design. The scrim sits over the photograph and under the
 * text, which is what lets light type stay readable over a bright sky without
 * dimming the picture so far that it stops being worth looking at. The motion
 * overlay goes *above* the scrim rather than below it - dust dimmed by 40% of
 * black is dust nobody can see - and below the type, so nothing drifts across a
 * word being read. Each scene type supplies only its own text layout as
 * children.
 *
 * Keeping this in one place is what lets styles stay data - a new look is a new
 * Theme, not a new copy of this tree.
 */
export const SceneShell: React.FC<
  SceneProps & { children: ReactNode; scrimPosition?: 'bottom' | 'full' }
> = ({ scene, theme, children, scrimPosition = 'bottom' }) => {
  const { width, height } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <SceneEffectLayer effect={scene.effect}>
        <SceneImage
          src={scene.background.src}
          width={scene.background.width}
          height={scene.background.height}
          fit={scene.background.fit}
          animation={scene.animation}
          durationInFrames={scene.durationInFrames}
          frameWidth={width}
          frameHeight={height}
          backgroundColor={theme.colors.background}
          amplitude={theme.motion.amplitude}
        />

        <AbsoluteFill style={{ background: scrimGradient(scrimPosition, theme) }} />

        <MotionOverlay
          overlay={scene.overlay}
          durationInFrames={scene.durationInFrames}
          theme={theme}
          // The scene's own position in the episode, so two scenes sharing an
          // overlay do not share a particle layout.
          seed={scene.from + scene.id.length}
        />
      </SceneEffectLayer>

      {/*
        Above the scrim and the overlay so it stays legible, below the text so
        it can never sit on top of a word being read. It is a licence condition
        rather than decoration - see ImageCredit.
      */}
      <ImageCredit credit={scene.background.credit} theme={theme} />

      {children}

      <CaptionRenderer pages={scene.captionPages} theme={theme} />
    </AbsoluteFill>
  );
};

/**
 * How far the scrim reaches is a theme value, not a constant.
 *
 * It has to cover wherever the subtitle sits plus the lines it wraps to, and
 * the two theme packs put the subtitle in very different places - see
 * `Theme.scrim`.
 */
function scrimGradient(position: 'bottom' | 'full', theme: Theme): string {
  const scrim = theme.colors.scrim;
  if (position === 'full') return scrim;
  const solid = Math.round(theme.scrim.solidRatio * 100);
  const reach = Math.round(theme.scrim.reachRatio * 100);
  return solid > 0
    ? `linear-gradient(to top, ${scrim} 0%, ${scrim} ${solid}%, transparent ${reach}%)`
    : `linear-gradient(to top, ${scrim} 0%, transparent ${reach}%)`;
}
