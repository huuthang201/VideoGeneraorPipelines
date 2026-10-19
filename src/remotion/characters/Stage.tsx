import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { characterSvg, VIEWBOX, type Expression, type Mouth, type Pose } from './draw';
import { scenerySvg, type SceneryId } from './scenery';
import type { CharacterId } from './palette';

/**
 * The stage: a flat colour, and one or two characters standing on it.
 *
 * Deliberately not built on `SceneShell`. That shell exists to put type over a
 * photograph - scrim, camera move, licence credit, motion overlay - and a
 * cartoon scene has none of those things. Reusing it would mean a shell full of
 * conditionals for a pipeline that shares none of its problems, which is the
 * mistake `CaptionRenderer` already avoids by being two components rather than
 * one with a flag.
 */

/**
 * Three slots, not two.
 *
 * Two was the right cap for an explainer, where the whole performance is one
 * face at a time. This channel wants a crowd turning up, so the middle slot
 * exists - and it is the middle rather than a third one on the end, because
 * the frame is 1080 wide and a row of three has to stay centred on it.
 */
export type Position = 'trai' | 'giua' | 'phai';

export interface StagedCharacter {
  character: CharacterId;
  position: Position;
  pose: Pose;
  expression: Expression;
}

/**
 * How much of the frame's height a character fills.
 *
 * Two on stage have to sit side by side in 1080px without touching, and the
 * character box is 1000x1200 - so a single character can be much larger than
 * either of a pair. The difference is deliberate rather than incidental: a
 * character alone is usually delivering the hook, and it should feel closer.
 */
/*
 * Sized against the *drawing*, not against its box.
 *
 * The box is 1000x1200 but the animal only fills the middle ~70% of it - the
 * rest is the margin the tail swings into. Fitting two whole boxes inside 1080
 * therefore leaves the characters far smaller than the frame can carry, which
 * is what the first correction did: legal, centred, and lost in a sea of
 * background. The boxes are allowed to overlap; only the drawings must not.
 *
 *   0.32 -> 512px boxes, 1024 total. No overlap, and much too small.
 *   0.40 -> 640px boxes, 1280 total. Boxes overlap 200px, drawings clear by ~90.
 */
const HEIGHT_RATIO = { solo: 0.55, pair: 0.40, trio: 0.32 };

/**
 * Where the feet land, as a fraction of frame height.
 *
 * Low, and the space above is not waste: a 9:16 frame is far taller than a
 * character, the subtitle owns the bottom fifth, and what is left at the top is
 * where the scene's title goes. Standing the cast in the middle would leave dead
 * air above *and* below.
 */
const FLOOR_RATIO = 0.75;

/**
 * How far the silent character recedes.
 *
 * Small numbers on purpose. The listener has to stay legible - reacting while
 * the other one talks is half of what makes this read as a conversation - so
 * this is just enough to answer "who is speaking" at a glance on a muted play,
 * and not enough to push anyone into the background.
 */
const LISTENER = { scale: 0.94, brightness: 0.88 };

/**
 * Mouth shapes per second while speaking.
 *
 * Not lip sync. Real phoneme matching needs an aligner and buys very little at
 * this size; what sells a talking character is that the mouth moves *at all*
 * and stops when the line does. Seven a second is around the rate of Vietnamese
 * syllables and reads as speech rather than as chewing.
 */
const MOUTH_HZ = 7;
const MOUTH_CYCLE: Mouth[] = ['mo', 'hoi-mo', 'mo', 'dong'];

function mouthAt(frame: number, fps: number, speaking: boolean): Mouth | null {
  if (!speaking) return null;
  const step = Math.floor((frame / fps) * MOUTH_HZ);
  return MOUTH_CYCLE[step % MOUTH_CYCLE.length]!;
}

export const Stage: React.FC<{
  background: SceneryId;
  cast: readonly StagedCharacter[];
  /** Who is talking, or null for a beat with nobody speaking. */
  speaker: CharacterId | null;
}> = ({ background, cast, speaker }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const solo = cast.length === 1;
  const boxH =
    height * (solo ? HEIGHT_RATIO.solo : cast.length === 2 ? HEIGHT_RATIO.pair : HEIGHT_RATIO.trio);
  const boxW = (boxH / VIEWBOX.h) * VIEWBOX.w;

  return (
    <AbsoluteFill>
      <AbsoluteFill dangerouslySetInnerHTML={{ __html: scenerySvg(background) }} />
      {cast.map((c) => {
        const speaking = c.character === speaker;
        const centreX = solo
          ? width / 2
          : width * (c.position === 'trai' ? 0.22 : c.position === 'giua' ? 0.5 : 0.78);
        const depth = c.position === 'giua' && cast.length === 3 ? 0.92 : 1;
        const scale = (speaking ? 1 : LISTENER.scale) * depth;

        return (
          <div
            key={c.character}
            style={{
              position: 'absolute',
              width: boxW,
              height: boxH,
              left: centreX - boxW / 2,
              // The ground shadow sits near the bottom of the character box, so
              // aligning that to the floor is what puts the feet on the floor
              // rather than the box.
              top: height * FLOOR_RATIO - boxH * 0.91,
              transform: `scale(${scale})`,
              transformOrigin: 'bottom center',
              filter: speaking ? undefined : `brightness(${LISTENER.brightness})`,
            }}
            dangerouslySetInnerHTML={{
              __html: characterSvg({
                id: c.character,
                pose: c.pose,
                expression: c.expression,
                mouth: mouthAt(frame, fps, speaking),
                // Gradient ids must not collide when two characters share a frame.
                instance: c.position,
                fill: true,
              }),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
