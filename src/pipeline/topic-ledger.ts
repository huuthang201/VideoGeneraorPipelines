import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { AppConfig } from '../config/env';
import type { Logger } from '../utils/logger';

/**
 * Every subject this channel has covered, per module, on disk.
 *
 * ## Why this exists at all
 *
 * "Do not repeat yourself" was already in both suggest-brief prompts, fed by a
 * list of titles read out of the project folders. That list has a hole in it,
 * and it is not a small one: **deleting a project deletes its topic**. The
 * video stays on YouTube, the channel has demonstrably covered the subject, and
 * the next suggestion is free to propose it again - which is exactly what
 * happens on a channel that tidies up after itself.
 *
 * So the ledger is separate from the projects and outlives them. A project can
 * be deleted, re-run, renamed; its line here stays.
 *
 * ## Two files, and which one is the truth
 *
 * `de-tai.json` is authoritative and the pipeline owns it. `de-tai.md` is
 * generated from it for a person to read, and is never parsed back: a ledger
 * recovered by regex out of a table somebody may have hand-edited is a ledger
 * that silently loses rows.
 *
 * That is the same split the publishing kit already uses - the machine keeps
 * the data, the human gets a rendering of it. Writing it still cannot fail a
 * run, for the same reason it could not before: a channel publishing every
 * four hours must not die because a file was busy.
 */

export interface TopicEntry {
  /** ISO date the subject was first written about. */
  at: string;
  projectId: string;
  /** The episode title, which is what a repeat would repeat. */
  title: string;
  /** One line about what it actually said, for a person skimming the sheet. */
  summary: string;
  /** Filled in after a successful upload; empty until then. */
  youtubeUrl: string;
}

const jsonPath = (config: AppConfig) => path.join(config.runtimeDir, 'de-tai.json');
const mdPath = (config: AppConfig) => path.join(config.runtimeDir, 'de-tai.md');

/** Where the readable list lives, so a CLI command can name it in its output. */
export const topicSheetPath = mdPath;

export async function readTopics(config: AppConfig): Promise<TopicEntry[]> {
  const raw = await readFile(jsonPath(config), 'utf8').catch(() => null);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TopicEntry[]) : [];
  } catch {
    // A half-written ledger must not stop a run. The worst case is one repeat.
    return [];
  }
}

/**
 * Records a subject, or updates the one already recorded for this project.
 *
 * Keyed by project id rather than appended blindly, because re-running a
 * project is normal - it happens on every `--force` - and a ledger that grew a
 * line each time would tell the next suggestion that one subject had been
 * covered nine times.
 */
export async function recordTopic(
  config: AppConfig,
  entry: TopicEntry,
  logger?: Logger,
): Promise<void> {
  const topics = await readTopics(config);
  const index = topics.findIndex((t) => t.projectId === entry.projectId);

  if (index === -1) topics.push(entry);
  else topics[index] = { ...topics[index]!, ...entry, at: topics[index]!.at };

  await mkdir(config.runtimeDir, { recursive: true });
  await writeFile(jsonPath(config), `${JSON.stringify(topics, null, 2)}\n`, 'utf8');
  await exportSheet(config, topics, logger);
}

/** Attaches the video's URL to a subject already recorded. */
export async function recordTopicUpload(
  config: AppConfig,
  projectId: string,
  youtubeUrl: string,
  logger?: Logger,
): Promise<void> {
  const topics = await readTopics(config);
  const entry = topics.find((t) => t.projectId === projectId);
  if (!entry) return;

  entry.youtubeUrl = youtubeUrl;
  await writeFile(jsonPath(config), `${JSON.stringify(topics, null, 2)}\n`, 'utf8');
  await exportSheet(config, topics, logger);
}

/**
 * Words too common to carry meaning, so two unrelated titles are not called
 * duplicates for sharing them. Deliberately short - an aggressive stoplist
 * strips the very words that make a Vietnamese title specific.
 */
