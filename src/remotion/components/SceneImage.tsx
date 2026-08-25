import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import type { AnimationName, ImageFit } from '../../domain/scene';
import { computeFit, type FitBox } from '../layout/fit';
import { getImageMotion, type MotionAmplitude } from '../animations/presets';

export interface SceneImageProps {
  /** Path relative to the Remotion public dir. */
  src: string;
  /** Intrinsic source dimensions, measured by Sharp upstream. */
  width: number;
  height: number;
  fit: ImageFit;
  animation: AnimationName;
  /** Scene length, used to turn the current frame into 0..1 progress. */
  durationInFrames: number;
  frameWidth: number;
  frameHeight: number;
  backgroundColor: string;
  /** Theme-supplied camera travel. */
  amplitude: MotionAmplitude;
}

/**
 * Draws the environment image into the 9:16 frame without ever distorting it
 * (spec §22-23). This is the backdrop layer; the character is composited over
 * it by `CharacterLayer`.
 *
 * The geometry is computed by `computeFit`, which is a pure function with its
 * own tests - this component only turns that result into absolutely-positioned
 * boxes. Crucially it always sets explicit pixel width *and* height taken from
 * a single uniform scale factor, so there is no path by which the browser can
 * squash the image to fill a container.
 *
 * For square and landscape sources the frame is filled with a blurred,
 * cover-scaled copy of the same image and the sharp version is laid on top at
 * contain size, which keeps the whole scene visible without letterbox bars.
 */
export const SceneImage: React.FC<SceneImageProps> = ({
  src,
  width,
  height,
  fit,
  animation,
  durationInFrames,
  frameWidth,
  frameHeight,
  backgroundColor,
  amplitude,
}) => {
  const frame = useCurrentFrame();

  // Guard the single-frame case so progress is 0 rather than NaN.
  const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
  const motion = getImageMotion(animation, progress, amplitude);

  const { foreground, background } = computeFit(width, height, frameWidth, frameHeight, fit);
  const url = staticFile(src);

  const transform = [
    `translate(${motion.translateXRatio * frameWidth}px, ${motion.translateYRatio * frameHeight}px)`,
    `scale(${motion.scale})`,
  ].join(' ');

  return (
    <AbsoluteFill style={{ backgroundColor, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform, willChange: 'transform' }}>
        {background ? (
          <Img
            src={url}
            style={{
              ...boxStyle(background),
              filter: 'blur(48px) saturate(1.25) brightness(0.62)',
              // Overdraw slightly so the blur kernel does not sample past the
              // bitmap and feather the frame edges into the background colour.
              transform: 'scale(1.12)',
            }}
          />
        ) : null}
        <Img src={url} style={boxStyle(foreground)} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

function boxStyle(box: FitBox): React.CSSProperties {
  return {
    position: 'absolute',
    left: box.left,
    top: box.top,
    // Explicit pixels from one uniform scale - this pair is what guarantees the
    // aspect ratio survives. Never replace with percentages.
    width: box.width,
    height: box.height,
  };
}
