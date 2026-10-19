import type { TimelineScene } from '../domain/timeline';
import type { Theme } from './themes/theme';
import { IntroScene } from './scenes/IntroScene';
import { SegmentScene } from './scenes/SegmentScene';
import { OutroScene } from './scenes/OutroScene';
import { CartoonScene } from './scenes/CartoonScene';

/**
 * Maps a scene to its component.
 *
 * This is the enforcement point for "Claude never writes JSX": the model can
 * only emit a `type` string, and only the ones listed below resolve to
 * anything. The switch is exhaustive over `SceneType`, so adding a type to the
 * domain without adding a component here is a compile error rather than a blank
 * frame discovered after a render.
 *
 * The stage check comes first and is not a special case bolted on: a scene
 * either was photographed or was drawn, and the two need different layer
 * stacks rather than one stack with conditionals in it. `intro`/`segment`/
 * `outro` still mean the same three things inside a drawn scene - they differ
 * in text layout, which the cartoon pipeline does not vary.
 */
export const SceneRouter: React.FC<{ scene: TimelineScene; theme: Theme }> = ({ scene, theme }) => {
  if (scene.stage) return <CartoonScene scene={scene} stage={scene.stage} theme={theme} />;

  switch (scene.type) {
    case 'intro':
      return <IntroScene scene={scene} theme={theme} />;
    case 'segment':
      return <SegmentScene scene={scene} theme={theme} />;
    case 'outro':
      return <OutroScene scene={scene} theme={theme} />;
  }
};
