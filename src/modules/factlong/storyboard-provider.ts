import {
  MAX_EVENT_QUERIES,
  OutlineSchema,
  allQueriesOf,
  checkOutline,
  type Outline,
  type SectionPlan,
} from './domain/outline';
import {
  SectionDraftSchema,
  StoryboardDraftSchema,
  checkSection,
  checkStoryboardStructure,
  lengthBandFrom,
  type Storyboard,
  type StoryboardDraft,
} from './domain/storyboard';
import type { Scene } from './domain/scene';
import { commonsCategoriesFrom, extractSources, isImageSource, type Brief } from './domain/brief';
import { countWords, narrationFromScenes } from '../../domain/storyboard';
import { ERROR_CODES, PipelineError } from '../../domain/errors';
import { findSimilarTopic } from '../../pipeline/topic-ledger';
import type { AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { callClaude, extractJson } from '../../ai/claude-runner';
import { targetWordsFor } from './pacing';
import { buildOutlinePrompt } from './prompts/outline';
import { buildSectionPrompt } from './prompts/section';
import { languageOf } from '../../tts/types';
import type { GenerateStoryboardInput } from '../contract';

/**
 * Storyboard generation for a long fact video: research once, then write in
 * pieces.
 *
 * Every other module in this repository asks Claude for a script in one call
 * and checks what comes back. That does not survive being scaled up. Seventeen
 * minutes of Vietnamese is five and a half thousand syllables, and asked for
 * all of it at once a model writes the opening properly and then compresses -
 * the later sections arrive as summaries of themselves. Nothing measurable
 * fails; the video is simply hollow after minute five.
 *
 * So the shape here is:
 *
 *   1. **one research call**, with web search, which returns a plan and a list
 *      of sourced facts - and is the only call allowed to look anything up
 *   2. **one call per section**, with no tools, each writing a few hundred
 *      syllables from that list and from nothing else
 *   3. **one structural check** on the assembled video
 *
 * The single-researcher rule is the part that matters most. A live disaster's
 * death toll moves daily; ten sections each free to search would each find a
 * different one, and the video would contradict itself between minute four and
 * minute eleven without any single call having been wrong.
 */

/** Attempts at an acceptable outline. The expensive call, so not many. */
const OUTLINE_ATTEMPTS = 3;

/**
 * Attempts at one section.
 *
 * Two rather than three. A section rejection is nearly always a word count, the
 * feedback names the number, and a model told how much to cut cuts accurately
 * on the first try. Spending a third call on each of twelve sections to rescue
 * the rare stubborn one costs more than accepting the section slightly off its
 * budget - which the whole-video band then absorbs.
 */
const SECTION_ATTEMPTS = 2;

/**
 * Twelve minutes for the research call.
 *
 * Far above the others in this repository, and it has to be: this call makes
 * half a dozen web searches, reads what comes back, and only then writes a
 * couple of thousand tokens of JSON. Measured at eleven and a half minutes on
 * the first real run, which is most of it.
 */
const OUTLINE_TIMEOUT_MS = 720_000;

/**
 * Six minutes for a section, not the three the other modules use.
 *
 * Three is what a short's single call needs and it was the obvious number to
 * copy; the first real run timed out on section one at exactly that. A section
 * call is not a small call - the prompt carries the whole fact list and every
 * image query, and the answer is six hundred syllables of Vietnamese prose
 * inside JSON. Nine of those with no headroom is nine chances to lose a
 * completed research pass.
 */
const SECTION_TIMEOUT_MS = 360_000;

/** Appended verbatim on a retry so the model sees exactly what was wrong. */
function retryPrompt(original: string, problems: string): string {
  return [
    original,
    ``,
    `---`,
    ``,
    `## Bản trước đã bị từ chối`,
    ``,
    problems,
    ``,
    `Sửa lại và trả về JSON đã sửa. Vẫn chỉ JSON, không gì khác.`,
  ].join('\n');
}

/** The last sentence of what has been written, to hand to the next section. */
function tailOf(scenes: readonly Scene[], maxChars = 220): string {
  const text = scenes.map((s) => s.narration).join(' ').trim();
  if (text.length <= maxChars) return text;

  const cut = text.slice(-maxChars);
  const boundary = cut.search(/[.!?…]\s+\S/u);
  return (boundary === -1 ? cut : cut.slice(boundary + 1)).trim();
}

export async function generateStoryboard(
  input: GenerateStoryboardInput<Brief>,
  config: AppConfig,
  logger: Logger,
): Promise<Storyboard> {
  const targetWords = targetWordsFor(input.targetDurationSec);

  const context = input.brief?.context?.trim();
  if (!context) {
    /*
     * No "pick something for me" path, unlike every other module.
     *
     * A short can be about anything the model finds interesting; the cost of a
     * poor choice is thirty seconds. Here a poor choice is a dozen Claude
     * calls, a web research pass and a twenty-minute render, and the module
     * exists to cover a subject somebody decided to cover.
     */
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'generate-storyboard',
      'Video dài phải có chủ đề: điền "Nội dung" trong brief (brief.context). Module này ' +
        'không tự chọn đề tài - một lựa chọn sai ở đây tốn cả chục lượt gọi Claude và một ' +
        'lượt render hai mươi phút.',
    );
  }

  /*
   * The sources, from wherever the person put them.
   *
   * `brief.sources` is only filled in when a project is created from a prompt.
   * A person who writes their idea into the project's own brief box instead -
   * which is where the idea obviously goes - pastes the same links into
   * `context`, and those were being read as prose: the research call was never
   * told to fetch them, never granted the tool to, and found them again only if
   * its own searching happened to land there. Measured on a real project: six
   * articles pasted into the brief, `sources` absent, and two of the six cited -
   * by accident.
   *
   * So the links are recovered from the text here, at the one point every path
   * into this module passes through, rather than at each place a brief can be
   * written.
   */
  const brief: Brief | null = input.brief
    ? {
        ...input.brief,
        sources: input.brief.sources?.length
          ? input.brief.sources
          : extractSources(input.brief.context ?? ''),
      }
    : null;
  if (brief?.sources?.length) {
    logger.step(
      `Đọc ${brief.sources.length} nguồn người dùng đính kèm trước khi tra cứu thêm ` +
        `(${brief.sources.filter(isImageSource).length} nguồn ảnh, ` +
        `${brief.sources.filter((u) => !isImageSource(u)).length} nguồn chỉ lấy chữ)`,
    );
  }
  input = { ...input, brief };

  const outline = await outlineFor(input, context, targetWords, config, logger);
  const scenes = await writeSections(outline, config, logger);

  const draft: StoryboardDraft = {
    version: '1.0',
    project: { id: input.projectId, episodeTitle: outline.episodeTitle },
    video: { style: config.video.style },
    voice: { voice: config.tts.voice },
    content: {
      summary: outline.summary,
      narration: '',
      imageQueries: allQueriesOf(outline),
      facts: outline.facts,
    },
    publish: outline.publish,
    scenes,
  };

  const parsed = StoryboardDraftSchema.safeParse(draft);
  if (!parsed.success) {
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'generate-storyboard',
      `Ghép các phần lại không tạo ra storyboard hợp lệ:\n${parsed.error.issues
        .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n')}`,
    );
  }

  const band = lengthBandFrom(
    config.video.targetDuration,
    config.video.durationMin,
    config.video.durationMax,
  );
  const problems = checkStoryboardStructure(parsed.data, targetWords, band);

  /*
   * Reported rather than thrown, and this is the one place this module is
   * deliberately softer than the shorts.
   *
   * There, a draft outside the band is one cheap call away from being fixed.
   * Here it is a dozen calls and a web research pass, and the failure it would
   * be rejecting is a video sixty seconds longer than asked for - which is
   * nothing on a seventeen-minute video with no platform cliff anywhere near
   * it. Throwing away good research over that would be the expensive mistake,
   * not the safe one.
   */
  if (problems.length > 0) {
    logger.warn(
      `Kịch bản ghép xong còn lệch so với khung:\n${problems.map((p) => `- ${p}`).join('\n')}`,
    );
  }

  const words = countWords(narrationFromScenes(parsed.data));
  logger.done(
    `Script assembled: ${outline.sections.length} sections, ${scenes.length} scenes, ` +
      `${words} words (target ${targetWords}), ${outline.facts.length} sourced facts`,
  );

  return toStoryboard(parsed.data, input.targetDurationSec, config);
}

