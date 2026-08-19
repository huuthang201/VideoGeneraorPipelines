import { z } from 'zod';

/**
 * brief.json - optional user-supplied creative direction for one job, written by
 * the UI before a storyboard is generated. Unlike info.json this carries no
 * facts and is never checked by fact-guard: it only steers tone and framing.
 */
export const BriefSchema = z.strictObject({
  context: z.string().min(1).optional(),
  hook: z.string().min(1).optional(),
});

export type Brief = z.infer<typeof BriefSchema>;

/** What `suggest-brief` asks Claude to produce after looking at the photos. */
export const SuggestedBriefSchema = z.strictObject({
  context: z.string().min(1),
  hook: z.string().min(1),
});

export type SuggestedBrief = z.infer<typeof SuggestedBriefSchema>;
