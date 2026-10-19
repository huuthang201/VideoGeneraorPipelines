import { AbsoluteFill, Audio, staticFile } from 'remotion';
import type { TimelineScene, TimelineStage } from '../../domain/timeline';
import type { Theme } from '../themes/theme';
import { Stage, type StagedCharacter } from '../characters/Stage';
import { CaptionRenderer } from '../components/CaptionRenderer';
import type { SceneryId } from '../characters/scenery';
import type { CharacterId } from '../characters/palette';

/**
 * A scene that was drawn rather than photographed.
 *
 * Three of the six layers `SceneShell` stacks do not exist here, and that is
 * why this is a separate component rather than a flag inside that one. There is
 * no scrim, because nothing needs rescuing from a bright sky - the backdrop was
 * drawn dim on purpose. There is no photo credit, because nobody took the
 * photograph. And there is no camera move, because a drawn backdrop panned
 * across reveals that it is four shapes.
 *
 * What is left is the stage, one optional sound effect, and the subtitle.
 */
export const CartoonScene: React.FC<{
  scene: TimelineScene;
  stage: TimelineStage;
  theme: Theme;
}> = ({ scene, stage, theme }) => (
  <AbsoluteFill>
    <Stage
      background={stage.scenery as SceneryId}
      cast={stage.cast as StagedCharacter[]}
      speaker={(stage.speaker as CharacterId | null) ?? null}
    />
    {/*
      Plays from the first frame of the scene, because the scene is already the
      unit of comic timing: the cut and the sound land together, which is what a
      rimshot is. Anything finer would need the model to place a sound inside a
      line, and it has no way to know where the line falls in time.
    */}
    {scene.sfxSrc ? <Audio src={staticFile(scene.sfxSrc)} volume={0.7} /> : null}

    <CaptionRenderer pages={scene.captionPages} theme={theme} />
  </AbsoluteFill>
);
