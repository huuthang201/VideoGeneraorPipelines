/**
 * "Não Có Vấn Đề"'s own configuration defaults.
 *
 * Layered *under* `.env` and `.env.psych`, so a value stated in either file
 * still wins. The format numbers match the fact channel's because the format is
 * the same - vertical, Vietnamese, forty-five seconds. What genuinely differs
 * is every path and the YouTube category, and those are the reason this file
 * has to exist at all: without it a key missing from `.env.psych` would fall
 * through to another module's answer, and this channel would quietly render
 * into the fact channel's runtime directory.
 *
 * Imports nothing on purpose: `src/config/env.ts` reads this, and anything else
 * here would make that a cycle.
 */
export const PSYCH_ENV_DEFAULTS: Record<string, string> = {
  DRIVE_ROOT: './workspace/psych',
  STOCK_DIR: './runtime/psych/stock',
  STOCK_SOURCES: 'stocksnap,rawpixel,flickr,nappy',
  /**
   * People, not landscapes.
   *
   * The fallback is what a scene gets when its own query found nothing, and on
   * this channel every subject is something happening between people - a
   * generic nature backdrop under a sentence about a job interview reads as a
   * mistake in a way it would not on a channel about octopuses.
   */
  STOCK_FALLBACK_QUERY: 'people everyday life',

  TTS_ENGINE: 'vieneu',
  TTS_VOICE: 'Thanh Bình',
  TTS_RATE: '+0%',
  TTS_PITCH: '-10Hz',
  TTS_VOLUME: '+0%',
  TTS_SPEED: '1.15',

  MUSIC_VOLUME: '0.22',

  VIDEO_ASPECT: 'portrait',
  VIDEO_TARGET_DURATION: '45',
  VIDEO_DURATION_MIN: '30',
  VIDEO_DURATION_MAX: '60',

  YOUTUBE_TITLE_PREFIX: '',
  /** 27 is "Education". 22 "People & Blogs" was the alternative; this is
   *  explaining how minds work, which YouTube files under education. */
  YOUTUBE_CATEGORY_ID: '27',
  SCHEDULE_INTERVAL_HOURS: '2',

  /** The closing call to subscribe names the channel; see the outro section
   *  of the prompt. Empty would mean no call at all. */
  CHANNEL_NAME: 'Não Có Vấn Đề',
};
