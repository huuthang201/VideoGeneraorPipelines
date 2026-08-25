import { SafeArea } from '../components/SafeArea';
import { AnimatedText } from '../components/AnimatedText';
import { SceneShell, type SceneProps } from './SceneShell';
import { contentBottomInsetRatio } from '../themes/theme';

/**
 * The closing scene.
 *
 * Centred like the intro and set in the accent colour, so the video ends on a
 * frame that is visibly a bookend rather than one more segment. No pill, no
 * button, nothing asking for a like: whatever the outro says, it says it in the
 * narration, and this format is watched by people who scroll past anything that
 * looks like a request.
 */
export const OutroScene: React.FC<SceneProps> = ({ scene, theme }) => (
  <SceneShell scene={scene} theme={theme} scrimPosition="full">
    <SafeArea
      style={{ justifyContent: 'center', alignItems: 'center' }}
      bottomInsetRatio={contentBottomInsetRatio(theme, scene.captionPages.length > 0)}
    >
      {scene.title ? (
        <AnimatedText
          theme={theme}
          style={{ textAlign: 'center', color: theme.colors.accent }}
        >
          {scene.title}
        </AnimatedText>
      ) : null}
    </SafeArea>
  </SceneShell>
);
