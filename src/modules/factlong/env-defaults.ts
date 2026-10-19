/**
 * "Ủa Thật À?" long-form: the second machine on the fact channel.
 *
 * Layered *under* `.env` and `.env.factlong`, so a value stated in either file
 * still wins.
 *
 * Two things here are unlike any other module and both are deliberate.
 *
 * `YOUTUBE_TOKEN_FROM` points at the fact module, because this is not another
 * channel - it is the same YouTube channel with a different format on it. Every
 * other module in this repository exists partly *because* a channel cannot
 * share a token; this one exists because a channel can have two shapes.
 *
 * And the frame is landscape while the narration is Vietnamese, which no other
 * combination in the repository has: the podcast is landscape and English, the
 * shorts are vertical and Vietnamese. Nothing falls through to a sensible
 * default here, which is exactly what this file is for.
 *
 * Imports nothing on purpose: `src/config/env.ts` reads this, and anything else
 * here would make that a cycle.
 */
export const FACTLONG_ENV_DEFAULTS: Record<string, string> = {
  DRIVE_ROOT: './workspace/factlong',
  STOCK_DIR: './runtime/factlong/stock',
  // The owner of Ủa Thật À? accepted CC BY-SA for this channel. See STOCK_SHARE_ALIKE.
  STOCK_SHARE_ALIKE: 'on',
  STOCK_SOURCES: 'flickr,wikimedia,inaturalist,stocksnap,rawpixel,nappy,geographorguk,nasa',
  /**
   * Landscape, weather, mountains - the register this channel's long videos
   * live in. The fallback is what a scene gets when its own query found
   * nothing, and on a fifteen-minute video that happens more often simply
   * because there are more scenes.
   */
  STOCK_FALLBACK_QUERY: 'mountain river valley',

  /**
   * On, now that the review can work at this scale.
   *
   * It was off, and for a real reason: the review used to be one call shown
   * thirty candidates for the whole video, and on ninety-one scenes it placed
   * **nothing**. Thirty pictures cannot be assigned to ninety-one scenes, and a
   * sheet mixing all sixteen subjects is mostly pictures that are wrong for
   * whichever scene you are looking at.
   *
   * It now runs per batch of twelve scenes, shown only the candidates from the
   * queries those scenes asked for - so each choice is a real one. That is the
   * mechanism this channel's whole visual promise rests on: the picture has to
   * be about the sentence being spoken, and nothing but a pass with eyes on it
   * can check that.
   */
  IMAGE_REVIEW: 'on',

  TTS_ENGINE: 'vieneu',
  TTS_VOICE: 'Thanh Bình',
  TTS_RATE: '+0%',
  TTS_PITCH: '-10Hz',
  TTS_VOLUME: '+0%',
  TTS_SPEED: '1.15',

  /**
   * Quieter than the shorts channels' 0.22.
   *
   * A bed you stop noticing after thirty seconds is a bed you are still
   * listening to at minute fourteen, and by then it is fatigue rather than
   * atmosphere.
   */
  MUSIC_VOLUME: '0.16',

  VIDEO_ASPECT: 'landscape',
  /**
   * Seventeen minutes, in a band of fifteen to twenty.
   *
   * Wider than the shorts' four-second band and for a different reason. There,
   * the band is the format - sixty seconds is a cliff. Here it is editorial
   * room: a subject that wants sixteen minutes should not be padded to
   * seventeen, and one that wants nineteen should not be cut.
   */
  VIDEO_TARGET_DURATION: '1020',
  VIDEO_DURATION_MIN: '900',
  VIDEO_DURATION_MAX: '1200',

  YOUTUBE_TITLE_PREFIX: '',
  /** 27 is "Education", the same as the shorts on this channel. */
  YOUTUBE_CATEGORY_ID: '27',
  /**
   * One a day.
   *
   * A fifteen-minute video is not something a channel posts four times a day,
   * and this queue shares a YouTube channel - and therefore a daily upload cap
   * - with the shorts.
   */
  SCHEDULE_INTERVAL_HOURS: '24',

  /** The same channel the shorts publish to. See the note at the top. */
  YOUTUBE_TOKEN_FROM: 'fact',

  CHANNEL_NAME: 'Ủa Thật À?',
};
