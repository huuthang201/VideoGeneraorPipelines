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
 * Bilingual subtitles, timed to the voice.
 *
 * Two lines, and they are not the same kind of thing. The English line is what
 * is being said *now* - its timings come from the TTS word boundaries, so the
 * word currently in the narrator's mouth is the bright one. The Vietnamese line
 * underneath is the meaning of the whole page, held for as long as the page is:
 * the two languages order ideas differently, so a word-by-word Vietnamese
 * highlight would point at the wrong word most of the time and lie the rest.
 *
 * The Vietnamese is set smaller and dimmer on purpose. Both lines competing at
 * the same weight is what makes a bilingual subtitle unreadable - the eye
 * cannot choose, so it reads neither. Here the English leads and the Vietnamese
 * is available underneath for whoever needs it.
 *
 * The plate behind them fades in and out with the page rather than cutting,
 * because at this pace a rectangle appearing instantly is the most distracting
 * thing on screen.
 */
export const PodcastCaption: React.FC<CaptionRendererProps> = ({ pages, theme }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;

  const page = pages.find((p) => nowMs >= p.startMs && nowMs < p.startMs + p.durationMs);
  if (!page) return null;

  const insets = safeAreaFor(width, height);
  const unit = Math.min(width, height);
  const fontSize = unit * theme.caption.sizeRatio;

  // A short fade at both ends of the page, clamped so a very short page still
  // reaches full opacity rather than only ever being half-visible.
  const fadeMs = Math.min(160, page.durationMs / 3);
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
          flexDirection: 'column',
          alignItems: 'center',
          gap: fontSize * 0.24,
          maxWidth: '86%',
          ...(theme.caption.background
            ? {
                backgroundColor: theme.caption.background,
                padding: `${fontSize * 0.42}px ${fontSize * 0.7}px`,
                borderRadius: fontSize * 0.4,
                backdropFilter: 'blur(6px)',
              }
            : {}),
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '0.3em',
            fontFamily: FONT_STACK,
            fontSize,
            fontWeight: theme.caption.fontWeight,
            lineHeight: theme.caption.lineHeight,
            textAlign: 'center',
          }}
        >
          {page.tokens.map((token, i) => {
            const active = nowMs >= token.fromMs && nowMs < token.toMs;
            return (
              <span
                key={`${token.text}-${token.fromMs}-${i}`}
                style={{
                  color: active ? theme.colors.captionHighlight : theme.colors.captionText,
                  opacity: active ? 1 : 0.78,
                  textShadow: '0 2px 14px rgba(0,0,0,0.6)',
                  transition: 'none',
                }}
              >
                {token.text}
              </span>
            );
          })}
        </div>

        {page.translation ? (
          <div
            style={{
              fontFamily: FONT_STACK,
              fontSize: fontSize * 0.84,
              fontWeight: '400',
              lineHeight: 1.3,
              textAlign: 'center',
              color: theme.colors.textMuted,
              textShadow: '0 2px 12px rgba(0,0,0,0.55)',
            }}
          >
            {page.translation}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
