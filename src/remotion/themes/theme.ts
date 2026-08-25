import type { ModuleId, StyleName } from '../../domain/config';
import type { Theme } from './types';
import { PODCAST_THEMES } from './podcast';
import { FACT_THEMES } from './fact';

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
