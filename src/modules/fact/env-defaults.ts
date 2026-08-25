/**
 * The fact module's own configuration defaults.
 *
 * Layered *under* `.env` and `.env.fact`, so a value stated in either file
 * still wins. See the podcast module's equivalent for why these exist at all.
 *
 * Imports nothing on purpose: `src/config/env.ts` reads this, and anything else
 * here would make that a cycle.
 */
export const FACT_ENV_DEFAULTS: Record<string, string> = {
  DRIVE_ROOT: './workspace/fact',
  STOCK_DIR: './runtime/fact/stock',
  STOCK_SOURCES: 'stocksnap,rawpixel,flickr,nappy',
  STOCK_FALLBACK_QUERY: 'abstract nature background',

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
  /** 27 is "Education", which is what a fact short is. */
  YOUTUBE_CATEGORY_ID: '27',
  SCHEDULE_INTERVAL_HOURS: '2',
};
