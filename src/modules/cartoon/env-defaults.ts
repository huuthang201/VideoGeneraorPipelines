/**
 * The cartoon channel's own configuration defaults.
 *
 * Layered under `.env` and `.env.cartoon`, so a value stated in either file
 * still wins. Every path here differs from every other module's, and that is
 * the reason this file has to exist: without it a key missing from
 * `.env.cartoon` would fall through to another module's answer, and this
 * channel would render into another channel's runtime directory and upload
 * with another channel's credentials.
 *
 * `STOCK_*` is absent on purpose. Nothing here searches for a photograph -
 * every backdrop is drawn - so there is no cache directory, no source
 * allowlist and no fallback query to configure.
 */
export const CARTOON_ENV_DEFAULTS: Record<string, string> = {
  DRIVE_ROOT: './workspace/cartoon',

  /**
   * The voice named here is only the fallback.
   *
   * Every line is spoken by whichever character says it, and that mapping is a
   * constant in `voices.ts` rather than configuration - a character whose voice
   * could be changed by an .env edit is a character who stops being himself in
   * episode forty. This value is what a line with no speaker would use, which
   * the schema does not allow, so in practice it is never reached.
   */
  TTS_ENGINE: 'vieneu',
  TTS_VOICE: 'Phạm Tuyên',
  TTS_RATE: '+0%',
  TTS_PITCH: '+0Hz',
  TTS_VOLUME: '+0%',
  TTS_SPEED: '1.10',

  /**
   * Quieter than the other channels.
   *
   * Those have one narrator over a bed; this one has characters interrupting
   * each other, and a bed at 0.22 turns four voices into a crowd. The comedy is
   * in the timing between lines, which music fills in.
   */
  MUSIC_VOLUME: '0.14',

  VIDEO_ASPECT: 'portrait',
  VIDEO_TARGET_DURATION: '40',
  VIDEO_DURATION_MIN: '20',
  VIDEO_DURATION_MAX: '60',

  YOUTUBE_TITLE_PREFIX: '',
  /** 23 is "Comedy", which is what this is. The others are Education. */
  YOUTUBE_CATEGORY_ID: '23',
  SCHEDULE_INTERVAL_HOURS: '4',
};
