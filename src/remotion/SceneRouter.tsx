import type { TimelineScene } from '../domain/timeline';
import type { Theme } from './themes/theme';
import { IntroScene } from './scenes/IntroScene';
import { SegmentScene } from './scenes/SegmentScene';
import { OutroScene } from './scenes/OutroScene';

/**
 * Maps a scene type to its component.
 *
 * This is the enforcement point for "Claude never writes JSX": the model can
 * only emit a `type` string, and only the three listed below resolve to
 * anything. The switch is exhaustive over `SceneType`, so adding a type to the
 * domain without adding a component here is a compile error rather than a blank
 * frame discovered after a render.
 */
export const SceneRouter: React.FC<{ scene: TimelineScene; theme: Theme }> = ({ scene, theme }) => {
  switch (scene.type) {
    case 'intro':
      return <IntroScene scene={scene} theme={theme} />;
    case 'segment':
      return <SegmentScene scene={scene} theme={theme} />;
    case 'outro':
      return <OutroScene scene={scene} theme={theme} />;
  }
};
