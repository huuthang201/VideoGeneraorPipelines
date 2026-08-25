#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { readdir, mkdir, rm, rename, writeFile, readFile, cp } from 'node:fs/promises';
import { loadConfig, jobPaths, type AppConfig } from '../config/env';
import { createLogger } from '../utils/logger';
import {
  runPipeline,
  readBriefJson,
  readInfoJson,
  type PipelineResult,
} from '../pipeline/video-pipeline';
import { validateOutput } from '../video/validator';
import { isPipelineError } from '../domain/errors';
import { SHORTS_MAX_SECONDS, type ModuleId } from '../domain/config';
import { probe } from '../video/ffprobe';
import { narrationFromScenes } from '../domain/storyboard';
import { TimelineSchema } from '../domain/timeline';
import { buildPublishKit, readMusicCredit, writePublishKit } from '../pipeline/publish-kit';
import { prepareProject } from './prepare';
import { getModule, parseModuleId, type AnyVideoModule } from '../modules';
import { LocalDriveStorageProvider } from '../storage/local-drive.provider';
import {
  PRIVACY_NOTE,
  TESTING_TOKEN_EXPIRY_DAYS,
  TOKEN_WARN_DAYS,
  authorize,
  storedChannel,
  tokenAgeDays,
  uploadVideo,
  verifyCredentials,
} from '../publish/youtube';
import {
  peekSlot,
  releaseSlot,
  resetSchedule,
  takeSlot,
  type SlotPreview,
} from '../publish/schedule';

/**
 * The single entry point. Everything - a person at a terminal, Claude Code
 * following the Drive workflow, the local web UI - drives the engine through
 * these commands, so there is one behaviour to reason about rather than one per
 * caller.
 *
 * Every command runs against exactly one module, named by `--module` or by
 * `VIDEO_MODULE`, and in practice by the npm script that wrapped it: `npm run
 * podcast -- generate x` and `npm run fact -- generate x`. There is no default,
 * and that is deliberate rather than unhelpful - the two modules keep separate
 * job directories, separate caches and separate YouTube credentials, so a
 * guessed module would run the wrong pipeline and upload to the wrong channel.
 *
 * The module is resolved from argv *before* the program is built, because it
 * decides which commands exist: `library` only makes sense where the pictures
 * are uploaded, and `stock-search` only where they are searched for.
 */

/**
 * Reads `--module`/`-m` out of argv by hand.
 *
 * Commander cannot help here: its own parse happens after the command tree is
 * registered, and the tree depends on the answer.
 */
function moduleIdFromArgv(argv: readonly string[]): ModuleId {
  const flag = argv.findIndex((a) => a === '--module' || a === '-m');
  if (flag !== -1 && argv[flag + 1]) return parseModuleId(argv[flag + 1]);

  const inline = argv.find((a) => a.startsWith('--module='));
  if (inline) return parseModuleId(inline.slice('--module='.length));

  return parseModuleId(process.env.VIDEO_MODULE);
}

let videoModule: AnyVideoModule;
try {
  videoModule = getModule(moduleIdFromArgv(process.argv.slice(2)));
} catch (err) {
  // A bare stack trace here is unhelpful: the fix is always the same one line.
  console.error(err instanceof Error ? err.message : String(err));
  console.error('\nRun a command through its module, e.g.:');
  console.error('  npm run podcast -- generate <project>');
  console.error('  npm run fact    -- generate <project>');
  console.error('  npx tsx src/cli/index.ts --module fact list');
  process.exit(2);
}

/** Configuration for the module this invocation is running as. */
function loadModuleConfig(): AppConfig {
  return loadConfig(videoModule.id);
}

const program = new Command();

program
  .name(`video-engine --module ${videoModule.id}`)
  .description(videoModule.description)
  .option('-m, --module <id>', 'which pipeline to run: podcast | fact', videoModule.id)
  .version('0.1.0');

program
  .command('prepare')
  .argument('<source>', 'folder holding info.json / brief.json / storyboard.json')
  .option('--id <projectId>', 'project id; defaults to the source folder name')
  .description(
    videoModule.id === 'podcast'
      ? 'Create a project under runtime/jobs (backdrops come from the shared library)'
      : 'Create a project under runtime/jobs (no images needed - they are searched for)',
  )
  .action(async (source: string, opts: { id?: string }) => {
    const config = loadModuleConfig();
    const projectId = opts.id ?? path.basename(path.resolve(source));
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(async () => {
      const result = await prepareProject({ source, projectId, config, logger });
      logger.done(`Project ready → ${result.jobDir}`);
    }, logger);
  });

