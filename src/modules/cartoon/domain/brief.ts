import { z } from 'zod';
import { baseBriefFields } from '../../../domain/brief';

/**
 * What a person may type before an episode is written.
 *
 * The same two boxes as every other channel, plus a length. There is no image
 * field and there never will be: nothing here is photographed.
 *
 * The floor is lower than the shorts modules' fifteen seconds. A joke can land
 * in ten - two lines and a punchline is a complete video on this channel - and
 * refusing that would rule out the format's best case.
 */
export const BriefSchema = z.strictObject({
  ...baseBriefFields(),
  targetSeconds: z.number().min(10).max(90).optional(),
});

export type Brief = z.infer<typeof BriefSchema>;

/** The requested length in seconds, or null to fall back to configuration. */
export function targetSecondsOf(brief: Brief | null): number | null {
  return brief?.targetSeconds ?? null;
}
