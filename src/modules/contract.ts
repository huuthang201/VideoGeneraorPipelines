import type { CaptionPage } from '../domain/timeline';
import type { ModuleId, Pacing, VideoConfig } from '../domain/config';
import type { PublishMeta } from '../domain/storyboard';
import type { ProductInfo } from '../domain/project';
import type { BaseBrief, SuggestedBrief } from '../domain/brief';
import type { AppConfig } from '../config/env';
import type { Logger } from '../utils/logger';
import type { WordTiming } from '../tts/types';
import type { SceneBackdrop } from '../pipeline/build-timeline';
import type { Command } from 'commander';

/**
 * What a module is, from the shared pipeline's point of view.
 *
 * The two pipelines in this repository - a five-to-ten minute English podcast
 * and a thirty-to-sixty second Vietnamese fact short - share about two thirds
 * of their code and differ in ways that are not incidental: where the pictures
 * come from, which language the narrator speaks, how a subtitle is laid out,
 * how long a scene may be, which YouTube channel it publishes to. This file is
 * the seam. Everything above it is shared; everything a module names here is
 * its own.
 *
 * The rule for deciding which side something belongs on: **if the two forks
 * differed only in a number or in prose, it is shared and the number is a
 * parameter. If they differed in behaviour, the module owns it.** Collapsing a
 * behavioural difference into a flag is how two pipelines quietly turn into one
 * mediocre one.
 */

/**
 * The scene fields the shared pipeline actually touches.
 *
 * Structural rather than a base class, so each module's own `Scene` - which
 * adds `environment` and `narrationVi`, or `imageQuery` - satisfies it without
 * any declaration saying so.
 */
export interface SceneLike {
  id: string;
  type: 'intro' | 'segment' | 'outro';
  title: string;
  narration: string;
  duration: number;
  animation:
    | 'none'
    | 'drift'
    | 'zoom-in'
    | 'zoom-out'
    | 'pan-left'
    | 'pan-right'
    | 'pan-up'
    | 'pan-down';
  transition: 'fade' | 'cut';
  effect: 'none' | 'vignette';
  overlay: 'none' | 'dust' | 'bokeh' | 'rain' | 'light-sweep';
}

/** The storyboard fields the shared pipeline actually touches. */
export interface StoryboardLike<S extends SceneLike = SceneLike> {
  version: '1.0';
  project: { id: string; episodeTitle: string };
  video: VideoConfig;
  voice: {
    language: string;
    provider: string;
    voice: string;
    rate?: string | undefined;
    pitch?: string | undefined;
  };
  content: { summary: string; narration: string };
  publish?: PublishMeta | undefined;
  scenes: S[];
}

/** How a module's storyboard generator is called. */
export interface GenerateStoryboardInput<B> {
  projectId: string;
  info: ProductInfo | null;
  brief: B | null;
  /**
   * Length in seconds, already resolved from the brief or from configuration.
   *
   * Resolved by the caller rather than here so the two entry points (`generate`
   * and `regenerate-content`) cannot disagree about it.
   */
  targetDurationSec: number;
}

/** What the image stage returns. */
export interface ResolvedBackdrops {
  backdrops: Map<string, SceneBackdrop>;
  /**
   * What to copy into the Remotion bundle, and where a staged file then lives.
   *
   * Part of the module's answer rather than the pipeline's, because the two
   * stage very differently and for a good reason on each side. The podcast
   * module copies the library's whole `images` directory: it is a curated set
   * of a known size, and the (kind, filename) layout has to survive into the
   * bundle. The fact module names each file individually, because its stock
   * cache is shared and grows with every video ever made - copying the
   * directory would make every render slower than the last.
   */
  staging: {
    directories?: Record<string, string>;
    files?: Record<string, string>;
  };
  /** Where a staged photograph lives, relative to the Remotion public dir. */
  imageSrcFor: (publicPrefix: string, image: SceneBackdrop['image']) => string;
  /** A line for the operator once the stage completes. */
  summary: string;
}

/**
 * What a module is given when asked to draft a brief.
 *
 * A superset: the podcast ignores `alreadyCovered` and a shorts channel
 * ignores nothing, but one shape means the CLI and the server can ask without
 * knowing which module is answering.
 */
export interface SuggestBriefInput {
  /** The project's name - the only thing anyone types before asking. */
  topic: string;
  info: ProductInfo | null;
  /** Titles this channel has already used. */
  alreadyCovered: readonly string[];
}

/**
 * One pipeline.
 *
 * Generic over its own brief, scene and storyboard types so a module stays
 * strongly typed inside itself while the shared pipeline sees only the parts it
 * needs.
 */
export interface VideoModule<
  B extends BaseBrief = BaseBrief,
  S extends SceneLike = SceneLike,
  T extends StoryboardLike<S> = StoryboardLike<S>,