program
  .command('generate')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .option('--force', 'rebuild even when nothing changed', false)
  .option('--mock-tts', 'use placeholder narration instead of calling Edge TTS', false)
  .option('--no-publish', 'leave the output in runtime/jobs instead of copying to 03_OUTPUT')
  .option('--voice <name>', 'override TTS_VOICE for this run, e.g. vi-VN-HoaiMyNeural')
  .description('Run the full pipeline for one project')
  .action(
    async (
      job: string,
      opts: { force: boolean; mockTts: boolean; publish: boolean; voice?: string },
    ) => {
    const config = loadModuleConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(
      () =>
        runPipeline({
          module: videoModule,
          projectId,
          config,
          logger,
          force: opts.force,
          useMockTts: opts.mockTts,
          publish: opts.publish,
          voiceOverride: opts.voice,
          allowStoryboardGeneration: true,
        }),
      logger,
    );
  },
);

program
  .command('publish')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .description('Copy an already-rendered project to DRIVE_ROOT/03_OUTPUT')
  .action(async (job: string) => {
    const config = loadModuleConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(async () => {
      const paths = jobPaths(config.jobsDir, projectId);
      const storage = new LocalDriveStorageProvider(config.driveRoot);
      await storage.ensureLayout();
      const target = await storage.publish(projectId, paths.output);
      logger.done(`Published → ${target.describe}`);
    }, logger);
  });

program
  .command('list')
  .description('Show every project in 01_INPUT and whether it has been published')
  .action(async () => {
    const config = loadModuleConfig();
    const storage = new LocalDriveStorageProvider(config.driveRoot);
    await storage.ensureLayout();

    const projects = await storage.listPending();
    if (projects.length === 0) {
      console.log(`No projects in ${config.driveRoot}/01_INPUT`);
      return;
    }

    for (const projectId of projects) {
      const published = await storage.isPublished(projectId);
      console.log(`  ${published ? 'DONE   ' : 'PENDING'}  ${projectId}`);
    }
  });

program
  .command('regenerate-content')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .description('Discard the existing storyboard, ask Claude for a new one, then re-render')
  .action(async (job: string) => {
    const config = loadModuleConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(() => regenerateStoryboard(projectId, config, logger, { storyboardOnly: false }), logger);
  });

program
  .command('generate-storyboard')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .description('Ask Claude for a new storyboard only (no TTS, no render); archives it as a new version')
  .action(async (job: string) => {
    const config = loadModuleConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(() => regenerateStoryboard(projectId, config, logger, { storyboardOnly: true }), logger);
  });

program
  .command('suggest-brief')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .option('--topic <text>', 'what the video is about; defaults to the project name')
  .description(
    videoModule.id === 'podcast'
      ? 'Look at the backdrops and draft a topic + opening suggestion (writes brief.json)'
      : 'Ask Claude for a fact worth a video, and an opening line (writes brief.json)',
  )
  .action(async (job: string, opts: { topic?: string }) => {
    const config = loadModuleConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(async () => {
      const paths = jobPaths(config.jobsDir, projectId);
      const brief = await readBriefJson(paths.briefJson, videoModule);
      const info = await readInfoJson(paths.infoJson);

      /*
       * The two modules suggest a brief from opposite directions, and this is
       * the clearest place in the CLI where that shows.
       *
       * The podcast module looks at the photographs: the library is what the
       * episode can be about, so the model reads the previews and proposes a
       * subject they support. The fact module has nothing to look at - the
       * pictures do not exist yet - so it is given a topic and the titles the
       * channel has already used, and proposes a fact that is not a repeat.
       */
      const suggestion = await videoModule.suggestBrief(config, logger, {
        // The project name is the only thing anybody types before asking for a
        // suggestion, so it is what the suggestion is steered by. The UI knows
        // the name with its diacritics and passes it in; from a terminal there
        // is only the id, and un-slugging it is a decent approximation - "con
        // chuot" still reads as "con chuột" to the model.
        topic: opts.topic?.trim() || projectId.replace(/-/gu, ' '),
        info,
        // What the channel has already made, so it is not a repeat. Computed
        // for every module: the podcast ignores it, and the cost is reading a
        // few job.json files.
        alreadyCovered: await readCoveredTitles(config, projectId),
      });

      // Merged rather than overwritten: the requested length, and anything else
      // the user already typed, must survive a suggestion.
      const merged = { ...(brief ?? {}), ...suggestion };
      await writeFile(paths.briefJson, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
      logger.done(`brief.json written → ${paths.briefJson}`);
    }, logger);
  });

program
  .command('narration')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .description('Write the exact spoken script to audio/narration.txt, for pasting into another voice tool')
  .action(async (job: string) => {
    const config = loadModuleConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(async () => {
      const paths = jobPaths(config.jobsDir, projectId);
      const raw = await readFile(paths.storyboardJson, 'utf8').catch(() => null);
      if (!raw) {
        throw new Error(`No storyboard.json in ${paths.root}; generate the script first.`);
      }

      const storyboard = videoModule.parseStoryboard(JSON.parse(raw));
      const narration = narrationFromScenes(storyboard);

      await mkdir(paths.audio, { recursive: true });
      const target = path.join(paths.audio, 'narration.txt');
      await writeFile(target, `${narration}\n`, 'utf8');

      logger.done(
        `${narration.length} characters, ${narration.split(/\s+/).filter(Boolean).length} words → ${target}`,
      );
    }, logger);
  });

/**
 * Bring your own voice track.
 *
 * The pipeline's own engines are not the only way to get narration: a voice
 * that only exists behind someone else's web app can be rendered by hand and
 * dropped in here. What the file cannot bring with it is word timings, so the
 * old ones are cleared and the timeline builder estimates them from the script
 * instead - approximate subtitles rather than none.
 */
program
  .command('use-voice')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .argument('<audio>', 'an mp3 or wav of the whole narration, in script order')
  .description('Use an externally recorded narration track instead of calling a TTS engine')
  .action(async (job: string, audio: string) => {
    const config = loadModuleConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(async () => {
      const paths = jobPaths(config.jobsDir, projectId);
      const source = path.resolve(audio);
      const extension = path.extname(source).toLowerCase();

      if (extension !== '.mp3' && extension !== '.wav') {
        throw new Error(`Expected an .mp3 or .wav file, got "${extension || source}".`);
      }

      await mkdir(paths.audio, { recursive: true });
      const target = extension === '.wav' ? paths.voiceWav : paths.voiceMp3;

      // Both containers are checked for on the reuse path, so a leftover of the
      // other kind would win over the file just imported.
      await rm(paths.voiceWav, { force: true });
      await rm(paths.voiceMp3, { force: true });
      await cp(source, target);

      // Timings from a previous run describe different audio entirely.
      await rm(path.join(paths.audio, 'words.json'), { force: true });

      const { getDurationSeconds } = await import('../video/ffprobe');
      const duration = await getDurationSeconds(target);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`${source} has no measurable audio duration.`);
      }

      logger.done(`Voice track imported (${duration.toFixed(1)}s) → ${target}`);
      logger.step(`Now run: npx tsx src/cli/index.ts render ${projectId}`);
    }, logger);
  });

