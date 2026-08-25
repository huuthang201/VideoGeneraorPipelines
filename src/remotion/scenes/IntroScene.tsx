import { SafeArea } from '../components/SafeArea';
import { AnimatedText } from '../components/AnimatedText';
import { SceneShell, type SceneProps } from './SceneShell';
import { contentBottomInsetRatio } from '../themes/theme';

/**
 * The opening scene.
 *
 * The title is centred and the scrim covers the whole frame, which is the one
 * moment in the video where the picture is deliberately backed off. This frame
 * carries the hook, and the hook has about two seconds to be read - by someone
 * who may well have the sound off - before they decide whether to stay.
 */
export const IntroScene: React.FC<SceneProps> = ({ scene, theme }) => (
  <SceneShell scene={scene} theme={theme} scrimPosition="full">
    <SafeArea
      style={{ justifyContent: 'center', alignItems: 'center' }}
      bottomInsetRatio={contentBottomInsetRatio(theme, scene.captionPages.length > 0)}
    >
      {scene.title ? (
        <AnimatedText theme={theme} style={{ textAlign: 'center' }}>
          {scene.title}
        </AnimatedText>
      ) : null}
    </SafeArea>
  </SceneShell>
);
