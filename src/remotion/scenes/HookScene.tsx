import { SafeArea } from '../components/SafeArea';
import { AnimatedText } from '../components/AnimatedText';
import { SceneShell, type SceneProps } from './SceneShell';

/**
 * Opening scene. The hook has roughly one second to earn the rest of the video,
 * so the headline is centred, set at full theme size, and given the heaviest
 * scrim of any scene - legibility beats subtlety here.
 */
export const HookScene: React.FC<SceneProps> = ({ scene, theme }) => {
  return (
    <SceneShell scene={scene} theme={theme} scrimPosition="full">
      <SafeArea style={{ justifyContent: 'center', alignItems: 'center' }}>
        <AnimatedText
          animation={scene.animation}
          theme={theme}
          style={{ textAlign: 'center', fontSize: theme.headline.fontSize * 1.08 }}
        >
          {scene.headline}
        </AnimatedText>
      </SafeArea>
    </SceneShell>
  );
};
