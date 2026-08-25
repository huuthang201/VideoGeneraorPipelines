import path from 'node:path';
import { readFileSync } from 'node:fs';
import { parse as parseDotenv } from 'dotenv';
import { z } from 'zod';
import { AspectSchema, FRAME_SIZES, StyleNameSchema, type ModuleId } from '../domain/config';
import { PODCAST_ENV_DEFAULTS } from '../modules/podcast/env-defaults';
import { FACT_ENV_DEFAULTS } from '../modules/fact/env-defaults';
import { PSYCH_ENV_DEFAULTS } from '../modules/psych/env-defaults';
import type { AssetKind } from '../domain/project';

/**
 * Runtime configuration, assembled from .env with typed defaults.
 *
 * Note what is absent: nothing here tells the engine where Google Drive is.
 * `DRIVE_ROOT` exists only for the Claude Code layer that moves files in and
 * out; the engine itself never sees a path outside runtime/jobs, which is what
 * keeps it storage-agnostic.
 */

/**
 * Configuration is layered: `.env`, then `.env.<module>`, then the real
 * environment - each winning over the one before it.
 *
 * The two pipelines genuinely need different values for most of this file - a
 * different narrator, a different frame, a different length, a different
 * publishing cadence - and, critically, **a different YouTube OAuth client**.
 * They publish to different channels, so a single shared `.env` would be one
 * typo away from posting a ten-minute podcast to the shorts channel. Anything
 * genuinely common - the Claude binary, the log level - stays in the shared
 * file and is simply not repeated in either module's.
 *
 * **Nothing here touches `process.env`, and that is load-bearing.** The obvious
 * implementation is `dotenv.config({ override: true })`, which writes the
 * values into the process - and the web UI serves *both* modules from one
 * process. Loading the fact module's file would leave its narrator, its frame
 * and its Google credentials sitting in `process.env`, where the next podcast
 * request would inherit every key the podcast's own file does not happen to
 * set. Parsing into a plain object instead keeps the two configurations from
 * ever seeing each other.
 *
 * A real environment variable still beats both files, because the process's own
 * environment is merged last. That is what lets a one-off run say
 * `TTS_ENGINE=mock npm run fact -- generate x`.
 */
function readEnvFile(file: string): Record<string, string> {
  try {
    return parseDotenv(readFileSync(file, 'utf8'));
  } catch {
    // An absent file is the normal case for `.env.<module>`, and an unreadable
    // one is no different from an empty one as far as defaults are concerned.
    return {};
  }
}

/**
 * The module's built-in defaults, under both files.
 *
 * The zod schema below can only carry one default per key, and for most of this
 * file the two modules disagree. Without this layer, a key missing from
 * `.env.podcast` would fall through to whatever the schema happens to say -
 * which is the fact module's answer - and hand a podcast a Vietnamese narrator
 * in a 9:16 frame without anything failing.
 */
const MODULE_DEFAULTS: Record<ModuleId, Record<string, string>> = {
  podcast: PODCAST_ENV_DEFAULTS,
  fact: FACT_ENV_DEFAULTS,
  psych: PSYCH_ENV_DEFAULTS,
};

function layeredEnv(module: ModuleId): NodeJS.ProcessEnv {
  return {
    ...MODULE_DEFAULTS[module],
    ...readEnvFile('.env'),
    ...readEnvFile(`.env.${module}`),
    ...process.env,
  };
}