program
  .command('render')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .option('--mock-tts', 'use placeholder narration if no voice track exists', false)
  .description('Re-render from the existing storyboard and voice track (no Claude, no TTS)')
  .action(async (job: string, opts: { mockTts: boolean }) => {
    const config = loadModuleConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(
      () =>
        runPipeline({
          module: videoModule,
          projectId,
          config,
          logger,
          force: true,
          reuseVoice: true,
          useMockTts: opts.mockTts,
        }),
      logger,
    );
  });

/**
 * YouTube.
 *
 * Two commands rather than one that does everything: consent is a browser
 * round-trip a person does once, and uploading is something a script may do
 * unattended a hundred times. Collapsing them would put a browser prompt in the
 * middle of an automated run.
 */
/**
 * Rebuilds output/youtube.{md,json} from what is already on disk.
 *
 * The listing is normally written by a render, but it depends on things that
 * change without the video changing - the title prefix, the music credits file,
 * a correction to the description. Re-rendering eight minutes of video to pick
 * up a sixteen-character prefix would be absurd.
 */
program
  .command('publish-kit')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .description('Rewrite the YouTube listing from the existing storyboard and timeline')
  .action(async (job: string) => {
    const config = loadModuleConfig();
    const projectId = resolveProjectId(job, config.jobsDir);
    const logger = createLogger({ level: config.logLevel }).forProject(projectId);

    await run(async () => {
      const paths = jobPaths(config.jobsDir, projectId);

      const [storyboardRaw, timelineRaw] = await Promise.all([
        readFile(path.join(paths.output, 'storyboard.json'), 'utf8').catch(() =>
          readFile(paths.storyboardJson, 'utf8'),
        ),
        readFile(paths.timelineJson, 'utf8'),
      ]);

      const storyboard = videoModule.parseStoryboard(JSON.parse(storyboardRaw));
      const timeline = TimelineSchema.parse(JSON.parse(timelineRaw));

      // Whatever cover images the last render actually produced.
      const thumbnails = (await readdir(paths.output))
        .filter((name) => /^thumbnail(-\d+)?\.jpg$/u.test(name))
        .sort();

      const musicFile = config.music.file
        ? path.join(config.music.dir, config.music.file)
        : ((await readdir(config.music.dir).catch(() => [] as string[]))
            .filter((name) => /\.(mp3|m4a|wav|ogg)$/iu.test(name))
            .sort()[0] ?? null);

      const kit = buildPublishKit({
        storyboard,
        timeline,
        thumbnails,
        music: await readMusicCredit(config.music.dir, musicFile),
        musicFile: musicFile ? path.join(config.music.dir, path.basename(musicFile)) : null,
        titlePrefix: config.youtube.titlePrefix,
      });

      await writePublishKit(paths.output, kit);
      logger.done(`${kit.title} (${kit.title.length}/100) · ${kit.chapters.length} chapters`);
    }, logger);
  });

/**
 * The publication queue.
 *
 * Read-only by default because the marker is shared by every project - looking
 * at it should never move it, or checking when the next video goes out would
 * push the one after it an hour later.
 */
