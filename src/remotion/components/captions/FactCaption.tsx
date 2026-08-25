import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CaptionPage } from '../../../domain/timeline';
import type { Theme } from '../../themes/theme';
import { FONT_STACK } from '../../fonts';
import { safeAreaFor } from '../SafeArea';

export interface CaptionRendererProps {
  /** Scene-local pages: startMs is measured from the scene's first frame. */
  pages: CaptionPage[];
  theme: Theme;
}

/**
 * The subtitle, timed to the voice.
 *
 * One line of Vietnamese, word-timed from the TTS boundaries, so the word in
 * the narrator's mouth is the bright one. It is not decoration: a Short is
 * played muted more often than not, and on a muted play the subtitle *is* the
 * video. That is why it is set as large as it is, and why it sits where it
 * does.
 *
 * ## Why there is no plate behind it
 *
 * The long-form version of this engine drew a translucent rectangle under the
 * caption, which is the safe choice over an arbitrary photograph. Here it is
 * the wrong one: a rectangle that appears and disappears every second and a
 * half is the most distracting thing in the frame, and at this type size the
 * plate covers a third of the picture. Legibility comes from the scrim under
 * the whole caption band plus a hard shadow on the type itself, which stays put
 * while the words change.
 */
export const FactCaption: React.FC<CaptionRendererProps> = ({ pages, theme }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;

  const page = pages.find((p) => nowMs >= p.startMs && nowMs < p.startMs + p.durationMs);
  if (!page) return null;

  const insets = safeAreaFor(width, height);
  const unit = Math.min(width, height);
  const fontSize = unit * theme.caption.sizeRatio;

  // A short fade at both ends of the page, clamped so a very short page still
  // reaches full opacity rather than only ever being half-visible. Faster than
  // the long-form version's: at this cutting rate a 160ms fade is a visible
  // lag between the word being said and the word appearing.
  const fadeMs = Math.min(90, page.durationMs / 3);
  const localMs = nowMs - page.startMs;
  const opacity = Math.min(
    interpolate(localMs, [0, fadeMs], [0, 1], { extrapolateRight: 'clamp' }),
    interpolate(localMs, [page.durationMs - fadeMs, page.durationMs], [1, 0], {
      extrapolateLeft: 'clamp',
    }),
  );

  return (
    <AbsoluteFill
      style={{
        // Positioned by ratio rather than nested in SafeArea so the caption can
        // sit at a precise height. Resolved to pixels because percentage
        // padding is relative to width, which at 9:16 would place the caption
        // far higher than configured.
        paddingLeft: width * insets.left,
        paddingRight: width * insets.left,
        paddingBottom: height * theme.caption.bottomRatio,
        justifyContent: 'flex-end',
        alignItems: 'center',
        opacity,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'baseline',
          gap: '0.26em',
          maxWidth: '94%',
          fontFamily: FONT_STACK,
          fontSize,
          fontWeight: theme.caption.fontWeight,
          lineHeight: theme.caption.lineHeight,
          textAlign: 'center',
          // Two shadows rather than one: a tight dark rim that keeps the
          // letterforms separate from whatever is behind them, and a wide soft
          // one that lifts the whole line off a bright photograph.
          textShadow: '0 2px 6px rgba(0,0,0,0.85), 0 6px 28px rgba(0,0,0,0.55)',
        }}
      >
        {page.tokens.map((token, i) => {
          const active = nowMs >= token.fromMs && nowMs < token.toMs;
          return (
            <span
              key={`${token.text}-${token.fromMs}-${i}`}
              style={{
                color: active ? theme.colors.captionHighlight : theme.colors.captionText,
                // The inactive words stay fully opaque. Dimming them is what a
                // long-form caption does, where the line is being read along
                // with; here the whole line has to be readable in the half
                // second it is on screen, and a faded word costs more than the
                // highlight gains.
                display: 'inline-block',
                // Scaled rather than recoloured alone: the highlight has to be
                // findable at a glance on a phone, and colour alone is not.
                transform: active ? 'scale(1.06)' : 'none',
                transformOrigin: 'center bottom',
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