const EnvSchema = z.object({
  DRIVE_ROOT: z.string().default('./workspace/AI-Shorts'),

  /**
   * Where downloaded photographs are kept.
   *
   * A cache rather than a library: nobody puts anything here by hand, and
   * deleting it costs only the time to search and download again. It is shared
   * by every project deliberately - two videos about the sea should not fetch
   * the same photograph twice, and the free tier of the image search is the
   * scarcest resource in the system.
   */
  STOCK_DIR: z.string().default('./runtime/fact/stock'),

  /**
   * Where the podcast module's shared backdrop library lives.
   *
   * The opposite of STOCK_DIR in every way that matters, which is why both keys
   * exist rather than one: this is curated, uploaded by hand, and losing it
   * loses the user's photographs. One location for the whole module - every
   * episode draws from the same set - and a project owns none of it.
   *
   * Ignored by the fact module, which uploads nothing.
   */
  LIBRARY_DIR: z.string().default('./runtime/podcast/library'),

  /**
   * Optional Openverse API token.
   *
   * Empty by default, and the tool works without one: anonymous access allows
   * 20 searches a minute and 200 a day, which at two to four searches a video
   * covers an hourly publishing schedule with room to spare. A token raises
   * that ceiling, and is worth getting only if the daily limit is actually
   * being hit - see https://api.openverse.org/v1/#tag/auth
   */
  OPENVERSE_TOKEN: z.string().default(''),

  /**
   * Which Openverse providers to search, as a comma-separated list.
   *
   * This is the single most effective quality control in the image stage, and
   * the reason is arithmetic: Wikimedia is 88 of the roughly 100 million images
   * Openverse indexes, and most of what it holds for a natural-history subject
   * is museum digitisation - engravings, plate scans, specimen photographs,
   * skulls. A search for "rodent teeth" against everything returns a dire wolf
   * skull and a mammoth bone; against these four sources it returns nothing,
   * which is a far better answer because the query then gets widened.
   *
   * Kept in configuration rather than hard-coded because the list of providers
   * changes and cannot be enumerated reliably from the API. Widen it if a
   * subject is genuinely not covered by stock photography.
   */
  /**
   * Whether a second Claude call looks at the candidate photographs and says
   * which belongs to which scene.
   *
   * On by default, because it is the only stage that judges a picture by what
   * it *shows* rather than by the words attached to it - and the failures it
   * catches are the visible ones: a computer mouse in a video about rodents, a
   * museum skull in a video about teeth.
   *
   * Turn it off to save a Claude call and about a minute per video. Nothing
   * breaks: the automatic assignment it normally overrides is still there, and
   * still runs for every scene the review declines to place.
   */
  IMAGE_REVIEW: z
    .enum(['on', 'off'])
    .default('on'),

  STOCK_SOURCES: z.string().default('stocksnap,rawpixel,flickr,nappy'),

  /**
   * Searched when a scene's own query finds nothing usable.
   *
   * Never left empty: a query that returns no photograph would otherwise fail a
   * job that has already paid for a Claude call and a round of speech. This is
   * deliberately bland - it exists to produce *a* frame, not a good one, and
   * the right fix for a video that keeps landing here is a better query.
   */
  STOCK_FALLBACK_QUERY: z.string().min(1).default('abstract nature background'),

  /**
   * `vieneu` runs VieNeu-TTS locally through scripts/vieneu_synth.py. It is the
   * default: nineteen named voices across northern, central and southern
   * accents, no network dependency once the model is on disk, and non-verbal
   * cues that can be written into the script.
   *
   * `edge` is Microsoft Edge's read-aloud service, kept as a fallback. It needs
   * no model download and it is the only engine that reports real per-word
   * boundaries - but it offers exactly one male Vietnamese voice, and it is an
   * unofficial endpoint that periodically starts refusing clients.
   *
   * `mock` is silent audio for offline development and is never publishable.
   */
  TTS_ENGINE: z.enum(['vieneu', 'edge', 'mock']).default('vieneu'),
  /**
   * The narrator, named in whatever form the engine expects.
   *
   * For `vieneu` that is a preset name - "Thái Sơn", "Thanh Bình", "Ngọc Linh"
   * - and `npm run tts:voices` lists all nineteen with their accent and reading
   * style. For `edge` it is a voice id like `vi-VN-NamMinhNeural`.
   *
   * Note the accent, because the names do not tell you: Thanh Bình is northern
   * and Thái Sơn is southern, in the same storytelling style.
   *
   * `npm run tts:sample` reads a real script in each - pick by ear, not by name.
   */
  TTS_VOICE: z.string().default('Thanh Bình'),
  /**
   * Delivery.
   *
   * The rate is the voice's own, which is slower than a fact short is usually
   * read. That is deliberate: the script is one continuous explanation - a
   * chain of "this, so that, which is why" - and a chain read at speed is a
   * chain the viewer drops halfway through. It was +8% while the script was a
   * list of short statements, where pace mattered more than following along.
   *
   * WORDS_PER_MINUTE is calibrated against this exact voice-and-rate pair, so
   * changing the rate needs `npm run tts:pace` run again, or every video comes
   * out the wrong length.
   *
   * Pitch is the *only* lever on how the narrator sounds, because the service
   * publishes exactly one male Vietnamese voice. -10Hz reads as an older and
   * steadier man than the default, which suits somebody explaining something.
   * Usefully, pitch does not change duration - the service shifts it without
   * resampling - so retuning the tone never invalidates the constant above.
   */
  TTS_RATE: z.string().default('+0%'),
  TTS_PITCH: z.string().default('-10Hz'),
  TTS_VOLUME: z.string().default('+0%'),
  /**
   * Playback speed, applied after synthesis with ffmpeg's `atempo`.
   *
   * A time stretch rather than a resample, so the narrator speeds up without
   * changing pitch. It is a separate control from TTS_RATE because the two
   * engines differ: Edge takes a rate directly, VieNeu takes none at all, and a
   * setting that works on both belongs outside either.
   *
   * WORDS_PER_MINUTE is calibrated against the configured voice at this speed,
   * so changing it needs `npm run tts:pace` run again.
   */
  TTS_SPEED: z.coerce.number().min(0.5).max(2).default(1.15),

  /** Python 3.7+ with edge-tts installed. Created by: npm run setup:python */
  PYTHON_BIN: z.string().default('./.venv/bin/python3'),
  /** Python 3.10+ with vieneu installed. Created by: npm run setup:vieneu */
  VIENEU_PYTHON_BIN: z.string().default('./.venv-vieneu/bin/python3'),

  /**
   * Background music.
   *
   * A filename inside `assets/music/`, or empty to take the first track there
   * alphabetically - so dropping one file in is enough to turn music on, and
   * emptying the folder turns it off again.
   *
   * MUSIC_VOLUME is the level in the gaps between sentences; under speech the
   * mix drops to 35% of it (see remotion/audio/ducking.ts). 0.22 is a bed with
   * some drive to it, sitting at about 0.08 under the voice. A short is watched
   * with the sound on and often on a phone speaker, so the bed has to stay well
   * under the narration or it eats the consonants.
   */
  MUSIC_FILE: z.string().default(''),
  MUSIC_VOLUME: z.coerce.number().min(0).max(1).default(0.22),

  /**
   * YouTube upload, through the user's own Google Cloud OAuth client.
   *
   * Empty by default and the feature simply stays off: this needs a project the
   * account owner creates themselves, and there is nothing sensible to default
   * a client id to.
   *
   * YOUTUBE_PRIVACY is what the upload *asks* for. Google forces uploads from
   * unaudited API projects to private regardless, so this only takes effect
   * once the project has passed its compliance audit - see PRIVACY_NOTE.
   */
  YOUTUBE_CLIENT_ID: z.string().default(''),
  YOUTUBE_CLIENT_SECRET: z.string().default(''),
  /**
   * The loopback port consent comes back on.
   *
   * Fixed rather than random, which a desktop OAuth client would allow: a *web
   * application* client requires every redirect URI to be registered in advance
   * and matched exactly, so a random port fails with redirect_uri_mismatch
   * every time. A fixed one can be pasted into the console once and works for
   * both client types. Change it only if something else owns the port.
   */
  YOUTUBE_REDIRECT_PORT: z.coerce.number().int().positive().default(4180),
  /**
   * Prepended to every title.
   *
   * Channel branding rather than content, which is why it lives here and not in
   * the prompt: the model should write the best title it can for the video, and
   * the channel decides what wraps it. It also has to be applied *after* the
   * model, because the 100-character ceiling is on the finished string.
   *
   * Empty by default. A Short's title is read in a cramped overlay two lines
   * tall, so every character a prefix spends is one the actual hook loses.
   */
  YOUTUBE_TITLE_PREFIX: z.string().default(''),
  /**
   * Hours between scheduled publications. See src/publish/schedule.ts.
   *
   * Two: twelve videos a day. Shorts are a volume format and the feed treats
   * them as one, so this is nowhere near spam territory - but it leaves room
   * for a video to be worth watching, which one an hour quietly stops doing:
   * the constraint on a fact channel is having twelve facts worth telling, not
   * having the machine time to render twenty-four.
   *
   * It divides 24 evenly, so the slots land at the same clock times every day
   * instead of drifting. Raise it further if the channel also publishes
   * long-form - YouTube's daily recommendation allowance *is* shared.
   */
  SCHEDULE_INTERVAL_HOURS: z.coerce.number().positive().max(168).default(2),
  YOUTUBE_PRIVACY: z.enum(['private', 'unlisted', 'public']).default('private'),
  /** 27 is "Education", which is what a fact short is; 24 "Entertainment". */
  YOUTUBE_CATEGORY_ID: z.string().default('27'),

  /**
   * The channel these videos are published to.
   *
   * Here rather than in the prompt because it is branding, not content: the
   * model writes the best closing line it can and the channel decides whose
   * name goes in it. Empty means the outro simply ends on the fact, with no
   * call to subscribe at all.
   */
  CHANNEL_NAME: z.string().default(''),

  AI_PROVIDER: z.enum(['claude-code']).default('claude-code'),
  CLAUDE_BIN: z.string().default('claude'),
  CLAUDE_MODEL: z.string().default('sonnet'),

  /**
   * Delivery shape. `portrait` is 1080x1920, which is what a YouTube Short has
   * to be: upload 16:9 and it becomes an ordinary video with black bars, not a
   * Short. `landscape` remains available for a video meant for the normal feed.
   * VIDEO_WIDTH/VIDEO_HEIGHT override it when a specific size is needed, and
   * are left unset in the ordinary case so the two cannot disagree.
   */
  VIDEO_ASPECT: AspectSchema.default('portrait'),
  VIDEO_WIDTH: z.coerce.number().int().positive().optional(),
  VIDEO_HEIGHT: z.coerce.number().int().positive().optional(),
  VIDEO_FPS: z.coerce.number().int().positive().default(30),
  VIDEO_STYLE: StyleNameSchema.default('calm'),
  /**
   * Seconds. Overridden per project by brief.targetSeconds.
   *
   * Sixty is the hard edge of the format - past it YouTube stops serving the
   * video in the Shorts feed - so the target sits comfortably under it. The
   * script is written to a word budget rather than trimmed afterwards, and a
   * budget aimed at exactly sixty produces a video that overshoots half the
   * time.
   */
  VIDEO_TARGET_DURATION: z.coerce.number().positive().default(45),
  VIDEO_DURATION_MIN: z.coerce.number().positive().default(30),
  VIDEO_DURATION_MAX: z.coerce.number().positive().default(60),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

export interface AppConfig {
  /** Which pipeline this configuration is for. */
  module: ModuleId;
  driveRoot: string;
  /**
   * `runtime/<module>`, not `runtime`.
   *
   * Everything mutable and per-pipeline hangs off here: the jobs, the caches,
   * the schedule marker and the stored YouTube refresh token. Keeping them
   * apart is not tidiness - the two modules publish to *different channels*
   * under different OAuth clients, and one shared token file would upload to
   * whichever channel was authorised last.
   */
  runtimeDir: string;
  jobsDir: string;
  /** Root of the podcast module's shared backdrop library. See `libraryPaths`. */
  libraryDir: string;
  /** Where downloaded photographs are cached. Shared by every project. */
  stock: {
    cacheDir: string;
    token: string;
    fallbackQuery: string;
    /** Openverse provider names to search. See STOCK_SOURCES. */
    sources: string;
    /** Whether to run the visual review pass. See IMAGE_REVIEW. */
    review: boolean;
  };

  tts: {
    engine: 'vieneu' | 'edge' | 'mock';
    voice: string;
    rate: string;
    pitch: string;
    volume: string;
    /** Time stretch applied after synthesis, whichever engine produced it. */
    speed: number;
    pythonBin: string;
    vieneuPythonBin: string;
  };
  music: {
    /** Absolute path to the chosen track, or null when the folder is empty. */
    dir: string;
    file: string;
    volume: number;
  };
  youtube: {
    clientId: string;
    clientSecret: string;
    tokenPath: string;
    redirectPort: number;
    titlePrefix: string;
    privacy: 'private' | 'unlisted' | 'public';
    categoryId: string;
    /** Rolling publication queue: the marker file and the gap between slots. */
    schedulePath: string;
    scheduleIntervalHours: number;
  };
  channelName: string;
  ai: { provider: 'claude-code'; claudeBin: string; model: string };
  video: {
    width: number;
    height: number;
    fps: number;
    style: import('../domain/config').StyleName;
    targetDuration: number;
    durationMin: number;
    durationMax: number;
  };
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(
  module: ModuleId,
  overrides: Partial<NodeJS.ProcessEnv> = {},
): AppConfig {
  const parsed = EnvSchema.safeParse({ ...layeredEnv(module), ...overrides });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  const env = parsed.data;
  const runtimeDir = path.resolve('runtime', module);
  const frame = FRAME_SIZES[env.VIDEO_ASPECT];

  return {
    module,
    driveRoot: path.resolve(env.DRIVE_ROOT),
    runtimeDir,
    jobsDir: path.join(runtimeDir, 'jobs'),
    libraryDir: path.resolve(env.LIBRARY_DIR),
    stock: {
      cacheDir: path.resolve(env.STOCK_DIR),
      token: env.OPENVERSE_TOKEN.trim(),
      fallbackQuery: env.STOCK_FALLBACK_QUERY.trim(),
      sources: env.STOCK_SOURCES.trim(),
      review: env.IMAGE_REVIEW === 'on',
    },

    tts: {
      engine: env.TTS_ENGINE,
      voice: env.TTS_VOICE,
      rate: env.TTS_RATE,
      pitch: env.TTS_PITCH,
      volume: env.TTS_VOLUME,
      speed: env.TTS_SPEED,
      // Resolved here so nothing downstream depends on the working directory,
      // and so the same .env works on macOS, Linux and inside a container.
      pythonBin: path.resolve(env.PYTHON_BIN),
      vieneuPythonBin: path.resolve(env.VIENEU_PYTHON_BIN),
    },
    music: {
      dir: path.resolve('assets', 'music'),
      file: env.MUSIC_FILE.trim(),
      volume: env.MUSIC_VOLUME,
    },
    youtube: {
      clientId: env.YOUTUBE_CLIENT_ID.trim(),
      clientSecret: env.YOUTUBE_CLIENT_SECRET.trim(),
      // Under runtime/, which is gitignored: this file is a credential.
      tokenPath: path.join(runtimeDir, 'youtube-token.json'),
      redirectPort: env.YOUTUBE_REDIRECT_PORT,
      // Separated here rather than trusted to .env: dotenv strips trailing
      // whitespace from an unquoted value, so "[Fact] " arrives without its
      // space and every title comes out "[Fact]Title". Quoting in .env fixes it
      // too - this makes quoting unnecessary.
      titlePrefix: env.YOUTUBE_TITLE_PREFIX.trim()
        ? `${env.YOUTUBE_TITLE_PREFIX.trimEnd()} `
        : '',
      privacy: env.YOUTUBE_PRIVACY,
      categoryId: env.YOUTUBE_CATEGORY_ID,
      schedulePath: path.join(runtimeDir, 'schedule.json'),
      scheduleIntervalHours: env.SCHEDULE_INTERVAL_HOURS,
    },
    channelName: env.CHANNEL_NAME.trim(),
    ai: { provider: env.AI_PROVIDER, claudeBin: env.CLAUDE_BIN, model: env.CLAUDE_MODEL },
    video: {
      width: env.VIDEO_WIDTH ?? frame.width,
      height: env.VIDEO_HEIGHT ?? frame.height,
      fps: env.VIDEO_FPS,
      style: env.VIDEO_STYLE,
      targetDuration: env.VIDEO_TARGET_DURATION,
      durationMin: env.VIDEO_DURATION_MIN,
      durationMax: env.VIDEO_DURATION_MAX,
    },
    logLevel: env.LOG_LEVEL,
  };
}

/**
 * The podcast module's shared component library.
 *
 * It belongs to the module rather than to any one project: a project holds a
 * brief, a storyboard and an output, and every picture it shows is drawn from
 * here. That is why the paths hang off `libraryDir` and not off a job folder -
 * uploading a backdrop makes it available to every episode at once.
 *
 * The `kind` level in each path is vestigial in the sense that there is only
 * one kind today, and load-bearing in the sense that it keeps the library's
 * images separate from anything else stored under the same root.
 *
 * The fact module has no equivalent and never calls this: it searches for its
 * photographs, and `config.stock.cacheDir` is a cache nobody curates.
 */
export function libraryPaths(libraryDir: string) {
  return {
    root: libraryDir,
    /** Untouched originals, exactly as uploaded. */
    source: path.join(libraryDir, 'source'),
    sourceFor: (kind: AssetKind) => path.join(libraryDir, 'source', kind),
    /** Render-ready copies. */
    images: path.join(libraryDir, 'images'),
    imagesFor: (kind: AssetKind) => path.join(libraryDir, 'images', kind),
    /** 768px copies, the only version the model ever reads. */
    preview: path.join(libraryDir, 'preview'),
    previewFor: (kind: AssetKind) => path.join(libraryDir, 'preview', kind),
  };
}

export type LibraryPaths = ReturnType<typeof libraryPaths>;

/** Standard sub-paths inside a job directory. */
export function jobPaths(jobsDir: string, projectId: string) {
  const root = path.join(jobsDir, projectId);
  return {
    root,
    audio: path.join(root, 'audio'),
    output: path.join(root, 'output'),
    infoJson: path.join(root, 'info.json'),
    briefJson: path.join(root, 'brief.json'),
    storyboardJson: path.join(root, 'storyboard.json'),
    storyboardVersions: path.join(root, 'storyboard-versions'),
    timelineJson: path.join(root, 'timeline.json'),
    jobJson: path.join(root, 'job.json'),
    progressJson: path.join(root, 'progress.json'),
    lockFile: path.join(root, '.lock'),
    videoMp4: path.join(root, 'output', 'video.mp4'),
    thumbnailJpg: path.join(root, 'output', 'thumbnail.jpg'),
    scriptTxt: path.join(root, 'output', 'script.txt'),
    captionsSrt: path.join(root, 'audio', 'captions.srt'),
    voiceWav: path.join(root, 'audio', 'voice.wav'),
    voiceMp3: path.join(root, 'audio', 'voice.mp3'),
  };
}

export type JobPaths = ReturnType<typeof jobPaths>;
