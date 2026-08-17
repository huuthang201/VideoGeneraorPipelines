import { SafeArea } from '../components/SafeArea';
import { AnimatedText } from '../components/AnimatedText';
import { SceneShell, type SceneProps } from './SceneShell';

/**
 * Closing call to action. The headline sits on a solid accent pill rather than
 * over bare photo - this is the one frame that has to be unmissable, and it is
 * also the frame most likely to be paused on.
 */
export const CTAScene: React.FC<SceneProps> = ({ scene, theme }) => {
  return (
    <SceneShell scene={scene} theme={theme} scrimPosition="full">
      <SafeArea style={{ justifyContent: 'center', alignItems: 'center' }}>
        <AnimatedText
          animation={scene.animation}
          theme={theme}
          style={{
            textAlign: 'center',
            backgroundColor: theme.colors.accent,
            color: theme.colors.accentText,
            padding: '0.32em 0.6em',
            borderRadius: 28,
            fontSize: theme.headline.fontSize * 0.78,
            textShadow: 'none',
          }}
        >
          {scene.headline}
        </AnimatedText>
      </SafeArea>
    </SceneShell>
  );
};
