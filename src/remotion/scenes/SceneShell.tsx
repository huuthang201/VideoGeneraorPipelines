import { AbsoluteFill, useVideoConfig } from 'remotion';
import type { ReactNode } from 'react';
import type { TimelineScene } from '../../domain/timeline';
import { preservedPhotoRegion, type Theme } from '../themes/theme';
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

  const background = scene.background;
  if (!background) {
    // Not defensive padding: `SceneRouter` sends stage scenes elsewhere, so
    // arriving here without a photograph means the routing is wrong. Failing
    // loudly beats a black frame discovered after a seven-minute render.
    throw new Error(
      `Scene "${scene.id}" has no background photograph. A drawn stage must be routed to the ` +
        'cartoon scene component, not to SceneShell.',
    );
  }

  /*
   * A photograph used by permission is shown exactly as published.
   *
   * No camera move, because a zoom is a crop that changes over time and a pan
   * shows part of the picture at once. No effect and no particles laid over it,
   * because a vignette or drifting dust is an edit to somebody else's
   * photograph. The fit is already `contain` - the timeline builder sees to
   * that - so the whole frame of their picture is on screen for the whole scene.
   *
   * Nor do the subtitle and the heading sit on it, or the scrim that darkens a
   * photograph for their sake: the picture is fitted into the frame above
   * them, and they read off the plain background below it. The scene types
   * move their heading there when this is set.
   */
  const preserve = background.preserve;
  const region = preserve
    ? preservedPhotoRegion(theme, width, height, {
        hasCaptions: scene.captionPages.length > 0,
        title: scene.title,
      })
    : undefined;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <SceneEffectLayer effect={preserve ? 'none' : scene.effect}>
        <SceneImage
          src={background.src}
          width={background.width}
          height={background.height}
          fit={background.fit}
          animation={preserve ? 'none' : scene.animation}
          durationInFrames={scene.durationInFrames}
          frameWidth={width}
          frameHeight={height}
          backgroundColor={theme.colors.background}
          amplitude={theme.motion.amplitude}
          region={region}
        />

        {!preserve && (
          <AbsoluteFill style={{ background: scrimGradient(scrimPosition, theme) }} />
        )}

        <MotionOverlay
          overlay={preserve ? 'none' : scene.overlay}
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
      <ImageCredit credit={background.credit} theme={theme} prominent={preserve} />

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
