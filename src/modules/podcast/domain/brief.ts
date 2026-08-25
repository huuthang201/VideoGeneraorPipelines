import { z } from 'zod';
import { baseBriefFields } from '../../../domain/brief';

export const BriefSchema = z.strictObject({
  ...baseBriefFields(),
  /**
   * Which backdrops this episode may use, by filename.
   *
   * The library belongs to the system and holds everything ever uploaded; an
   * episode about rain has no business reaching for the beach. Absent or empty
   * means "all of them", which is both the old behaviour and the right default
   * - a new project should work before anyone has curated anything.
   *
   * Filenames rather than ids because that is what a storyboard references, so
   * a selection can be read against a storyboard without a lookup table.
   */
  environments: z.array(z.string().min(1)).optional(),

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
