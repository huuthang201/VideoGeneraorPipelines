import { SafeArea } from '../components/SafeArea';
import { AnimatedText } from '../components/AnimatedText';
import { SceneShell, type SceneProps } from './SceneShell';
import { contentBottomInsetRatio } from '../themes/theme';
import { FONT_STACK } from '../fonts';

/**
 * A single selling point. The headline gets an accent rule beside it so
 * consecutive feature scenes read as a list rather than as repeated captions.
 */
export const FeatureScene: React.FC<SceneProps> = ({ scene, theme }) => {
  return (
    <SceneShell scene={scene} theme={theme} scrimPosition="bottom">
      <SafeArea
        style={{ justifyContent: 'flex-end', alignItems: 'flex-start' }}
        bottomInsetRatio={contentBottomInsetRatio(theme, scene.captionPages.length > 0)}
      >
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 28 }}>
          <div
            style={{
              width: 10,
              borderRadius: 5,
              backgroundColor: theme.colors.accent,
              flexShrink: 0,
            }}
          />
          <AnimatedText
            animation={scene.animation}
            theme={theme}
            style={{ fontFamily: FONT_STACK, fontSize: theme.headline.fontSize * 0.9 }}
          >
            {scene.headline}
          </AnimatedText>
        </div>
      </SafeArea>
    </SceneShell>
  );
};
