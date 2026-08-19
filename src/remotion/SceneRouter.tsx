import type { TimelineScene } from '../domain/timeline';
import type { Theme } from './themes/theme';
import { HookScene } from './scenes/HookScene';
import { ProductScene } from './scenes/ProductScene';
import { FeatureScene } from './scenes/FeatureScene';
import { CTAScene } from './scenes/CTAScene';
import { BrollScene } from './scenes/BrollScene';

/**
 * Maps a scene type to its component (spec §31).
 *
 * This is the enforcement point for "Claude never writes JSX" (spec §59): the
 * model can only emit a `type` string, and only the four listed below resolve
 * to anything. The switch is exhaustive over `SceneType`, so adding a type to
 * the domain without adding a component here is a compile error rather than a
 * blank frame discovered after a render.
 */
export const SceneRouter: React.FC<{ scene: TimelineScene; theme: Theme }> = ({ scene, theme }) => {
  switch (scene.type) {
    case 'hook':
      return <HookScene scene={scene} theme={theme} />;
    case 'product':
      return <ProductScene scene={scene} theme={theme} />;
    case 'feature':
      return <FeatureScene scene={scene} theme={theme} />;
    case 'cta':
      return <CTAScene scene={scene} theme={theme} />;
    case 'broll':
      return <BrollScene scene={scene} theme={theme} />;
  }
};
