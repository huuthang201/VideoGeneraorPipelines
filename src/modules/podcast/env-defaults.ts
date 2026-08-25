/**
 * The podcast module's own configuration defaults.
 *
 * Layered *under* `.env` and `.env.podcast`, so a value stated in either file
 * still wins. They exist because the shared zod schema can only carry one
 * default per key, and for most of this file the two modules disagree - a
 * different narrator, a different frame, a different length, a different
 * publishing cadence. Without these, deleting a line from `.env.podcast` would
 * silently hand the podcast the fact module's Vietnamese narrator and a 9:16
 * frame, and the run would look perfectly healthy until someone watched it.
 *
 * Imports nothing on purpose: `src/config/env.ts` reads this, and anything else
 * here would make that a cycle.
 */
export const PODCAST_ENV_DEFAULTS: Record<string, string> = {
  DRIVE_ROOT: './workspace/podcast',
  LIBRARY_DIR: './runtime/podcast/library',

  TTS_ENGINE: 'edge',
  TTS_VOICE: 'en-US-AriaNeural',
  TTS_RATE: '-20%',
  TTS_PITCH: '+18Hz',
  TTS_VOLUME: '-15%',
  /** Edge applies its own rate during synthesis, so no time stretch is wanted. */
  TTS_SPEED: '1',

  MUSIC_VOLUME: '0.28',

  VIDEO_ASPECT: 'landscape',
  VIDEO_TARGET_DURATION: '420',
  VIDEO_DURATION_MIN: '300',
  VIDEO_DURATION_MAX: '600',

  YOUTUBE_TITLE_PREFIX: '[Eng + Vietsub] ',
  /** 22 is "People & Blogs". */
  YOUTUBE_CATEGORY_ID: '22',
  SCHEDULE_INTERVAL_HOURS: '8',
};
