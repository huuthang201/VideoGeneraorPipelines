import { z } from 'zod';
import { baseBriefFields } from '../../../domain/brief';

export const BriefSchema = z.strictObject({
  ...baseBriefFields(),

  /**
   * Target length in minutes, overriding VIDEO_TARGET_DURATION for this
   * project.
   *
   * Per project rather than global because length is an editorial decision -
   * "a five minute one about rain" and "a ten minute one about the sea" are the
   * same tool used twice, not two configurations of it. Bounded at both ends so
   * a typo cannot ask for a ninety minute render.
   */
  targetMinutes: z.number().min(1).max(20).optional(),
});

export type Brief = z.infer<typeof BriefSchema>;

/** The requested length in seconds, or null to fall back to configuration. */
export function targetSecondsOf(brief: Brief | null): number | null {
  return brief?.targetMinutes ? Math.round(brief.targetMinutes * 60) : null;
}
