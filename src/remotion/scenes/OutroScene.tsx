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
      style={
        // Under a photograph shown as published, the heading goes where a
        // segment's does - below the picture, in the room left for it there.
        // Centred, it would sit on the middle of somebody else's photograph
        // with no scrim behind it.
        scene.background?.preserve
          ? { justifyContent: 'flex-end', alignItems: 'flex-start' }
          : { justifyContent: 'center', alignItems: 'center' }
      }
      bottomInsetRatio={contentBottomInsetRatio(theme, scene.captionPages.length > 0)}
    >
      {scene.title ? (
        <AnimatedText
          theme={theme}
          style={{
            textAlign: scene.background?.preserve ? 'left' : 'center',
            color: theme.colors.accent,
          }}
        >
          {scene.title}
        </AnimatedText>
      ) : null}
    </SafeArea>
  </SceneShell>
);
