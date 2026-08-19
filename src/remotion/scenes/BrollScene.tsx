import { AbsoluteFill, useVideoConfig } from 'remotion';
import { SafeArea } from '../components/SafeArea';
import { AnimatedText } from '../components/AnimatedText';
import { SceneShell, type SceneProps } from './SceneShell';
import { contentBottomInsetRatio } from '../themes/theme';

/**
 * A generated establishing shot.
 *
 * Visually it is deliberately a little different from the product scenes: the
 * image is cinematic context rather than the thing being sold, so it carries a
 * heavier scrim and lighter, smaller type. That is partly taste and partly
 * honesty - a b-roll frame should read as mood, not as a product photograph.
 *
 * A generated image is always 9:16 by construction, so `cover` is exact and no
 * blur-pad backdrop is ever needed.
 */
export const BrollScene: React.FC<SceneProps> = ({ scene, theme }) => {
  const { height } = useVideoConfig();

  return (
    <SceneShell scene={scene} theme={theme} scrimPosition="bottom">
      <SafeArea
        style={{ justifyContent: 'flex-end', alignItems: 'flex-start' }}
        bottomInsetRatio={contentBottomInsetRatio(theme, scene.captionPages.length > 0)}
      >
        {scene.headline ? (
          <AnimatedText
            animation={scene.animation}
            theme={theme}
            style={{
              fontSize: theme.headline.fontSize * 0.72,
              fontWeight: '400',
              textTransform: 'none',
              opacity: 0.95,
            }}
          >
            {scene.headline}
          </AnimatedText>
        ) : null}
      </SafeArea>

      {/*
        A hairline of the accent colour along the bottom. Subtle, but it gives
        the eye a consistent cue that this beat is scene-setting rather than a
        look at the product.
      */}
      <AbsoluteFill style={{ justifyContent: 'flex-end' }}>
        <div style={{ height: Math.max(2, height * 0.002), backgroundColor: theme.colors.accent, opacity: 0.5 }} />
      </AbsoluteFill>
    </SceneShell>
  );
};
