import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { SceneOverlay } from '../../domain/scene';
import type { Theme } from '../themes/theme';

/**
 * Moving elements drawn over the photograph.
 *
 * Every backdrop is a still, and a slow camera move alone starts to read as a
 * slideshow somewhere around the third minute. These layers give the frame
 * something that is genuinely in motion - specks drifting, light travelling -
 * while staying under the threshold where a viewer would look *at* them instead
 * of at the picture.
 *
 * ## Deterministic, not random
 *
 * Nothing here calls Math.random(). Positions come from `hash`, a small integer
 * mixer seeded by the particle's index, so the same storyboard renders the same
 * frames every time. A render that looked different on every run would break
 * the promise the whole engine is built on, and the difference would be
 * invisible in review and obvious in a re-render three weeks later.
 *
 * ## Why everything is expressed in fractions
 *
 * Sizes and positions are fractions of the frame, resolved to pixels here. The
 * same overlay therefore behaves identically at 1920x1080 and 1080x1920 rather
 * than turning into confetti in one of them.
 */

export interface MotionOverlayProps {
  overlay: SceneOverlay;
  /** Scene length, so a drift can be paced against it rather than the clock. */
  durationInFrames: number;
  theme: Theme;
  /** Mixed into the seed so two scenes with the same overlay do not match. */
  seed: number;
}

/**
 * A cheap integer hash. Deliberately not a PRNG with state: each particle asks
 * for its own numbers by index, so adding a particle cannot shift the ones
 * before it - which is what makes tuning the count safe.
 */
function hash(seed: number, salt: number): number {
  let x = Math.imul(seed + salt * 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 0xffffffff;
}

export const MotionOverlay: React.FC<MotionOverlayProps> = ({
  overlay,
  durationInFrames,
  theme,
  seed,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  if (overlay === 'none') return null;

  const seconds = frame / fps;
  const unit = Math.min(width, height);

  if (overlay === 'light-sweep') {
    // One slow pass across the frame over the whole scene, like sun moving
    // behind a window. A single wide, very soft band - two would read as a
    // strobe at this width.
    const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
    return (
      <AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            top: '-25%',
            left: `${-40 + progress * 120}%`,
            width: '45%',
            height: '150%',
            transform: 'rotate(12deg)',
            background: `linear-gradient(90deg, transparent, ${theme.colors.text}14, transparent)`,
            filter: 'blur(40px)',
          }}
        />
      </AbsoluteFill>
    );
  }

  const count = overlay === 'rain' ? 70 : overlay === 'bokeh' ? 14 : 40;

  return (
    <AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
      {Array.from({ length: count }, (_, i) => {
        const x = hash(seed, i * 3 + 1);
        const y = hash(seed, i * 3 + 2);
        const scale = hash(seed, i * 3 + 3);

        if (overlay === 'rain') {
          // Falling streaks on a loop, each with its own speed and phase, so
          // the sheet never pulses in unison.
          const speed = 0.35 + scale * 0.5;
          const travel = (y + seconds * speed) % 1.2;
          const length = unit * (0.03 + scale * 0.05);

          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${x * 100}%`,
                top: `${travel * 120 - 15}%`,
                width: Math.max(1, unit * 0.0015),
                height: length,
                transform: 'rotate(9deg)',
                background: `linear-gradient(180deg, transparent, ${theme.colors.text}55)`,
                opacity: 0.18 + scale * 0.22,
              }}
            />
          );
        }

        // dust and bokeh are the same construction at different sizes: motes
        // that drift up and sway, fading in and out on their own cycle.
        const isBokeh = overlay === 'bokeh';
        const size = unit * (isBokeh ? 0.02 + scale * 0.05 : 0.0022 + scale * 0.0035);
        const rise = ((y - seconds * (isBokeh ? 0.012 : 0.03) * (0.6 + scale)) % 1.2 + 1.2) % 1.2;
        const sway = Math.sin(seconds * (0.25 + scale * 0.4) + i) * (isBokeh ? 1.2 : 2.2);
        const twinkle = 0.5 + 0.5 * Math.sin(seconds * (0.5 + scale) + i * 1.7);

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${x * 100 + sway}%`,
              top: `${rise * 110 - 5}%`,
              width: size,
              height: size,
              borderRadius: '50%',
              backgroundColor: isBokeh ? theme.colors.accent : theme.colors.text,
              opacity: (isBokeh ? 0.1 : 0.28) * (0.4 + twinkle * 0.6),
              filter: isBokeh ? `blur(${size * 0.35}px)` : 'none',
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
