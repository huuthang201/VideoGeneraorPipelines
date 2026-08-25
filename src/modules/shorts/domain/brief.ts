import { z } from 'zod';
import { baseBriefFields } from '../../../domain/brief';

export const BriefSchema = z.strictObject({
  ...baseBriefFields(),
  /**
   * Target length in seconds, overriding VIDEO_TARGET_DURATION for this project.
   *
   * Seconds rather than minutes because that is the unit the format is decided
   * in: the difference between a twenty-five second video and a fifty-five
   * second one is an editorial choice someone makes per video, and neither
   * rounds to a whole minute.
   *
   * The ceiling is ninety rather than sixty so a channel can deliberately post
   * something that is not a Short; the floor is fifteen because below that
   * there is no room for a hook, a fact and a payoff.
   */
  targetSeconds: z.number().min(15).max(90).optional(),
});

export type Brief = z.infer<typeof BriefSchema>;

/** The requested length in seconds, or null to fall back to configuration. */
export function targetSecondsOf(brief: Brief | null): number | null {
  return brief?.targetSeconds ?? null;
}
