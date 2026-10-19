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
  // The owner of Ủa Thật À? accepted CC BY-SA for this channel. See STOCK_SHARE_ALIKE.
  STOCK_SHARE_ALIKE: 'on',
  STOCK_SOURCES: 'flickr,wikimedia,inaturalist,stocksnap,rawpixel,nappy,geographorguk,nasa',
  STOCK_FALLBACK_QUERY: 'abstract nature background',

  TTS_ENGINE: 'vieneu',
  TTS_VOICE: 'Thanh Bình',
  TTS_RATE: '+0%',
  TTS_PITCH: '-10Hz',
  TTS_VOLUME: '+0%',
  TTS_SPEED: '1.15',

  MUSIC_VOLUME: '0.22',

  VIDEO_ASPECT: 'portrait',
  /**
   * Thirty seconds, and a band of two either side.
   *
   * Shorter than the forty-five this channel ran at, and the reason is
   * retention rather than taste: the proportion of viewers who reach the end is
   * what decides whether a Short keeps being shown, and it falls with length.
   * Thirty seconds is enough for one strange thing and its explanation, which
   * is the whole shape of a video here.
   *
   * The band is narrow because it can be. `VIDEO_DURATION_MIN` and
   * `VIDEO_DURATION_MAX` used to be read into `AppConfig` and consulted by
   * nothing on this pipeline; they are now the length gate, converted to a word
   * budget by `lengthBandFrom`. That conversion is only trustworthy because the
   * spread between word count and finished duration was measured across 124
   * videos and came out at 2.7% - see WORDS_PER_MINUTE in shorts/pacing.ts.
   *
   * Widen these and the videos get longer; there is no other switch to find.
   */
  VIDEO_TARGET_DURATION: '30',
  VIDEO_DURATION_MIN: '28',
  VIDEO_DURATION_MAX: '32',

  YOUTUBE_TITLE_PREFIX: '',
  /** 27 is "Education", which is what a fact short is. */
  YOUTUBE_CATEGORY_ID: '27',
  /**
   * Six hours - four videos a day, down from two hours and twelve.
   *
   * Twelve a day ran this channel into YouTube's cap on uploads per rolling
   * day, which refuses the surplus with `uploadLimitExceeded` and does not say
   * when it will stop. Four cleared it; six leaves more room again. Note what
   * this setting does and does not do: it spaces *publishing*, while the upload
   * itself happens the moment a render finishes - so it does not by itself keep
   * the channel under the cap. It stops the queue promising a rate the channel
   * cannot keep.
   */
  SCHEDULE_INTERVAL_HOURS: '6',
};
