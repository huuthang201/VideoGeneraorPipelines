import { AbsoluteFill, useVideoConfig } from 'remotion';
import type { TimelineImageCredit } from '../../domain/timeline';
import type { Theme } from '../themes/theme';
import { FONT_STACK } from '../fonts';
import { safeAreaFor } from './SafeArea';

export interface ImageCreditProps {
  credit: TimelineImageCredit | null;
  theme: Theme;
}

/**
 * Who took the photograph, in the corner of every scene.
 *
 * This is a licence condition, not a courtesy. The backdrops are found by
 * searching openly-licensed collections, and while some of what comes back is
 * public domain, the CC BY results require the creator to be named wherever the
 * work is used. A credit buried in the video description would not satisfy that
 * for a video watched in a feed, and a channel publishing twenty-four of these
 * a day cannot audit them by hand - so it is drawn automatically, on every
 * scene, from data the timeline carries.
 *
 * ## Why it sits where it does
 *
 * Top right. Everything else in a vertical frame is taken: the bottom fifth is
 * the Shorts overlay, the band above that is the subtitle, the lower right is
 * the column of like and share buttons, and the top left is where a scene title
 * would go. The top right is the only region a viewer never has to read, which
 * is exactly what a credit wants.
 *
 * It is set small and dim on purpose. The obligation is to name the creator
 * legibly, not to compete with the subtitle - and a credit loud enough to
 * notice would be read as a watermark, which is the one thing that makes a
 * short look like a repost.
 */
export const ImageCredit: React.FC<ImageCreditProps> = ({ credit, theme }) => {
  const { width, height } = useVideoConfig();
  if (!credit) return null;

  const insets = safeAreaFor(width, height);
  const unit = Math.min(width, height);

  return (
    <AbsoluteFill
      style={{
        // Clear of the progress bar along the very top, and inset from the
        // right by the same margin the rest of the layout uses. Pixels rather
        // than percentages: percentage padding resolves against width, which at
        // 9:16 would put this a third of the way down the frame.
        paddingTop: height * insets.top * 0.42,
        paddingRight: width * insets.left,
        justifyContent: 'flex-start',
        alignItems: 'flex-end',
      }}
    >
      <div
        style={{
          fontFamily: FONT_STACK,
          fontSize: unit * 0.019,
          fontWeight: '400',
          letterSpacing: '0.02em',
          color: theme.colors.textMuted,
          // The same two-shadow treatment the subtitle uses, at a smaller
          // radius: type this size disappears entirely over a bright sky
          // without a rim to separate it.
          textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 2px 10px rgba(0,0,0,0.5)',
          textAlign: 'right',
          maxWidth: '52%',
          // A photographer with a very long name must not wrap into a
          // paragraph in the corner of the frame.
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {credit.label}
      </div>
    </AbsoluteFill>
  );
};
