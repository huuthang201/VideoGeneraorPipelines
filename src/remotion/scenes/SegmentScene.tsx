import { SafeArea } from '../components/SafeArea';
import { AnimatedText } from '../components/AnimatedText';
import { SceneShell, type SceneProps } from './SceneShell';
import { contentBottomInsetRatio } from '../themes/theme';

/**
 * The workhorse beat, and most of the video.
 *
 * The title sits low and left, above the caption band, so the photograph keeps
 * the frame. An empty title is not merely legal here but the norm: the subtitle
 * is already carrying the words, and a heading on every four-second scene turns
 * the video into a slide deck. The storyboard says so by leaving the string
 * empty.
 */
export const SegmentScene: React.FC<SceneProps> = ({ scene, theme }) => (
  <SceneShell scene={scene} theme={theme} scrimPosition="bottom">
    <SafeArea
      style={{ justifyContent: 'flex-end', alignItems: 'flex-start' }}
      bottomInsetRatio={contentBottomInsetRatio(theme, scene.captionPages.length > 0)}
    >
      {scene.title ? (
        <AnimatedText theme={theme} style={{ textAlign: 'left' }}>
          {scene.title}
        </AnimatedText>
      ) : null}
    </SafeArea>
  </SceneShell>
);