const STOPWORDS = new Set([
  'co', 'the', 'cua', 'vi', 'sao', 'tai', 'mot', 'la', 'va', 'nhung', 'nao',
  'khi', 'cho', 'den', 'tu', 'ra', 'lai', 'ma', 'thi', 'nay', 'do', 'ban',
]);

/** Folds tones and punctuation away, so "Vì sao" and "vi sao" are one word. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentWords(title: string): Set<string> {
  return new Set(fold(title).split(' ').filter((w) => w.length > 1 && !STOPWORDS.has(w)));
}

/**
 * How much two titles overlap: shared content words over the smaller set.
 *
 * Deliberately not Jaccard. Jaccard divides by the union, which punishes a
 * title for being longer - "Mèo kêu grừ grừ" and "Vì sao con mèo lại kêu grừ
 * grừ khi được vuốt ve" are the same video, and Jaccard scores them 0.5.
 * Dividing by the smaller set asks the question that actually matters: is one
 * of these contained in the other?
 */
function overlap(a: Set<string>, b: Set<string>): number {
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  if (smaller.size === 0) return 0;

  let shared = 0;
  for (const word of smaller) if (larger.has(word)) shared++;
  return shared / smaller.size;
}

/**
 * Where a title stops being new.
 *
 * Calibrated against this repository's own back catalogue rather than guessed:
 * at 0.8 no pair among the existing titles is flagged, and an obvious
 * rewording of one still is. Lower and real videos start colliding; higher and
 * only near-identical strings are caught, which the model would rarely produce.
 */
const DUPLICATE_THRESHOLD = 0.8;

/**
 * The covered title this one repeats, or null.
 *
 * A *check* rather than a request. Both suggest-brief prompts already say "do
 * not repeat these", and a prompt is advice - it works most of the time, which
 * on a channel publishing every four hours means it fails several times a week
 * and nobody notices until two identical videos are live. This is the gate that
 * makes the advice binding.
 */
export function findSimilarTopic(title: string, covered: readonly string[]): string | null {
  const words = contentWords(title);
  if (words.size === 0) return null;

  for (const other of covered) {
    if (fold(other) === fold(title)) return other;
    if (overlap(words, contentWords(other)) >= DUPLICATE_THRESHOLD) return other;
  }
  return null;
}

/** The titles a suggestion must not repeat. Newest last. */
export async function coveredTitles(config: AppConfig): Promise<string[]> {
  return (await readTopics(config)).map((t) => t.title).filter(Boolean);
}

/**
 * What a *re-run* of one project must not collide with.
 *
 * Two exclusions, and the second one is the interesting one.
 *
 * The project's own entry is dropped by id, because otherwise `--force` finds
 * the title it wrote last time and rejects the project as a repeat of itself.
 *
 * Then any title that already collides with what this project wrote before is
 * dropped too. That looks like a loophole and is the opposite: the gate exists
 * to stop a *new* collision appearing, and if this project's subject was
 * already duplicated by some other project, re-running it creates nothing new -
 * while blocking it would leave the project permanently unbuildable. The Fact
 * channel already has exactly this case, two live videos about an octopus
 * having three hearts, and without this rule neither of them could ever be
 * rebuilt.
 */
export async function coveredTitlesFor(
  config: AppConfig,
  projectId: string,
): Promise<string[]> {
  const topics = await readTopics(config).catch(() => [] as TopicEntry[]);
  const own = topics.find((t) => t.projectId === projectId)?.title ?? null;
  const others = topics.filter((t) => t.projectId !== projectId && t.title);

  if (!own) return others.map((t) => t.title);
  return others.filter((t) => !findSimilarTopic(own, [t.title])).map((t) => t.title);
}

/**
 * The title this project last used, if any.
 *
 * So a re-run does not find itself. Without this, `--force` on a finished
 * project would reject its own subject as a repeat of itself and the project
 * could never be rebuilt.
 */
