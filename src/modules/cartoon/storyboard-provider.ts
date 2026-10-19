import {
  StoryboardDraftSchema,
  checkStoryboardStructure,
  type Storyboard,
  type StoryboardDraft,
} from './domain/storyboard';
import { countWords, narrationFromScenes } from '../../domain/storyboard';
import { ERROR_CODES, PipelineError } from '../../domain/errors';
import { findSimilarTopic } from '../../pipeline/topic-ledger';
import type { AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import { callClaude, extractJson } from '../../ai/claude-runner';
import { buildRetryPrompt, buildStoryboardPrompt } from './prompts/generate-storyboard';
import { availableSoundEffects } from '../../audio/sfx';
import { CARTOON_WORDS_PER_MINUTE } from './voices';
import type { GenerateStoryboardInput } from '../contract';
import type { Brief } from './domain/brief';

/**
 * The one call in this repository that reaches the internet.
 *
 * Every other prompt runs with `--allowedTools ''` - text in, text out. This
 * one is given WebSearch, because the channel's premise is finding what people
 * are actually posting rather than remembering what absurdity sounds like.
 *
 * That buys two costs, both accepted deliberately:
 *
 * **It is slower**, because the model searches before it writes. The timeout is
 * therefore much larger than the shorts modules', which is the difference
 * between a call that thinks and a call that reads.
 *
 * **What it reads is untrusted.** The prompt says so in as many words, and it
 * has to: a channel whose whole job is hunting for strange text online will
 * eventually find a page telling it to ignore its instructions. Nothing here
 * grants file or shell access, so the blast radius of a page that tries is a
 * bad script, caught by the same three gates as any other bad script.
 */

const MAX_ATTEMPTS = 3;

/**
 * Eight minutes.
 *
 * The shorts modules allow three, and they only think. This one runs several
 * searches, reads what comes back and then writes - and the searching happens
 * before a single word of the script exists, so the whole budget is spent
 * before the part that could be cut short.
 */
const CLAUDE_TIMEOUT_MS = 480_000;

export async function generateStoryboard(
  input: GenerateStoryboardInput<Brief>,
  config: AppConfig,
  logger: Logger,
): Promise<Storyboard> {
  const effects = await availableSoundEffects(config.sfxDir);
  logger.step(
    effects.length
      ? `Tiếng động có sẵn: ${effects.map((e) => e.id).join(', ')}`
      : 'Chưa có file nào trong assets/sfx - video này sẽ không có tiếng động',
  );

  const basePrompt = buildStoryboardPrompt({
    projectId: input.projectId,
    workingTitle: input.info?.name ?? input.projectId,
    info: input.info,
    targetDurationSec: input.targetDurationSec,
    defaultStyle: config.video.style,
    channelName: config.channelName,
    brief: input.brief,
    soundEffects: effects,
  });

  const targetWords = Math.round((input.targetDurationSec / 60) * CARTOON_WORDS_PER_MINUTE);
  const available = effects.map((e) => e.id);

  let prompt = basePrompt;
  let lastProblem = 'unknown';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) logger.warn(`Retrying Claude (attempt ${attempt}/${MAX_ATTEMPTS})`);

    const raw = await callClaude(prompt, config, logger, {
      timeoutMs: CLAUDE_TIMEOUT_MS,
      // Search only. No file access, no shell: the model is here to read the
      // open web and write a script, and nothing it finds should be able to
      // reach this machine.
      extraArgs: ['WebSearch'],
    });

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
      logger.warn(`Storyboard failed schema validation:\n${lastProblem}`);
      prompt = buildRetryPrompt(basePrompt, `Lỗi schema:\n${lastProblem}`);
      continue;
    }

    const structural = checkStoryboardStructure(parsed.data, targetWords, available);
    if (structural.length > 0) {
      lastProblem = structural.map((p) => `- ${p}`).join('\n');
      logger.warn(`Storyboard failed structural checks:\n${lastProblem}`);
      prompt = buildRetryPrompt(basePrompt, `Lỗi cấu trúc:\n${lastProblem}`);
      continue;
    }

    /*
     * The duplicate gate.
     *
     * Last of the checks and deliberately so: it is the only one that needs to
     * know about videos other than this one, and there is no point asking
     * whether a script repeats itself before knowing it is a valid script at
     * all. Fed back like every other violation, so the model rewrites rather
     * than the run dying.
     */
    const repeat = findSimilarTopic(parsed.data.project.episodeTitle, input.alreadyCovered);
    if (repeat) {
      lastProblem =
        `Đề tài "${parsed.data.project.episodeTitle}" trùng với video kênh đã làm: ` +
        `"${repeat}". Chọn một đề tài khác hẳn, đừng viết lại cùng một chuyện bằng câu khác.`;
      logger.warn(lastProblem);
      prompt = buildRetryPrompt(basePrompt, lastProblem);
      continue;
    }

    /*
     * No fact guard here, and that is not an oversight.
     *
     * The guard exists to stop a channel stating unsourced figures as truth.
     * This channel states nothing as truth - a cat explaining that fish swim
     * ashore to drink is the joke, and a checker that rejected it would reject
     * the format. What replaces it is in the prompt: do not name a real person,
     * do not punch down, do not copy anyone's words.
     */
    logger.done(
      `Script accepted: ${parsed.data.scenes.length} lượt thoại, ` +
        `${countWords(narrationFromScenes(parsed.data))} từ (target ${targetWords})`,
    );

    return toStoryboard(parsed.data, input.targetDurationSec, config);
  }

  throw new PipelineError(
    ERROR_CODES.AI_INVALID_OUTPUT,
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
      language: 'vi-VN',
      provider: config.tts.engine,
      // Recorded, not used: every line is spoken by its own character's voice.
      voice: draft.voice.voice,
      rate: config.tts.rate,
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
