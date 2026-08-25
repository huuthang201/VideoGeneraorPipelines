import type { CaptionPage } from '../../domain/timeline';
import type { Theme } from '../themes/theme';
import { PodcastCaption } from './captions/PodcastCaption';
import { FactCaption } from './captions/FactCaption';

export interface CaptionRendererProps {
  /** Scene-local pages: startMs is measured from the scene's first frame. */
  pages: CaptionPage[];
  theme: Theme;
}

/**
 * The subtitle, timed to the voice - in whichever of the two forms the module
 * calls for.
 *
 * This is the one place in the Remotion tree that is genuinely two components
 * rather than one component with two sets of numbers, and it is worth saying
 * why, because the temptation to unify them is constant and the result would be
 * worse than either.
 *
 * **The podcast subtitle is bilingual, and the two lines are not the same kind
 * of thing.** The English line is what is being said *now* - word-timed from
 * the TTS boundaries, so the word in the narrator's mouth is the bright one.
 * The Vietnamese line under it is the meaning of the whole page, held for as
 * long as the page is, because the two languages order ideas differently and a
 * word-by-word Vietnamese highlight would point at the wrong word most of the
 * time. It is set smaller and dimmer deliberately: two lines competing at equal
 * weight is what makes a bilingual subtitle unreadable. There is a translucent
 * plate behind the pair, which is what keeps them legible over a bright sky.
 *
 * **The fact subtitle is one line, and on a muted play it is the video.** It is
 * set large and heavy for a phone, the inactive words stay fully opaque because
 * the whole line has to be read in the half second it is on screen, and the
 * highlight is scaled as well as recoloured because colour alone is not
 * findable at a glance. There is no plate: at this size it would cover a third
 * of the picture, and a rectangle appearing and disappearing every second and a
 * half is the most distracting thing in the frame.
 *
 * Squeezing both into one component would mean a conditional on nearly every
 * style property, which is how the two quietly drift into looking like each
 * other. The dispatch is on `theme.pack` rather than on a prop threaded down
 * from the timeline, because the theme is already the thing carrying a module's
 * visual identity and every caller has one.
 */
export const CaptionRenderer: React.FC<CaptionRendererProps> = ({ pages, theme }) => {
  return theme.pack === 'podcast' ? (
    <PodcastCaption pages={pages} theme={theme} />
  ) : (
    <FactCaption pages={pages} theme={theme} />
  );
};