export async function readTopicTitleFor(
  config: AppConfig,
  projectId: string,
): Promise<string | null> {
  const topics = await readTopics(config).catch(() => [] as TopicEntry[]);
  return topics.find((t) => t.projectId === projectId)?.title ?? null;
}

/**
 * Writes the spreadsheet, and never throws.
 *
 * See the note at the top: an open workbook is locked, and losing a rendered
 * video to that would be absurd. The JSON has already been written by the time
 * this runs, so a failure here costs the sheet being one entry stale until the
 * next run - and `npm run <module> -- de-tai` rewrites it on demand.
 */
export async function exportSheet(
  config: AppConfig,
  topics?: readonly TopicEntry[],
  logger?: Logger,
): Promise<boolean> {
  const rows = topics ?? (await readTopics(config));

  try {
    await writeFile(mdPath(config), renderMarkdown(config, rows), 'utf8');
    return true;
  } catch (err) {
    logger?.warn(
      `Khong ghi duoc ${mdPath(config)} (${err instanceof Error ? err.message : String(err)}). ` +
        'Danh sach trong de-tai.json van dung - chay "de-tai" de xuat lai.',
    );
    return false;
  }
}

/**
 * Escapes a cell so one title cannot break the table.
 *
 * A pipe ends a column and a newline ends a row, and both turn up in real
 * titles - a summary is prose written by a model that was never told it would
 * land in a table.
 */
const cell = (value: string): string =>
  value.replace(/\|/g, String.fromCharCode(92) + '|').replace(/\r?\n/g, ' ').trim();

/**
 * How much summary the table carries.
 *
 * Enough to tell two similar titles apart, which is the only reason the column
 * is here - "Bạch tuộc và ba trái tim" and "Bạch tuộc có ba trái tim và máu
 * xanh dương" need about this much before it is obvious they are one video.
 * The full text is in `de-tai.json`; a table whose rows run to four hundred
 * characters stops being scannable, and scanning is what this file is for.
 */
const SUMMARY_CHARS = 120;

function shorten(text: string): string {
  const line = cell(text);
  if (line.length <= SUMMARY_CHARS) return line;

  const cut = line.slice(0, SUMMARY_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > SUMMARY_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Newest first, and a table rather than a list.
 *
 * The reason to open this file is to ask "have we done this already?", which is
 * a scanning job - sixty titles under each other answer it in one pass, where
 * sixty headed sections need scrolling. Newest first because the answer is
 * almost always in the last fortnight.
 *
 * The summary is a column rather than being dropped, because a title alone is
 * often not enough to tell two videos apart - "Bạch tuộc và ba trái tim" and
 * "Bạch tuộc có ba trái tim và máu xanh dương" are one line apart in this table
 * and it takes the summaries to see they really are the same video.
 */
function renderMarkdown(config: AppConfig, topics: readonly TopicEntry[]): string {
  const newestFirst = [...topics].reverse();
  const published = newestFirst.filter((t) => t.youtubeUrl).length;

  const lines = [
    `# Đề tài — ${config.module}`,
    '',
    `${topics.length} đề tài · ${published} đã đăng · cập nhật ${new Date().toISOString().slice(0, 10)}`,
    '',
    '> Sinh tự động sau mỗi lần kịch bản được duyệt. Sửa tay ở đây không có tác dụng —',
    '> nguồn thật là `de-tai.json` bên cạnh.',
    '',
    '| Ngày | Tiêu đề | Tóm tắt | Video |',
    '| --- | --- | --- | --- |',
    ...newestFirst.map((t) =>
      `| ${t.at.slice(0, 10)} | ${cell(t.title)} | ${shorten(t.summary)} | ` +
      `${t.youtubeUrl ? `[xem](${t.youtubeUrl})` : '—'} |`,
    ),
  ];

  if (topics.length === 0) {
    lines.push('', '_Chưa có đề tài nào._');
  }

  return `${lines.join('\n')}\n`;
}