program
  .command('schedule')
  .option('--reset [when]', 'move the marker: "now", or an ISO timestamp')
  .description('Show when the next scheduled upload would publish')
  .action(async (opts: { reset?: string | boolean }) => {
    const config = loadModuleConfig();
    const logger = createLogger({ level: config.logLevel });

    await run(async () => {
      if (opts.reset !== undefined) {
        const at =
          typeof opts.reset === 'string' && opts.reset !== 'now' ? new Date(opts.reset) : new Date();
        if (Number.isNaN(at.getTime())) throw new Error(`"${opts.reset}" is not a date.`);

        await resetSchedule(config.youtube.schedulePath, at);
        logger.done(`Queue marker set to ${at.toLocaleString()}`);
      }

      const { publishAt, wasStale } = await peekSlot(
        config.youtube.schedulePath,
        config.youtube.scheduleIntervalHours,
      );
      logger.done(
        `Next scheduled upload would publish at ${publishAt.toLocaleString()} ` +
          `(every ${config.youtube.scheduleIntervalHours}h)`,
      );
      if (wasStale) logger.step('The marker had fallen into the past and was treated as now.');
    }, logger);
  });

program
  .command('youtube-auth')
  .description('One-time Google consent for uploading (opens a browser)')
  .action(async () => {
    const config = loadModuleConfig();
    const logger = createLogger({ level: config.logLevel });

    await run(async () => {
      assertYouTubeConfigured(config);
      await authorize(
        {
          clientId: config.youtube.clientId,
          clientSecret: config.youtube.clientSecret,
          tokenPath: config.youtube.tokenPath,
          redirectPort: config.youtube.redirectPort,
        },
        (message) => logger.step(message),
      );
    }, logger);
  });

