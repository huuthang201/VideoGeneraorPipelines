import { SafeArea } from '../components/SafeArea';
import { AnimatedText } from '../components/AnimatedText';
import { SceneShell, type SceneProps } from './SceneShell';
import { contentBottomInsetRatio } from '../themes/theme';

/**
 * General product shot. Text sits low and small so the photo carries the frame.
 *
 * An empty headline is legal and renders as a clean image-only beat - this is
 * what spec §30's separate `ImageScene` amounts to, so it needs no second type.
 */
export const ProductScene: React.FC<SceneProps> = ({ scene, theme }) => {
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
            style={{ fontSize: theme.headline.fontSize * 0.82 }}
          >
            {scene.headline}
          </AnimatedText>
        ) : null}
      </SafeArea>
    </SceneShell>
  );
};
