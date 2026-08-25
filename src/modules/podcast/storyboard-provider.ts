import path from 'node:path';
import {
  StoryboardDraftSchema,
  checkStoryboardStructure,
  type AvailableAssets,
  type Storyboard,
  type StoryboardDraft,
} from './domain/storyboard';
import type { Brief } from './domain/brief';
import { countWords, narrationFromScenes } from '../../domain/storyboard';
import { ERROR_CODES, PipelineError } from '../../domain/errors';
import type { AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import { callClaude, extractJson } from '../../ai/claude-runner';
import { checkFacts } from '../../ai/fact-guard';
import { factGuardLanguage } from './fact-guard-lang';
import { buildRetryPrompt, buildStoryboardPrompt, targetWordsFor } from './prompts/generate-storyboard';
import { languageOf } from '../../tts/types';
import type { GenerateStoryboardInput } from '../contract';

/**
 * Storyboard generation for a podcast episode.
 *
 * Unlike the fact module, the model *is* given a tool: `Read`, scoped to the
 * library's preview directory. It has to be, because half the creative work
 * here is deciding which photograph belongs under which paragraph, and that
 * cannot be done from filenames. It reads the 768px previews rather than the
 * originals, which is why those exist.
 *
 * Three gates, the same three as the other module: schema, structure, facts.
 * A failure at any of them is fed back verbatim and retried.
 *
 * The feedback is English, like the prompt and like the episode.
 */
const MAX_ATTEMPTS = 3;

/**
 * Bounded so a stalled call fails the job rather than hanging the queue.
 *
 * Fifteen minutes, and far longer than the fact module's three: this call reads
 * every preview in the library before it writes a word, and a large library is
 * minutes of that on its own.
 */
const CLAUDE_TIMEOUT_MS = 900_000;

export interface PodcastGenerateInput extends GenerateStoryboardInput<Brief> {
  /** What the storyboard may reference: the backdrops in the library. */
  assets: AvailableAssets;
  /** The shared library's preview root - holds one sub-folder per kind. */
  previewDir: string;
}

export async function generateStoryboard(
  input: PodcastGenerateInput,
  config: AppConfig,
  logger: Logger,
): Promise<Storyboard> {
  const basePrompt = buildStoryboardPrompt({
    projectId: input.projectId,
    workingTitle: input.info?.name ?? input.projectId,
    info: input.info,
    assets: input.assets,
    previewDir: path.resolve(input.previewDir),
    targetDurationSec: input.targetDurationSec,
    defaultStyle: config.video.style,
    defaultVoice: config.tts.voice,
    brief: input.brief,
  });

  const targetWords = targetWordsFor(input.targetDurationSec);

  // Read, scoped to the previews and nothing else. The model needs to look at
  // the photographs; it has no reason to see the rest of the filesystem.
  const extraArgs = ['Read', '--add-dir', path.resolve(input.previewDir)];

  let prompt = basePrompt;
  let lastProblem = 'unknown';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) logger.warn(`Retrying Claude (attempt ${attempt}/${MAX_ATTEMPTS})`);

    const raw = await callClaude(prompt, config, logger, {
      timeoutMs: CLAUDE_TIMEOUT_MS,
      extraArgs,
    });
    const json = extractJson(raw);

    if (!json) {
      lastProblem = 'The response did not contain a JSON object.';
      prompt = buildRetryPrompt(basePrompt, lastProblem);
      continue;
    }

    const parsed = StoryboardDraftSchema.safeParse(json);
    if (!parsed.success) {
      lastProblem = parsed.error.issues
        .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
      logger.warn(`Storyboard failed schema validation:\n${lastProblem}`);
      prompt = buildRetryPrompt(basePrompt, `Schema errors:\n${lastProblem}`);
      continue;
    }

    const structural = checkStoryboardStructure(parsed.data, input.assets, targetWords);
    if (structural.length > 0) {
      lastProblem = structural.map((p) => `- ${p}`).join('\n');
      logger.warn(`Storyboard failed structural checks:\n${lastProblem}`);
      prompt = buildRetryPrompt(basePrompt, `Structural problems:\n${lastProblem}`);
      continue;
    }

    const facts = checkFacts(parsed.data, input.info, factGuardLanguage);
    if (!facts.ok) {
      lastProblem = facts.feedback;
      logger.warn(
        `Fact guard rejected ${facts.violations.length} unsourced claim(s): ` +
          facts.violations.map((v) => `"${v.matched}"`).join(', '),
      );
      prompt = buildRetryPrompt(basePrompt, facts.feedback);
      continue;
    }

    logger.done(
      `Script accepted: ${parsed.data.scenes.length} scenes, ` +
        `${countWords(narrationFromScenes(parsed.data))} words ` +
        `(target ${targetWords})${facts.applied ? '' : ', fact guard not applied (no info.json)'}`,
    );

    return toStoryboard(parsed.data, input.targetDurationSec, config);
  }

  throw new PipelineError(
    ERROR_CODES.AI_FACT_VIOLATION,
    'generate-storyboard',
    `Claude did not produce an acceptable storyboard in ${MAX_ATTEMPTS} attempts. Last problem:\n${lastProblem}`,
  );
}

/** Fills in everything the model was deliberately not asked for. */
function toStoryboard(
  draft: StoryboardDraft,
  targetDurationSec: number,
  config: AppConfig,
): Storyboard {
  return {
    version: '1.0',
    project: draft.project,
    video: {
      width: config.video.width,
      height: config.video.height,
      fps: config.video.fps,
      targetDuration: targetDurationSec,
      durationMin: config.video.durationMin,
      durationMax: config.video.durationMax,
      style: draft.video.style,
    },
    voice: {
      language: languageOf(draft.voice.voice, 'en-US'),
      provider: config.tts.engine,
      voice: draft.voice.voice,
      rate: draft.voice.rate ?? config.tts.rate,
      pitch: config.tts.pitch,
    },
    content: {
      summary: draft.content.summary,
      narration: narrationFromScenes(draft),
    },
    publish: draft.publish,
    scenes: draft.scenes,
  };
}
