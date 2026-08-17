import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CaptionPage } from '../../domain/timeline';
import type { Theme } from '../themes/theme';
import { FONT_STACK } from '../fonts';
import { SAFE_AREA } from './SafeArea';

export interface CaptionRendererProps {
  /** Scene-local pages: startMs is measured from the scene's first frame. */
  pages: CaptionPage[];
  theme: Theme;
}

/**
 * TikTok-style captions with word-level highlighting (spec §18).
 *
 * Timing here is never inferred from the scene's length - every page and token
 * carries a millisecond stamp derived from the actual TTS word boundaries, so
 * the highlight tracks the voice rather than an estimate of it. That is the
 * whole reason the timeline is built after the audio is measured.
 */
export const CaptionRenderer: React.FC<CaptionRendererProps> = ({ pages, theme }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;

  const page = pages.find((p) => nowMs >= p.startMs && nowMs < p.startMs + p.durationMs);
  if (!page) return null;

  return (
    <AbsoluteFill
      style={{
        // Positioned by ratio rather than nested in SafeArea so the caption can
        // sit at a precise height while still clearing the interaction column.
        // Resolved to pixels because percentage padding is relative to width,
        // which at 9:16 would place the caption far higher than configured.
        paddingLeft: width * SAFE_AREA.left,
        paddingRight: width * SAFE_AREA.right,
        paddingTop: height * theme.caption.positionRatio,
        justifyContent: 'flex-start',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '0.28em',
          fontFamily: FONT_STACK,
          fontSize: theme.caption.fontSize,
          fontWeight: theme.caption.fontWeight,
          lineHeight: theme.caption.lineHeight,
          textAlign: 'center',
          ...(theme.caption.background
            ? {
                backgroundColor: theme.caption.background,
                padding: '0.24em 0.44em',
                borderRadius: 20,
              }
            : {}),
        }}
      >
        {page.tokens.map((token, i) => {
          const active = nowMs >= token.fromMs && nowMs < token.toMs;
          return (
            <span
              key={`${token.text}-${token.fromMs}-${i}`}
              style={{
                color: active ? theme.colors.captionHighlight : theme.colors.captionText,
                textShadow: '0 3px 16px rgba(0,0,0,0.75)',
                transition: 'none',
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