> {
  readonly id: ModuleId;
  /** Shown in the UI and in CLI help. */
  readonly label: string;
  /** One line describing what this module makes. */
  readonly description: string;

  /** Scene-duration bounds and the measured speaking pace. */
  readonly pacing: Pacing;

  /**
   * How far a photograph may be from the frame's shape and still be cropped to
   * fill it rather than blurred at the edges. See `defaultFitFor`.
   */
  readonly coverTolerance: number;

  /**
   * Sanity floor and runaway ceiling on a finished file, in seconds.
   *
   * Deliberately far wider than `video.durationMin/Max`, which describe the
   * video that was *asked* for: a podcast that comes in at four and a half
   * minutes instead of five is a fine video, and failing the render would throw
   * away the whole job over a preference. Length is really enforced by the word
   * budget, long before a render has been spent on it.
   *
   * Per module because the two formats are an order of magnitude apart - a
   * ceiling that is a generous runaway guard for a short is a hard stop for
   * every episode the podcast produces.
   */
  readonly outputDurationGuard: { minSeconds: number; maxSeconds: number };

  /**
   * Ceiling on a single TTS call, in milliseconds.
   *
   * One call carries the whole script, so this tracks how long the script is:
   * ten minutes of speech does not come back in the time forty-five seconds
   * does, and a ceiling suited to one fails every video of the other.
   */
  readonly ttsTimeoutMs: number;

  /**
   * Parse a project's `brief.json`, or throw a zod error.
   *
   * The two schemas are `strictObject`, so a brief from the wrong module fails
   * loudly here rather than rendering something odd. That is deliberate: the
   * two ask for length in different units, and a `targetMinutes` silently read
   * as seconds would produce a seven-second video.
   */
  parseBrief(raw: unknown): B;
  /** Parse a project's `storyboard.json`, or throw a zod error. */
  parseStoryboard(raw: unknown): T;
  /** The requested length in seconds, or null to fall back to configuration. */
  targetSecondsOf(brief: B | null): number | null;

  /**
   * Apply whatever ceiling the format imposes on a requested length.
   *
   * The fact module clamps to sixty seconds, because past that YouTube stops
   * serving the upload in the Shorts feed. The podcast module has no such
   * cliff and passes the request through.
   */
  resolveTargetSeconds(requestedSec: number, config: AppConfig, logger: Logger): number;

  /**
   * Refuse a voice that does not speak this module's language.
   *
   * Checked before TTS runs rather than after, because the alternative is
   * discovering it once a whole episode has been spoken in the wrong accent.
   */
  assertVoiceUsable(voice: string, engine: string): void;

  /**
   * Draft a starting brief for a project nobody has written into.
   *
   * On the module because the two ask in genuinely different ways: the podcast
   * *looks at* the shared library, since the photographs are what an episode
   * can be about, while a shorts channel has nothing to look at yet and is
   * given the project's name plus the titles it has already used, so the
   * suggestion is on topic and not a repeat.
   *
   * It moved here from the CLI, where it was an `if (module.id === …)`. That
   * shape costs nothing with two modules and one more arm with every module
   * after - and forgetting an arm is a channel that silently suggests another
   * channel's subject matter.
   */
  suggestBrief(
    config: AppConfig,
    logger: Logger,
    input: SuggestBriefInput,
  ): Promise<SuggestedBrief>;

  /**
   * Commands that exist only for this pipeline, if any.
   *
   * `stock-search` has no meaning for the podcast, whose photographs are
   * uploaded rather than found; `library` has none for a channel that has no
   * library. Registered by the module so a new one arrives with its own.
   */
  registerCommands?(
    program: Command,
    loadModuleConfig: () => AppConfig,
    run: (fn: () => Promise<void>, logger: Logger) => Promise<void>,
  ): void;

  /** Ask Claude for a storyboard. Only called when there is not one already. */
  generateStoryboard(
    input: GenerateStoryboardInput<B>,
    config: AppConfig,
    logger: Logger,
  ): Promise<T>;

  /**
   * Find the photograph for every scene.
   *
   * The podcast module reads them out of the shared uploaded library; the fact
   * module searches Openverse for each scene's query and downloads what it
   * finds. Note *when* this runs relative to the storyboard: it has to be
   * after, for the fact module, because the queries live inside the storyboard.
   */
  resolveBackdrops(input: {
    storyboard: T;
    config: AppConfig;
    logger: Logger;
    brief: B | null;
  }): Promise<ResolvedBackdrops>;

  /** Turn a scene's measured words into subtitle pages. */
  buildCaptions(input: {
    words: readonly WordTiming[];
    sceneStartMs: number;
    durationInFrames: number;
    fps: number;
    scene: S;
  }): CaptionPage[];

  /**
   * Everything that goes into the module's input hash beyond the shared parts.
   *
   * The hash decides whether a re-run is a no-op. Anything that changes the
   * output without changing the storyboard has to be in here, or a run reports
   * "already up to date" and leaves the old video in place - the podcast
   * module's backdrop selection is exactly such a thing.
   */
  hashInputs(input: { brief: B | null; config: AppConfig }): Record<string, string>;
}