/**
 * Where a project's research is kept between runs.
 *
 * Beside the storyboard rather than in the shared cache, because it belongs to
 * this video: the facts in it are the ones this script was written from, and a
 * re-run that found different numbers would silently make the finished video
 * disagree with its own sources.
 */
const outlinePath = (config: AppConfig, projectId: string) =>
  path.join(config.jobsDir, projectId, 'outline.json');

/**
 * The outline, from disk if this project already has one.
 *
 * The research call is twelve minutes of web searching and by far the most
 * expensive thing this module does - and on the first real run all of it was
 * thrown away because the *next* call, a section, timed out. Everything after
 * this point is cheap and rerunnable; the research is neither, so it is written
 * down the moment it succeeds.
 *
 * Reusing it also makes the numbers stable across re-runs, which matters more
 * here than the saving: `--force` on a video about a live disaster should
 * re-render the video it already made, not quietly quote a death toll that
 * moved overnight. Deleting `outline.json` is how you ask for fresh research.
 */
async function outlineFor(
  input: GenerateStoryboardInput<Brief>,
  context: string,
  targetWords: number,
  config: AppConfig,
  logger: Logger,
): Promise<Outline> {
  const file = outlinePath(config, input.projectId);

  const cached = await readFile(file, 'utf8').catch(() => null);
  if (cached) {
    const parsed = OutlineSchema.safeParse(JSON.parse(cached) as unknown);
    if (parsed.success) {
      logger.step(
        `Dùng lại dàn ý đã tra cứu (${parsed.data.sections.length} phần, ` +
          `${parsed.data.facts.length} dữ kiện). Xoá ${path.basename(file)} nếu muốn tra lại.`,
      );
      return parsed.data;
    }
    // A file written by an older schema, or half-written. Cheaper to redo the
    // research than to guess what it meant.
    logger.warn(`${path.basename(file)} không đọc được, sẽ tra cứu lại.`);
  }

  const outline = await researchOutline(input, context, targetWords, config, logger);

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(outline, null, 2)}\n`, 'utf8').catch((err) => {
    // Losing the cache costs a re-run its twelve minutes, not this run its
    // video - the outline is already in hand.
    logger.warn(`Không ghi được ${file}: ${err instanceof Error ? err.message : String(err)}`);
  });

  return outline;
}

/** The research call, with the duplicate gate folded into its retry loop. */
async function researchOutline(
  input: GenerateStoryboardInput<Brief>,
  context: string,
  targetWords: number,
  config: AppConfig,
  logger: Logger,
): Promise<Outline> {
  const basePrompt = buildOutlinePrompt({
    projectId: input.projectId,
    workingTitle: input.info?.name ?? input.projectId,
    info: input.info,
    context,
    targetDurationSec: input.targetDurationSec,
    targetWords,
    // The model has no clock. Without today's date it cannot tell whether what
    // it remembers is current, and it cannot date the figures it finds.
    today: new Date().toISOString().slice(0, 10),
    channelName: config.channelName,
    defaultStyle: config.video.style,
    defaultVoice: config.tts.voice,
    alreadyCovered: input.alreadyCovered,
    sources: input.brief?.sources ?? [],
  });

  let prompt = basePrompt;
  let lastProblem = 'unknown';

  for (let attempt = 1; attempt <= OUTLINE_ATTEMPTS; attempt++) {
    logger.step(
      attempt === 1
        ? 'Tra cứu và lập dàn ý (Claude được dùng tìm kiếm web)...'
        : `Lập lại dàn ý (lượt ${attempt}/${OUTLINE_ATTEMPTS})`,
    );

    const raw = await callClaude(prompt, config, logger, {
      timeoutMs: OUTLINE_TIMEOUT_MS,
      // Search, and fetch when there are pages to read. Still no file access
      // and no shell: the model is here to read the open web and plan a video,
      // and nothing it finds should be able to reach this machine. WebFetch is
      // granted only when somebody named pages, so an ordinary run has the same
      // single tool it always had.
      extraArgs: input.brief?.sources?.length ? ['WebSearch', 'WebFetch'] : ['WebSearch'],
    });

    const json = extractJson(raw);
    if (!json) {
      lastProblem = 'Câu trả lời không chứa object JSON nào.';
      prompt = retryPrompt(basePrompt, lastProblem);
      continue;
    }

    const parsed = OutlineSchema.safeParse(json);
    if (!parsed.success) {
      lastProblem = parsed.error.issues
        .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
      logger.warn(`Dàn ý sai schema:\n${lastProblem}`);
      prompt = retryPrompt(basePrompt, `Lỗi schema:\n${lastProblem}`);
      continue;
    }

    const structural = checkOutline(parsed.data, targetWords, input.brief?.sources ?? []);
    if (structural.length > 0) {
      lastProblem = structural.map((p) => `- ${p}`).join('\n');
      logger.warn(`Dàn ý sai cấu trúc:\n${lastProblem}`);
      prompt = retryPrompt(basePrompt, `Lỗi cấu trúc:\n${lastProblem}`);
      continue;
    }

    const repeat = findSimilarTopic(parsed.data.episodeTitle, input.alreadyCovered);
    if (repeat) {
      lastProblem =
        `Đề tài "${parsed.data.episodeTitle}" trùng với video kênh đã làm: "${repeat}". ` +
        'Giữ nguyên chủ đề được giao nhưng chọn một góc khác hẳn và đặt tiêu đề khác.';
      logger.warn(lastProblem);
      prompt = retryPrompt(basePrompt, lastProblem);
      continue;
    }

    /*
     * The pictures somebody pointed at, added whether or not the model noticed.
     *
     * A Commons category link in the prompt is the least ambiguous instruction
     * in it: "use these images". The prompt tells the model so, and a model
     * usually listens - but this is the one thing the person asked for
     * directly, so it is guaranteed here rather than hoped for. Theirs go first,
     * so the cap trims the model's guesses rather than the person's choices.
     */
    const pinned = commonsCategoriesFrom(input.brief?.sources ?? []);
    if (pinned.length > 0) {
      parsed.data.eventImageQueries = [
        ...new Set([...pinned, ...parsed.data.eventImageQueries]),
      ].slice(0, MAX_EVENT_QUERIES);
    }

    const sourced = new Set(parsed.data.facts.map((f) => f.source)).size;
    logger.done(
      `Dàn ý xong: ${parsed.data.sections.length} phần, ${parsed.data.facts.length} dữ kiện ` +
        `từ ${sourced} nguồn, ${parsed.data.imageQueries.length} chủ đề hình`,
    );
    return parsed.data;
  }

  throw new PipelineError(
    ERROR_CODES.AI_CALL_FAILED,
    'generate-storyboard',
    `Không lập được dàn ý sau ${OUTLINE_ATTEMPTS} lượt. Vấn đề cuối:\n${lastProblem}`,
  );
}

/** One call per section, in order, each seeing the tail of the one before. */
async function writeSections(
  outline: Outline,
  config: AppConfig,
  logger: Logger,
): Promise<Scene[]> {
  const all: Scene[] = [];

  for (const [index, section] of outline.sections.entries()) {
    const scenes = await writeSection({
      outline,
      section,
      index,
      firstSceneNumber: all.length + 1,
      previousTail: tailOf(all),
      nextHeading: outline.sections[index + 1]?.heading ?? '',
      config,
      logger,
    });

    all.push(...scenes);
    logger.step(
      `  [${index + 1}/${outline.sections.length}] ${section.heading} - ` +
        `${scenes.length} cảnh, ${countWords(scenes.map((s) => s.narration).join(' '))} từ ` +
        `(giao ${section.wordBudget})`,
    );
  }

  /*
   * The scene types the assembled video needs, forced here rather than asked
   * for. `checkSceneOrder` requires the first scene to be intro and the last
   * outro, and no section call can guarantee that: the first one does not know
   * it is not also the last, and a section that miscounts its own scenes would
   * fail the whole video at the assembly step - after a dozen calls have been
   * paid for. Setting two fields is cheaper and cannot be got wrong.
   */
  if (all.length > 0) {
    all[0] = { ...all[0]!, type: 'intro' };
    all[all.length - 1] = { ...all[all.length - 1]!, type: 'outro' };
  }

  // Renumbered end to end. A section that started its ids at the wrong number
  // would otherwise collide with another's, and duplicate ids fail the check
  // that runs after every call has been paid for.
  return all.map((scene, i) => ({ ...scene, id: `scene-${String(i + 1).padStart(3, '0')}` }));
}

async function writeSection(input: {
  outline: Outline;
  section: SectionPlan;
  index: number;
  firstSceneNumber: number;
  previousTail: string;
  nextHeading: string;
  config: AppConfig;
  logger: Logger;
}): Promise<Scene[]> {
  const { outline, section, config, logger } = input;

  const basePrompt = buildSectionPrompt({
    outline,
    section,
    index: input.index,
    firstSceneNumber: input.firstSceneNumber,
    previousTail: input.previousTail,
    nextHeading: input.nextHeading,
    channelName: config.channelName,
  });

  let prompt = basePrompt;
  let best: Scene[] | null = null;
  let lastProblem = 'unknown';

  for (let attempt = 1; attempt <= SECTION_ATTEMPTS; attempt++) {
    const raw = await callClaude(prompt, config, logger, { timeoutMs: SECTION_TIMEOUT_MS });
    const json = extractJson(raw);

    const parsed = json ? SectionDraftSchema.safeParse(json) : null;
    if (!parsed?.success) {
      lastProblem = parsed
        ? parsed.error.issues.map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
        : 'Câu trả lời không chứa object JSON nào.';
      logger.warn(`Phần "${section.id}" sai schema:\n${lastProblem}`);
      prompt = retryPrompt(basePrompt, lastProblem);
      continue;
    }

    // Kept before the length check, so a section that never lands inside its
    // budget still contributes its best attempt rather than nothing.
    best = parsed.data.scenes;

    const problems = checkSection(parsed.data, section.wordBudget, allQueriesOf(outline));
    if (problems.length === 0) return parsed.data.scenes;

    lastProblem = problems.map((p) => `- ${p}`).join('\n');
    logger.warn(`Phần "${section.id}" chưa đạt:\n${lastProblem}`);
    prompt = retryPrompt(basePrompt, lastProblem);
  }

  if (best) {
    /*
     * Accepted anyway, with the reason said out loud.
     *
     * The alternative is failing a video that is otherwise complete because one
     * section of twelve came back a hundred syllables over. The whole-video
     * band is checked afterwards and absorbs it; what must not happen silently
     * is a section quietly missing its budget, so it is a warning rather than
     * a debug line.
     */
    logger.warn(
      `Phần "${section.id}" vẫn chưa đạt sau ${SECTION_ATTEMPTS} lượt - dùng bản gần nhất. ` +
        `Vấn đề còn lại:\n${lastProblem}`,
    );
    return best;
  }

  throw new PipelineError(
    ERROR_CODES.AI_CALL_FAILED,
    'generate-storyboard',
    `Phần "${section.id}" không viết được sau ${SECTION_ATTEMPTS} lượt:\n${lastProblem}`,
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
      facts: draft.content.facts,
    },
    publish: draft.publish,
    scenes: draft.scenes,
  };
}
