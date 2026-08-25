import { z } from 'zod';

/**
 * brief.json - the per-project settings written by the UI before a storyboard
 * is generated: what the video is about, how it should open, and roughly how
 * long it should run.
 *
 * Unlike info.json the text here carries no facts and is never checked by
 * fact-guard - it only steers subject and tone.
 *
 * The two free-text fields are the same in both modules. Everything else is
 * not: a podcast brief names the backdrops the episode may draw on and asks for
 * a length in minutes, a fact brief has no images to name and asks for one in
 * seconds. See each module's `domain/brief.ts`.
 */
export function baseBriefFields() {
  return {
    /** What the video is about. The single most important field. */
    context: z.string().min(1).optional(),
    /**
     * How it should open, if the user has an idea for it.
     *
     * It matters more in a short than anywhere else - the first two seconds
     * decide whether the video is watched at all - but a podcast's opening
     * minute is doing the same job more slowly, so the field is shared.
     */
    hook: z.string().min(1).optional(),
  };
}

/** What any module's brief is guaranteed to carry. */
export interface BaseBrief {
  context?: string;
  hook?: string;
}

/**
 * What `suggest-brief` asks Claude to produce.
 *
 * Identical in both modules - it is the same two boxes in the same UI - even
 * though what fills them could hardly be more different: one call looks at the
 * uploaded backdrops and proposes an episode, the other is given a topic and
 * proposes a fact.
 */
export const SuggestedBriefSchema = z.strictObject({
  context: z.string().min(1),
  hook: z.string().min(1),
});

export type SuggestedBrief = z.infer<typeof SuggestedBriefSchema>;