program
  .command('youtube-channel')
  .description('Show which YouTube channel the stored credentials upload to')
  .action(async () => {
    const config = loadModuleConfig();
    const logger = createLogger({ level: config.logLevel });

    await run(async () => {
      const credentials = {
        clientId: config.youtube.clientId,
        clientSecret: config.youtube.clientSecret,
        tokenPath: config.youtube.tokenPath,
      };

      // Asks Google rather than trusting the file: this is the command someone
      // runs *because* they are unsure, so it should exercise the credential
      // rather than reprint what was written down when it was created.
      const channel = await verifyCredentials(credentials).catch(async (err) => {
        const remembered = await storedChannel(credentials);
        logger.warn(
          `Stored credentials did not work: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (remembered) logger.step(`Last authorised channel was: ${remembered.title}`);
        logger.step('Run "youtube-auth" again to re-authorise.');
        return null;
      });

      if (!channel) return;

      logger.done(`${channel.title}${channel.handle ? ` (${channel.handle})` : ''} → ${channel.url}`);
      await warnIfTokenAging(config, logger);
      logger.step('To upload to a different channel: youtube-logout, then youtube-auth again.');
    }, logger);
  });

/**
 * Switching channels is deleting the token.
 *
 * There is no "change channel" call - the channel is a property of the consent,
 * so the only way to move is to consent again and pick a different one on
 * Google's own chooser.
 */
program
  .command('youtube-logout')
  .description('Forget the stored Google credentials, so the next auth can pick another channel')
  .action(async () => {
    const config = loadModuleConfig();
    const logger = createLogger({ level: config.logLevel });

    await run(async () => {
      await rm(config.youtube.tokenPath, { force: true });
      logger.done(`Removed ${config.youtube.tokenPath}`);
      logger.step(
        'Google may skip the account chooser next time. To be offered it again, remove this ' +
          'app at https://myaccount.google.com/permissions first.',
      );
    }, logger);
  });

/**
 * One upload, shared by the single-project command and the batch one.
 *
 * Pulled out rather than duplicated because the two must not drift: the batch
 * command exists precisely to take the slot from the same queue, in the same
 * order, with the same "the slot is taken before the bytes are sent" rule.
 */
/**
 * Runs the upload, and hands the slot back if it does not happen.
 *
 * Wrapping only the network call, not the whole function: everything before it
 * runs before a slot exists, and everything after it runs because the video is
 * already on the channel.
 */
async function withSlotReturnedOnFailure<T>(
  config: AppConfig,
  slot: SlotPreview | null,
  logger: ReturnType<typeof createLogger>,
  attempt: () => Promise<T>,
): Promise<T> {
  try {
    return await attempt();
  } catch (err) {
    if (slot) {
      const given = await releaseSlot(
        config.youtube.schedulePath,
        slot,
        config.youtube.scheduleIntervalHours,
      ).catch(() => false);
      if (given) {
        logger.warn(
          `Upload failed, so its slot (${slot.publishAt.toLocaleString()}) went back to the queue.`,
        );
      }
    }
    throw err;
  }
}

async function uploadOne(
  config: AppConfig,
  projectId: string,
  opts: { privacy?: string; thumbnail?: string | false; schedule: boolean; allowLong?: boolean },
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const paths = jobPaths(config.jobsDir, projectId);
  await assertNotMock(paths.jobJson, projectId);
  await assertShortEnough(paths.videoMp4, opts.allowLong ?? false);
  await warnIfTokenAging(config, logger);
  const kitRaw = await readFile(path.join(paths.output, 'youtube.json'), 'utf8').catch(() => null);
  if (!kitRaw) {
    throw new Error(
      `No output/youtube.json in ${paths.root}. Render the video first - the listing is ` +
        'written from the finished render.',
    );
  }

  const kit = JSON.parse(kitRaw) as {
    title: string;
    description: string;
    tags: string[];
    thumbnails: string[];
  };

  const privacy = (opts.privacy ?? config.youtube.privacy) as 'private' | 'unlisted' | 'public';

  // Taken before the upload starts: two uploads launched together must not
  // race for the same slot, and a failed upload having consumed one is an
  // hour-long gap rather than two videos landing at once.
  const slot = opts.schedule
    ? await takeSlot(config.youtube.schedulePath, config.youtube.scheduleIntervalHours)
    : null;

  if (slot) {
    logger.step(
      `Scheduled for ${slot.publishAt.toLocaleString()}` +
        `${slot.wasStale ? ' (queue had fallen behind; caught up to now)' : ''}`,
    );
  }

  const thumbnail =
    opts.thumbnail === false
      ? null
      : path.join(paths.output, typeof opts.thumbnail === 'string' ? opts.thumbnail : 'thumbnail.jpg');

  logger.step(`Uploading "${kit.title}" as ${privacy}...`);

  let lastReported = 0;
  const result = await withSlotReturnedOnFailure(config, slot, logger, () =>
    uploadVideo(
    {
      clientId: config.youtube.clientId,
      clientSecret: config.youtube.clientSecret,
      tokenPath: config.youtube.tokenPath,
    },
    {
      videoPath: paths.videoMp4,
      thumbnailPath: thumbnail,
      meta: {
        title: kit.title,
        description: kit.description,
        tags: kit.tags,
        categoryId: config.youtube.categoryId,
        language: 'vi',
        privacyStatus: privacy,
        publishAt: slot ? slot.publishAt.toISOString() : null,
      },
      onMessage: (message) => logger.warn(message),
      onProgress: (uploaded, total) => {
        const percent = Math.floor((uploaded / total) * 100);
        // Every ten percent: a line per chunk is noise in a log file.
        if (percent >= lastReported + 10) {
          lastReported = percent;
          logger.step(`  ${percent}% (${(uploaded / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)} MB)`);
        }
      },
    },
    ),
  );

  await writeFile(
    path.join(paths.output, 'youtube-upload.json'),
    `${JSON.stringify({ ...result, uploadedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );

  logger.done(`Uploaded to ${result.channel?.title ?? 'the authorised channel'} → ${result.url}`);
  if (result.privacyStatus !== privacy) {
    logger.warn(`YouTube set it to "${result.privacyStatus}", not "${privacy}". ${PRIVACY_NOTE}`);
  }
  if (thumbnail && !result.thumbnailSet) {
    logger.warn(`Cover image not applied: ${result.thumbnailError ?? 'unknown reason'}`);
  }
}

program
  .command('youtube-upload')
  .argument('<job>', 'path to a job folder, or a project id under runtime/jobs')
  .option('--privacy <status>', 'private | unlisted | public (default: YOUTUBE_PRIVACY)')
  .option('--schedule', 'take the next slot from the queue instead of publishing on upload', false)
  .option('--thumbnail <file>', 'which cover image to use', 'thumbnail.jpg')
  .option('--no-thumbnail', 'skip setting a cover image')
  .option('--allow-long', `upload even if past the ${SHORTS_MAX_SECONDS}s Shorts ceiling`, false)
  .description('Upload one rendered video with the title, description and tags already written')
  .action(
    async (
      job: string,
      opts: {
        privacy?: string;
        thumbnail?: string | false;
        schedule: boolean;
        allowLong: boolean;
      },
    ) => {
      const config = loadModuleConfig();
      const projectId = resolveProjectId(job, config.jobsDir);
      const logger = createLogger({ level: config.logLevel }).forProject(projectId);

      await run(async () => {
        assertYouTubeConfigured(config);
        await uploadOne(config, projectId, opts, logger);
      }, logger);
    },
  );

/**
 * The whole back catalogue into the hourly queue, one at a time.
 *
 * This is the command the channel actually runs. A batch of shorts is rendered
 * in whatever order the machine gets to them, and then has to go out spaced an
 * hour apart - so the useful unit of work is "publish everything that is
 * finished and not yet uploaded", not "publish this one".
 *
 * Three things it does deliberately:
 *
 * **Serial, always.** Rendering is CPU-bound and several at once is fine.
 * Uploading is bandwidth-bound and several at once is not: fifteen shorts
 * launched together share one uplink, every request crawls towards its timeout,
 * and a failure part-way through wastes what was already sent.
 *
 * **Oldest first**, by the time the render finished. The queue hands out slots
 * in the order it is asked, so the order they are asked in is the order they
 * publish in - and a viewer arriving at the channel should find them in the
 * order they were made.
 *
 * **Skips what is already up.** `output/youtube-upload.json` is written after a
 * successful upload, so re-running this after adding three more videos uploads
 * three, not eighteen. That file is the record of a real upload rather than a
 * flag anybody sets by hand.
 */
program
  .command('youtube-upload-all')
  .option('--privacy <status>', 'private | unlisted | public (default: YOUTUBE_PRIVACY)')
  .option('--no-schedule', 'publish on upload instead of taking queue slots')
  .option('--limit <n>', 'upload at most this many', (v) => Number.parseInt(v, 10))
  .option('--thumbnail <file>', 'which cover image to use', 'thumbnail.jpg')
  .option('--no-thumbnail', 'skip setting a cover image')
  .option('--allow-long', `upload even if past the ${SHORTS_MAX_SECONDS}s Shorts ceiling`, false)
  .description('Upload every rendered video that has not been uploaded yet, spaced by the queue')
  .action(
    async (opts: {
      privacy?: string;
      schedule: boolean;
      limit?: number;
      thumbnail?: string | false;
      allowLong: boolean;
    }) => {
      const config = loadModuleConfig();
      const logger = createLogger({ level: config.logLevel });

      await run(async () => {
        assertYouTubeConfigured(config);

        const pending = await findUploadable(config);
        if (pending.length === 0) {
          logger.done('Nothing to upload: every rendered video is already on the channel.');
          return;
        }

        const batch =
          typeof opts.limit === 'number' && Number.isFinite(opts.limit)
            ? pending.slice(0, Math.max(0, opts.limit))
            : pending;

        logger.step(
          `${batch.length} video(s) to upload` +
            `${batch.length < pending.length ? ` of ${pending.length} pending` : ''}` +
            `${opts.schedule ? `, one every ${config.youtube.scheduleIntervalHours}h` : ''}`,
        );

        const failed: string[] = [];

        for (const projectId of batch) {
          const projectLogger = logger.forProject(projectId);
          try {
            await uploadOne(
              config,
              projectId,
              {
                privacy: opts.privacy,
                thumbnail: opts.thumbnail,
                schedule: opts.schedule,
                allowLong: opts.allowLong,
              },
              projectLogger,
            );
          } catch (err) {
            // One failure must not strand the rest. The slot it consumed is
            // simply a gap in the schedule, which is the cheap outcome.
            failed.push(projectId);
            projectLogger.error(describeError(err));
          }
        }

        logger.done(`${batch.length - failed.length} uploaded, ${failed.length} failed`);
        if (failed.length > 0) {
          logger.warn(`Failed: ${failed.join(', ')}`);
          process.exitCode = 1;
        }
      }, logger);
    },
  );

/**
 * Says something while a stale token can still be replaced quietly.
 *
 * Never throws. The token may be perfectly fine - a published consent screen
 * issues refresh tokens that do not expire at all - and refusing an upload over
 * an age this cannot interpret would be worse than the problem it prevents.
 */
async function warnIfTokenAging(
  config: AppConfig,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const age = await tokenAgeDays({
    clientId: config.youtube.clientId,
    clientSecret: config.youtube.clientSecret,
    tokenPath: config.youtube.tokenPath,
  });

  if (age === null || age < TOKEN_WARN_DAYS) return;

  logger.warn(
    `The Google token is ${age.toFixed(1)} days old. If the OAuth consent screen is still in ` +
      `"Testing", refresh tokens expire after ${TESTING_TOKEN_EXPIRY_DAYS} days and uploads will ` +
      'start failing - run "youtube-auth" again, or publish the app so they stop expiring.',
  );
}

/**
 * Refuses to upload a vertical video that is too long to be a Short.
 *
 * This is the one check that cannot be made after the fact. Every other mistake
 * here is visible and fixable - a wrong title is edited in Studio, a wrong
 * privacy setting is a switch - but a video that YouTube has classified as an
 * ordinary video does not become a Short later by being shortened. It has to be
 * deleted and re-uploaded, and by then it has spent a slot in the queue.
 *
 * A landscape render is left alone: it was never going to be a Short and
 * nobody uploading one thinks it is.
 */
/**
 * Refuses to upload a render made with `--mock-tts`.
 *
 * `--mock-tts` produces silence at the right length so layout can be checked
 * without spending a TTS call, and a silent video on a channel is the worst
 * thing this command can do - it looks fine in the listing and is only found by
 * a viewer. The batch command has always known this and skipped such renders;
 * the single-project command did not, so the one path a person reaches for when
 * they want *this* video up was the one path with no guard. The web interface's
 * publish buttons go through here too.
 */
async function assertNotMock(jobJsonPath: string, projectId: string): Promise<void> {
  const raw = await readFile(jobJsonPath, 'utf8').catch(() => null);
  if (!raw) return;

  let job: { devMock?: boolean };
  try {
    job = JSON.parse(raw) as { devMock?: boolean };
  } catch {
    return;
  }
  if (!job.devMock) return;

  throw new Error(
    `${projectId} was rendered with --mock-tts, so its narration is silence. Re-render it ` +
      'without --mock-tts before uploading.',
  );
}

async function assertShortEnough(videoPath: string, allowLong: boolean): Promise<void> {
  if (allowLong) return;

  const info = await probe(videoPath).catch(() => null);
  if (!info) return;

  const video = info.streams.find((stream) => stream.codec_type === 'video');
  const duration = Number(info.format.duration ?? 0);
  if (!video?.width || !video.height || !Number.isFinite(duration)) return;

  if (video.height <= video.width) return;
  if (duration <= SHORTS_MAX_SECONDS) return;

  throw new Error(
    `${path.basename(path.dirname(path.dirname(videoPath)))} is ${duration.toFixed(1)}s, past ` +
      `the ${SHORTS_MAX_SECONDS}s Shorts ceiling. YouTube would accept it and serve it as an ` +
      'ordinary video, which cannot be undone without deleting and re-uploading. Shorten the ' +
      'script and re-render, or pass --allow-long to publish it as a normal video on purpose.',
  );
}

/**
 * Rendered, listed, and not yet uploaded - oldest render first.
 *
 * A project qualifies on evidence rather than on status: the listing and the
 * MP4 both have to be on disk, and `job.json` has to say the run finished
 * without mock narration. A `devMock` render is silent, and uploading silence
 * to a channel is the one mistake this batch could make at scale.
 */
async function findUploadable(config: AppConfig): Promise<string[]> {
  const entries = await readdir(config.jobsDir, { withFileTypes: true }).catch(() => []);
  const candidates: { projectId: string; completedAt: string }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const paths = jobPaths(config.jobsDir, entry.name);

    const jobRaw = await readFile(paths.jobJson, 'utf8').catch(() => null);
    if (!jobRaw) continue;

    let job: { status?: string; devMock?: boolean; completedAt?: string };
    try {
      job = JSON.parse(jobRaw) as typeof job;
    } catch {
      continue;
    }
    if (job.status !== 'DONE' || job.devMock) continue;

    const alreadyUp = await readFile(
      path.join(paths.output, 'youtube-upload.json'),
      'utf8',
    ).catch(() => null);
    if (alreadyUp) continue;

    const kit = await readFile(path.join(paths.output, 'youtube.json'), 'utf8').catch(() => null);
    if (!kit) continue;

    candidates.push({ projectId: entry.name, completedAt: job.completedAt ?? '' });
  }

  return candidates
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt))
    .map((c) => c.projectId);
}

/**
 * What the engine would find for a query, without spending a render on it.
 *
 * Exists because the one judgement this design took away from the model is what
 * the pictures actually look like: it writes a search phrase and finds out
 * afterwards. This is how a person checks a phrase before, or diagnoses a video
 * whose backdrops came out wrong after.
 */
program
  .command('generate-all')
  .option('--force', 'rebuild even when nothing changed', false)
  .option('--mock-tts', 'use placeholder narration instead of calling Edge TTS', false)
  .description('Run the pipeline for every project under runtime/jobs')
  .action(async (opts: { force: boolean; mockTts: boolean }) => {
    const config = loadModuleConfig();
    const logger = createLogger({ level: config.logLevel });

    await mkdir(config.jobsDir, { recursive: true });
    const entries = await readdir(config.jobsDir, { withFileTypes: true });
    const projects = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    if (projects.length === 0) {
      logger.warn(`No projects found in ${config.jobsDir}`);
      return;
    }

    // One project failing must not stop the rest. Each is isolated and the run
    // reports a summary at the end rather than aborting.
    let succeeded = 0;
    const failed: string[] = [];

    for (const projectId of projects) {
      const projectLogger = logger.forProject(projectId);
      try {
        await runPipeline({
          module: videoModule,
          projectId,
          config,
          logger: projectLogger,
          force: opts.force,
          useMockTts: opts.mockTts,
          allowStoryboardGeneration: true,
        });
        succeeded++;
      } catch (err) {
        failed.push(projectId);
        projectLogger.error(describeError(err));
      }
    }

    logger.done(`Batch finished: ${succeeded} succeeded, ${failed.length} failed`);
    if (failed.length > 0) {
      logger.warn(`Failed: ${failed.join(', ')}`);
      process.exitCode = 1;
    }
  });

program
  .command('validate')
  .argument('<video>', 'path to an MP4')
  .description('Check an output file: resolution, streams, duration and real narration')
  .action(async (video: string) => {
    const config = loadModuleConfig();
    const logger = createLogger({ level: config.logLevel });

    const report = await validateOutput(video, {
      expectedWidth: config.video.width,
      expectedHeight: config.video.height,
      minDurationSec: 30,
      maxDurationSec: 3600,
    });

    const m = report.measured;
    console.log(`  size          : ${(m.sizeBytes / 1e6).toFixed(2)} MB`);
    console.log(`  resolution    : ${m.width ?? '?'}x${m.height ?? '?'}`);
    console.log(`  video codec   : ${m.videoCodec ?? 'NONE'}`);
    console.log(`  audio codec   : ${m.audioCodec ?? 'NONE'}`);
    console.log(`  duration      : ${m.durationSec.toFixed(2)}s`);
    console.log(
      `  silence ratio : ${Number.isNaN(m.silenceRatio) ? 'unmeasurable' : `${(m.silenceRatio * 100).toFixed(1)}%`}`,
    );

    for (const warning of report.warnings) logger.warn(warning);

    if (report.ok) {
      logger.done('Valid');
    } else {
      for (const problem of report.problems) logger.error(`${problem.code}: ${problem.message}`);
      process.exitCode = 1;
    }
  });

/**
 * Shared by `regenerate-content` and `generate-storyboard`: both must force a
 * fresh Claude call even when a storyboard.json already exists, which means
 * setting the existing file aside first - `runPipeline` only calls the AI when
 * none is present. The only difference between the two commands
 * is whether the pipeline continues on to TTS/render afterwards.
 */
async function regenerateStoryboard(
  projectId: string,
  config: AppConfig,
  logger: ReturnType<typeof createLogger>,
  opts: { storyboardOnly: boolean },
): Promise<PipelineResult> {
  const paths = jobPaths(config.jobsDir, projectId);
  const backup = `${paths.storyboardJson}.previous`;

  // Set aside rather than delete. Deleting first meant a rejected
  // regeneration left the project with no storyboard at all - strictly worse
  // than the one it had been asked to improve on, and the working copy was
  // gone.
  const had = await rename(paths.storyboardJson, backup).then(
    () => true,
    () => false,
  );
  if (had) logger.step('Existing storyboard set aside');

  try {
    const result = await runPipeline({
      module: videoModule,
      projectId,
      config,
      logger,
      force: true,
      storyboardOnly: opts.storyboardOnly,
      allowStoryboardGeneration: true,
    });
    await rm(backup, { force: true });
    return result;
  } catch (err) {
    if (had) {
      await rename(backup, paths.storyboardJson).catch(() => {});
      logger.warn('Regeneration failed; restored the previous storyboard');
    }
    throw err;
  }
}

/**
 * Accepts either a path or a bare id, because the two callers naturally use
 * different forms: the Drive workflow passes a path, while a person at a
 * terminal reaches for the project name.
 */
function resolveProjectId(input: string, jobsDir: string): string {
  const resolved = path.resolve(input);
  if (resolved.startsWith(path.resolve(jobsDir))) return path.basename(resolved);
  if (!input.includes(path.sep)) return input;
  return path.basename(resolved);
}

/** Fails early and with the fix, rather than at the first 401. */
function assertYouTubeConfigured(config: AppConfig): void {
  if (config.youtube.clientId && config.youtube.clientSecret) return;

  throw new Error(
    'YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are not set in .env. Create an OAuth client ' +
      '(Desktop app) in Google Cloud Console with the YouTube Data API v3 enabled, then paste ' +
      'both values in. See the comments in .env.example.',
  );
}

async function run(fn: () => Promise<unknown>, logger: ReturnType<typeof createLogger>) {
  try {
    await fn();
  } catch (err) {
    logger.error(describeError(err));
    process.exitCode = 1;
  }
}

function describeError(err: unknown): string {
  if (isPipelineError(err)) return `${err.code} at ${err.stage}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

// A stray rejection anywhere must be logged, not left to kill the process
// silently mid-batch.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exitCode = 1;
});

/**
 * Titles of every project on disk, so a new suggestion is not a repeat.
 *
 * Read from the storyboards rather than from a list somebody maintains: the
 * storyboard is the only record of what a video actually turned out to be
 * about, and it is written before the render, so a draft counts too.
 */
async function readCoveredTitles(config: AppConfig, exceptProjectId: string): Promise<string[]> {
  const entries = await readdir(config.jobsDir, { withFileTypes: true }).catch(() => []);
  const titles: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === exceptProjectId) continue;

    const raw = await readFile(
      jobPaths(config.jobsDir, entry.name).storyboardJson,
      'utf8',
    ).catch(() => null);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as { project?: { episodeTitle?: string } };
      const title = parsed.project?.episodeTitle;
      if (title) titles.push(title);
    } catch {
      // A malformed storyboard is not worth failing a suggestion over.
    }
  }

  return titles;
}

// Commands that exist only for one pipeline. The module registers its own, so
// adding a third does not mean remembering to add a line here.
videoModule.registerCommands?.(program, loadModuleConfig, run);

program.parseAsync(process.argv);
