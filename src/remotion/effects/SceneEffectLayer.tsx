import { AbsoluteFill } from 'remotion';
import type { ReactNode } from 'react';
import type { SceneEffect } from '../../domain/scene';

/**
 * Whole-frame treatments (`scene.effect`).
 *
 * There is exactly one, and that is the point. The short-form engine this grew
 * out of also offered a shake, a white flash and a zoom punch; all three are
 * impacts, and an impact in a video someone is falling asleep to is a defect
 * rather than an effect. They were removed from the whitelist rather than left
 * in place unused, because a value the model can choose is a value it will
 * eventually choose.
 *
 * `vignette` is static - it does not animate at all, which is why this layer
 * takes no frame and no duration. A corner darkening that moves would draw the
 * eye to the corners, which is the opposite of what it is for.
 */
export const SceneEffectLayer: React.FC<{
  effect: SceneEffect;
  children: ReactNode;
}> = ({ effect, children }) => {
  if (effect === 'none') return <AbsoluteFill>{children}</AbsoluteFill>;

  return (
    <AbsoluteFill>
      {children}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,0.55) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};
