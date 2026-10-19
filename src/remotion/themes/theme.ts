import type { ModuleId, StyleName } from '../../domain/config';
import type { Theme } from './types';
import { PODCAST_THEMES } from './podcast';
import { FACT_THEMES } from './fact';
import { PSYCH_THEMES } from './psych';
import { CARTOON_THEMES } from './cartoon';
import { FACTLONG_THEMES } from './factlong';

export type { Theme } from './types';

/**
 * The theme packs, by module.
 *
 * Two styles of the same name are the same *intent* tuned for a different
 * format - `calm` is calm in both - so a storyboard's `style` means the same
 * thing whichever pipeline wrote it, and the numbers behind it do not.
 */
export const THEMES_BY_MODULE: Record<ModuleId, Record<StyleName, Theme>> = {
  podcast: PODCAST_THEMES,
  fact: FACT_THEMES,
  psych: PSYCH_THEMES,
  cartoon: CARTOON_THEMES,
  factlong: FACTLONG_THEMES,
};

/**
 * The theme a scene renders with.
 *
 * `module` comes off the timeline rather than out of configuration, because
 * this runs in the browser: the Remotion bundle has no .env and no
 * `loadConfig`. It is defaulted to `podcast` in the timeline schema so a file
 * written before the two pipelines were merged still renders the way it did.
 */
export function getTheme(style: StyleName, module: ModuleId): Theme {
  return THEMES_BY_MODULE[module][style];
}

/** Gap between the bottom of a scene's title and the top of the caption band. */
const CAPTION_CLEARANCE_RATIO = 0.045;

/**
 * Bottom inset for scene content that bottom-aligns, as a fraction of frame
 * height.
 *
 * Captions are positioned independently of the scene's own text - they have to
 * be, since they follow the audio rather than the layout - so without this the
 * two land on top of each other. Reserving the caption band here keeps the
 * title above it whatever `bottomRatio` a theme chooses, instead of each theme
 * needing a hand-tuned padding that breaks when the caption moves.
 *
 * How tall the reserved band is comes from the theme - see
 * `Theme.captionBlockLines`, which differs sharply between the two packs
 * because only one of them subtitles in two languages.
 */
export function contentBottomInsetRatio(theme: Theme, hasCaptions: boolean): number {
  if (!hasCaptions) return 0.12;
  const captionBand =
    theme.caption.sizeRatio * theme.caption.lineHeight * theme.captionBlockLines;
  return theme.caption.bottomRatio + captionBand + CAPTION_CLEARANCE_RATIO;
}

/** A rectangle in frame pixels. */
export interface FrameRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Margin above a preserved photograph, as a fraction of frame height. */
const PRESERVED_TOP_RATIO = 0.03;
/** Gap between a preserved photograph and whatever text sits below it. */
const PRESERVED_GAP_RATIO = 0.02;

/**
 * A generous width for one character of a heading, in ems.
 *
 * Generous on purpose. This only decides how much room to leave under a
 * photograph for the heading, and the two ways of being wrong are not equal:
 * guessing one line too many makes one picture a little smaller, guessing one
 * too few puts the heading back over the picture it was moved off.
 */
const TITLE_CHAR_EM = 0.6;

/**
 * Where a photograph used by permission is drawn: the frame above the text.
 *
 * Every other photograph fills the frame and the words sit on top of it, over
 * a scrim that darkens the lower part of the picture so white type stays
 * readable. That is a fine thing to do to a stock photograph and the wrong
 * thing to do to a paper's, which was lent on the condition that it be shown
 * as published: the scrim is a filter over most of it, and the subtitle and a
 * heading cover its lower edge. So the photograph is fitted whole into the
 * space the text does not use, and the text reads off the plain background
 * beneath it. The paper's credit is the one thing still drawn over a corner,
 * because that is where it was asked for.
 *
 * The bands are the ones `contentBottomInsetRatio` already keeps headings out
 * of, computed in pixels from the live frame, so a theme that moves its
 * subtitle moves this with it.
 */
export function preservedPhotoRegion(
  theme: Theme,
  width: number,
  height: number,
  text: { hasCaptions: boolean; title: string },
): FrameRegion {
  const unit = Math.min(width, height);
  const gap = height * PRESERVED_GAP_RATIO;
  const top = height * PRESERVED_TOP_RATIO;

  let bottom: number;
  if (text.title) {
    // The heading's own baseline is where a segment puts it; the photograph
    // stops above however many lines it could take.
    const fontSize = unit * theme.title.sizeRatio;
    const perLine = (width * theme.title.maxWidthRatio) / (fontSize * TITLE_CHAR_EM);
    const lines = Math.min(3, Math.max(1, Math.ceil(text.title.length / perLine)));
    const headingTop =
      height * (1 - contentBottomInsetRatio(theme, text.hasCaptions)) -
      lines * fontSize * theme.title.lineHeight;
    bottom = headingTop - gap;
  } else if (text.hasCaptions) {
    bottom =
      height -
      height * theme.caption.bottomRatio -
      unit * theme.caption.sizeRatio * theme.caption.lineHeight * theme.captionBlockLines -
      gap;
  } else {
    bottom = height - top;
  }

  return { left: 0, top, width, height: Math.max(bottom - top, height * 0.5) };
}
