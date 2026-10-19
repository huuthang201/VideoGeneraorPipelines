import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { callClaude, extractJson } from '../../ai/claude-runner';
import { jobPaths, type AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import { COMMONS_PREFIX } from '../shorts/image/stock/wikimedia.provider';
import { buildImageResearchPrompt, type ResearchScene } from './prompts/image-research';
import type { Storyboard } from './domain/storyboard';

/**
 * Real photographs, looked for one scene at a time.
 *
 * The stage that exists because a reportage's pictures were plausible and not
 * true. With the review, the place rule and the paper's own photographs, the
 * Hà Nội flood video still carried a pump in a basement for the city's pumping
 * station and a flooded field abroad for the provinces - and the owner's verdict
 * was that a video about a real event wants *that event's* pictures, found
 * carefully, scene by scene.
 *
 * So before any picture is chosen, each batch of scenes goes to a call that has
 * the web: it names what each sentence is actually about, finds that thing on
 * Wikimedia Commons, opens the page to check, and returns exact page names. The
 * engine searches those as given - no widening - and they go on the scene's own
 * review sheet ahead of stock. A scene nothing real can be found for comes back
 * empty, which is an answer rather than a failure.
 *
 * Commons only, because it is the one source of real photographs that says in
 * writing what may be done with them. The papers' pictures come in by the
 * owner's permission, through `sources`, and are not looked for again here.
 */

/** Scenes per call: small enough to research properly, large enough to share context. */
const BATCH_SCENES = 12;
/** Calls in flight at once. Each spends most of its time waiting on the web. */
const CONCURRENCY = 3;
/** Searching and opening pages for twelve scenes is slow; this is a ceiling, not an estimate. */
const TIMEOUT_MS = 720_000;
/** Sources per scene, at most. More would crowd a batch's sheet with one scene's subject. */
const MAX_PER_SCENE = 4;
/** Bumped when the prompt changes enough that remembered answers should not be trusted. */
const RESEARCH_VERSION = 3;

interface ResearchFile {
  version: number;
  /** Keyed by a hash of the batch's scenes, so an edited scene re-researches only its batch. */
  batches: Record<string, Record<string, string[]>>;
}

export async function researchSceneImages(input: {
  storyboard: Storyboard;
  config: AppConfig;
  logger: Logger;
  /** Articles whose photographs are already in hand, so they are not looked for again. */
  pressSources: readonly string[];
  /** See `buildImageResearchPrompt`'s `mode`. */
  mode: 'places' | 'other-events';
}): Promise<Map<string, string[]>> {
  const { storyboard, config, logger } = input;
  const cachePath = path.join(
    jobPaths(config.jobsDir, storyboard.project.id).root,
    'image-research.json',
  );

  const remembered = await readFile(cachePath, 'utf8')
    .then((text) => JSON.parse(text) as ResearchFile)
    .catch(() => null);
  const file: ResearchFile =
    remembered?.version === RESEARCH_VERSION ? remembered : { version: RESEARCH_VERSION, batches: {} };

  const scenes = scenesOf(storyboard);
  const batches = chunk(scenes, BATCH_SCENES);
  const knownCategories = storyboard.content.imageQueries
    .filter((q) => q.toLowerCase().startsWith(COMMONS_PREFIX))
    .map((q) => `Category:${q.slice(COMMONS_PREFIX.length).trim()}`);

  const keyOf = (batch: readonly ResearchScene[]) =>
    createHash('sha1')
      .update(
        JSON.stringify({
          mode: input.mode,
          scenes: batch.map((s) => [s.id, s.narration]),
          press: input.pressSources,
        }),
      )
      .digest('hex');

  const todo = batches
    .map((batch, index) => ({ batch, index, key: keyOf(batch) }))
    .filter(({ key }) => !file.batches[key]);

  // One write at a time: three batches finish in any order, and two writes of
  // the same file racing each other can leave half of each.
  let writing: Promise<unknown> = Promise.resolve();
  const save = () => {
    writing = writing.then(() => writeFile(cachePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8'));
    return writing;
  };

  if (todo.length > 0) {
    logger.step(
      `Tìm ảnh thật cho từng cảnh trên Wikimedia Commons (Claude được dùng tìm kiếm web), ` +
        `${todo.length}/${batches.length} nhóm...`,
    );
  }

  await forEachLimit(todo, CONCURRENCY, async ({ batch, index, key }) => {
    const prompt = buildImageResearchPrompt({
      episodeTitle: storyboard.project.episodeTitle,
      summary: storyboard.content.summary,
      scenes: batch,
      knownCategories,
      pressSources: input.pressSources,
      maxPerScene: MAX_PER_SCENE,
      mode: input.mode,
    });

    try {
      const raw = await callClaude(prompt, config, logger, {
        timeoutMs: TIMEOUT_MS,
        // The open web, read-only: search, and open the pages it finds. No
        // file access and no shell - a page it reads is data, never an
        // instruction, and nothing it finds should reach this machine.
        extraArgs: ['WebSearch', 'WebFetch'],
      });
      const answer = parseAnswer(extractJson(raw), batch);
      file.batches[key] = answer;
      // Written after every batch, so a run that dies at batch seven keeps six.
      await save();

      const found = Object.values(answer).filter((list) => list.length > 0).length;
      logger.step(`  tìm ảnh nhóm ${index + 1}/${batches.length}: ${found}/${batch.length} cảnh có nguồn ảnh thật`);
    } catch (err) {
      // An enhancement, not a gate: a batch that could not be researched falls
      // back to what the storyboard asked for, as every video did before.
      logger.warn(
        `Tìm ảnh thật hỏng ở nhóm ${index + 1}/${batches.length}: ` +
          `${err instanceof Error ? err.message : String(err)}. Nhóm này dùng từ khoá của kịch bản.`,
      );
    }
  });

  const out = new Map<string, string[]>();
  for (const batch of batches) {
    const answer = file.batches[keyOf(batch)];
    if (!answer) continue;
    for (const [sceneId, names] of Object.entries(answer)) {
      if (names.length > 0) out.set(sceneId, names.map((name) => `${COMMONS_PREFIX}${name}`));
    }
  }
  return out;
}

/** The scenes as the research call sees them, each carrying its section's heading. */
function scenesOf(storyboard: Storyboard): ResearchScene[] {
  let section = '';
  return storyboard.scenes.map((scene) => {
    if (scene.title?.trim()) section = scene.title.trim();
    return { id: scene.id, narration: scene.narration, imageQuery: scene.imageQuery, section };
  });
}

/**
 * The page names from a reply, cleaned into the form Commons uses.
 *
 * Accepts what a model plausibly writes - a full URL, underscores, a lowercase
 * namespace - and keeps only `Category:` and `File:` pages for scenes in this
 * batch. Anything else is dropped rather than guessed at: a name the engine
 * cannot use costs nothing if it is never searched.
 */
function parseAnswer(json: unknown, batch: readonly ResearchScene[]): Record<string, string[]> {
  if (!json || typeof json !== 'object') throw new Error('Image research returned no JSON');

  const ids = new Set(batch.map((scene) => scene.id));
  const out: Record<string, string[]> = {};

  for (const [sceneId, value] of Object.entries(json as Record<string, unknown>)) {
    if (!ids.has(sceneId) || !Array.isArray(value)) continue;
    const names = value
      .filter((v): v is string => typeof v === 'string')
      .map(pageNameOf)
      .filter((name): name is string => name !== null);
    out[sceneId] = [...new Set(names)].slice(0, MAX_PER_SCENE);
  }
  return out;
}

function pageNameOf(raw: string): string | null {
  let text = raw.trim();
  const fromUrl = text.match(/commons\.wikimedia\.org\/wiki\/([^?#]+)/iu)?.[1];
  if (fromUrl) text = fromUrl;
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep the raw text; a stray % is not worth losing the name over.
  }
  text = text.replace(/_/gu, ' ').trim();

  const match = text.match(/^(category|file)\s*:\s*(.+)$/iu);
  if (!match) return null;
  const namespace = match[1]!.toLowerCase() === 'file' ? 'File' : 'Category';
  return `${namespace}:${match[2]!.trim()}`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await run(item);
    }
  });
  await Promise.all(workers);
}
