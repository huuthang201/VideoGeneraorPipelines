import {
  StoryboardDraftSchema,
  checkStoryboardStructure,
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
 * Storyboard generation for a fact short.
 *
 * The model writes the script and names the visual themes; it is given no tools
 * at all, because there is nothing on disk for it to look at - the photographs
 * are searched for afterwards, using the queries it returns. Everything it
 * produces is run through three gates before the pipeline will touch it:
 *
 *   1. schema    - shape and whitelisted enum values
 *   2. structure - intro first, outro last, every scene pointing at a declared
 *                  image query, and a script that runs the requested length in
 *                  both directions
 *   3. facts     - no figures or claims absent from info.json, when there is one
 *
 * A failure at any gate is fed back verbatim and retried. Echoing the specific
 * violation works far better than asking the model to try again, and it keeps
 * the budget at one call for the common case.
 *
 * The feedback is Vietnamese, like the prompt and like the script. Mixing the
 * two languages in one conversation is how a model starts answering in the
 * wrong one.
 */

/**
 * Attempts at an acceptable draft.
 *
 * Three. The extra attempt over the obvious two exists for one failure mode:
 * a script that misses the word budget. At this length that is usually an
 * overrun rather than a shortfall, and it is the rejection most reliably fixed
 * by echoing the measured count back - the model cuts accurately when told how
 * much to cut, and guesses when merely told to be shorter.
 */
const MAX_ATTEMPTS = 3;

/**
 * Bounded so a stalled call fails the job rather than hanging the queue.
 *
 * Three minutes, which is far above the observed tail now that the call is text
 * in and text out - it was five when the model still had to read every
 * photograph in a library before writing.
 */
const CLAUDE_TIMEOUT_MS = 180_000;

export async function generateStoryboard(
  input: GenerateStoryboardInput<Brief>,
  config: AppConfig,
  logger: Logger,
): Promise<Storyboard> {
  const basePrompt = buildStoryboardPrompt({
    projectId: input.projectId,
    workingTitle: input.info?.name ?? input.projectId,
    info: input.info,
    targetDurationSec: input.targetDurationSec,
    defaultStyle: config.video.style,
    defaultVoice: config.tts.voice,
    channelName: config.channelName,
    brief: input.brief,
  });

  const targetWords = targetWordsFor(input.targetDurationSec);

  let prompt = basePrompt;
  let lastProblem = 'unknown';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) logger.warn(`Retrying Claude (attempt ${attempt}/${MAX_ATTEMPTS})`);

    const raw = await callClaude(prompt, config, logger, { timeoutMs: CLAUDE_TIMEOUT_MS });
    const json = extractJson(raw);

    if (!json) {
      lastProblem = 'Câu trả lời không chứa object JSON nào.';
      prompt = buildRetryPrompt(basePrompt, lastProblem);
      continue;
    }

    const parsed = StoryboardDraftSchema.safeParse(json);
    if (!parsed.success) {
      lastProblem = parsed.error.issues
        .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
      // The specific issues, not just "validation failed" - without them there
      // is no way to tell whether the model got the shape wrong or the schema
      // is too strict.
      logger.warn(`Storyboard failed schema validation:\n${lastProblem}`);
      prompt = buildRetryPrompt(basePrompt, `Lỗi schema:\n${lastProblem}`);
      continue;
    }

    const structural = checkStoryboardStructure(parsed.data, targetWords);
    if (structural.length > 0) {
      lastProblem = structural.map((p) => `- ${p}`).join('\n');
      logger.warn(`Storyboard failed structural checks:\n${lastProblem}`);
      prompt = buildRetryPrompt(basePrompt, `Lỗi cấu trúc:\n${lastProblem}`);
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
      language: languageOf(draft.voice.voice, 'vi-VN'),
      provider: config.tts.engine,
      voice: draft.voice.voice,
      rate: draft.voice.rate ?? config.tts.rate,
      pitch: config.tts.pitch,
    },
    content: {
      summary: draft.content.summary,
      narration: narrationFromScenes(draft),
      imageQueries: draft.content.imageQueries,
    },
    publish: draft.publish,
    scenes: draft.scenes,
  };
}
