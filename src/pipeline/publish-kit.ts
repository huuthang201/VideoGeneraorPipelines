import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { StoryboardLike } from '../modules/contract';
import type { ModuleId } from '../domain/config';
import type { Timeline } from '../domain/timeline';
import { mustPreserveOriginal, requiresAttribution } from '../image/credit';

type Storyboard = StoryboardLike;

/**
 * The copy-and-paste kit for putting a video on YouTube.
 *
 * The engine knows things the person uploading does not want to work out by
 * hand: the hashtags that mark this as a Short, where every chapter starts to
 * the frame when there are chapters at all, and which artist has to be credited
 * for the music. All mechanical, all tedious, and one of them a licence
 * condition - so none of it is left to the model or to memory.
 *
 * Written as two files on purpose. `youtube.md` is for a human with the upload
 * form open; `youtube.json` is what the uploader in src/publish/youtube.ts
 * actually reads.
 */

export interface MusicCredit {
  artist: string;
  title: string;
  licence: string;
  licenceUrl?: string;
  sourceUrl?: string;
}

export interface PublishKit {
  title: string;
  description: string;
  tags: string[];
  chapters: { at: string; label: string }[];
  thumbnails: string[];
  music: MusicCredit | null;
  /** One line per distinct photograph, in the order they appear. */
  images: {
    creator: string;
    /** Where it came from: the stock library, or the paper for a press photograph. */
    provider?: string;
    license: string;
    licenseUrl: string;
    sourceUrl: string;
  }[];
}

/**
 * YouTube's rules for chapters, which it applies silently: the list is ignored
 * altogether unless the first one starts at 00:00, there are at least three,
 * and each runs at least ten seconds. A chapter list that does not appear is
 * worse than none, because nobody finds out.
 */
const MIN_CHAPTERS = 3;
const MIN_CHAPTER_SECONDS = 10;

/**
 * Below this, chapters are not generated at all.
 *
 * A forty-five second video *could* technically carry three ten-second
 * chapters, and it would be absurd: nobody navigates a Short, the player has no
 * chapter UI in the Shorts feed, and the list would eat the only three lines of
 * description anybody reads. The threshold exists because the engine still
 * renders ordinary landscape videos when asked, and those genuinely want them.
 */
const MIN_CHAPTERABLE_SECONDS = 120;

/**
 * The hashtags every video carries, before its own topical ones.
 *
 * Per module, and empty for the podcast: `#shorts` is not what makes YouTube
 * treat an upload as a Short - the 9:16 frame and the sub-sixty-second length
 * do that - but it is still what the search and browse surfaces read, and it
 * costs nothing on a video that *is* one. On a ten-minute episode it would be a
 * lie the platform reads literally.
 *
 * Generated rather than left to the model for the same reason the music credit
 * is: it has to be on every single video, and a model asked to remember it will
 * forget it on the one nobody checks.
 */
const BASE_HASHTAGS_BY_MODULE: Record<ModuleId, string[]> = {
  fact: ['shorts'],
  psych: ['shorts'],
  cartoon: ['shorts'],
  podcast: [],
  /**
   * Empty, unlike the shorts on the same channel.
   *
   * `#shorts` is what tells YouTube to serve a video in the Shorts feed, and a
   * seventeen-minute landscape video tagged with it is not eligible - the tag
   * is at best ignored and at worst a signal the channel does not know what it
   * is uploading.
   */
  factlong: [],
};

/**
 * How many of the video's own tags become hashtags.
 *
 * Three, because YouTube shows only the first three above the title and treats
 * a description stuffed with more than fifteen as spam - dropping *all* of them
 * when it does.
 */
const MAX_TOPIC_HASHTAGS = 3;

/** YouTube rejects anything longer, and truncates the visible part far sooner. */
const MAX_TITLE = 100;

/**
 * Fits the channel's prefix and the episode's title into one line.
 *
 * The prefix wins when they do not both fit: it is channel branding, which is
 * the whole reason it is there, and it is empty by default anyway. The title is
 * then cut at a word boundary rather than mid-syllable, with an ellipsis so the
 * cut is visibly deliberate.
 */
export function composeTitle(prefix: string, title: string): string {
  const combined = `${prefix}${title}`;
  if (combined.length <= MAX_TITLE) return combined;

  const room = MAX_TITLE - prefix.length - 1;
  if (room <= 0) return combined.slice(0, MAX_TITLE);

  const cut = title.slice(0, room);
  const lastSpace = cut.lastIndexOf(' ');
  return `${prefix}${(lastSpace > room * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function buildPublishKit(input: {
  storyboard: Storyboard;
  timeline: Timeline;
  thumbnails: string[];
  music: MusicCredit | null;
  musicFile: string | null;
  /** Channel branding, prepended to the title. Usually empty. */
  titlePrefix?: string;
}): PublishKit {
  const { storyboard, timeline } = input;

  const title = composeTitle(
    input.titlePrefix ?? '',
    storyboard.publish?.title ?? storyboard.project.episodeTitle,
  );
  const written = storyboard.publish?.description ?? storyboard.content.summary;
  const tags = storyboard.publish?.tags ?? [];
  const durationSec = timeline.video.durationInFrames / timeline.video.fps;
  const chapters =
    durationSec >= MIN_CHAPTERABLE_SECONDS ? buildChapters(timeline, storyboard) : [];

  const images = collectImageCredits(timeline);
  const sections = [written.trim(), hashtagLine(tags, timeline.module)];

  if (chapters.length >= MIN_CHAPTERS) {
    sections.push(['Chapters', ...chapters.map((c) => `${c.at} ${c.label}`)].join('\n'));
  }

  /*
   * Only the photographs whose licence actually obliges it.
   *
   * The on-screen credit names every photographer, public domain included,
   * because over-crediting costs nothing on a frame nobody reads twice. A
   * description is different: nine lines of URLs pushes everything worth
   * reading below the fold, and a CC0 image imposes no obligation to put them
   * there. So this lists the CC BY ones, which do - and `youtube.md` keeps the
   * complete record for whoever needs it.
   */
  const mustCredit = images.filter(
    (image) => requiresAttribution(image.license) && !mustPreserveOriginal(image.license),
  );
  const pressCredits = images.filter((image) => mustPreserveOriginal(image.license));
  if (pressCredits.length > 0) sections.push(pressCreditSection(pressCredits));
  if (mustCredit.length > 0) sections.push(creditSection(mustCredit));

  if (input.music) {
    // The credit is generated rather than written by the model because it is a
    // licence condition, and a model asked to "remember the attribution" will
    // eventually forget it on the episode nobody checks.
    const { artist, title: track, licence, licenceUrl, sourceUrl } = input.music;
    sections.push(
      [
        'Music',
        `"${track}" by ${artist} - ${licence}${licenceUrl ? ` (${licenceUrl})` : ''}`,
        sourceUrl ?? '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  } else if (input.musicFile) {
    sections.push(
      [
        'Music',
        `${path.basename(input.musicFile)} - licence unknown.`,
        'Add an entry to assets/music/credits.json, or check the track allows this use',
        'before publishing.',
      ].join('\n'),
    );
  }

  return {
    title,
    description: fitDescription(sections.filter(Boolean), mustCredit),
    tags,
    chapters,
    thumbnails: input.thumbnails,
    music: input.music,
    images,
  };
}

/**
 * How long a YouTube description may be.
 *
 * Five thousand characters, and it is a hard refusal rather than a truncation:
 * `videos.insert` answers 400 `invalidDescription` and uploads nothing. The
 * margin is for the hashtag line and the newlines between sections, which are
 * cheaper to over-reserve than to count exactly.
 */
const MAX_DESCRIPTION_CHARS = 4900;

/** The first line of the Creative Commons credits, which `fitDescription` finds them by. */
const CC_HEADING = 'Ảnh';

/**
 * Press photographs, one line per article.
 *
 * Not the Creative Commons form, and not only because "CC PERMISSION" would be
 * nonsense. What a paper that said yes will look for is its own name, the
 * photographer's, and a link back to the story - the form Vietnamese papers use
 * for each other's pictures. One line per article rather than per photograph,
 * because six photographs from one story are one permission.
 *
 * It never shrinks. There are at most a dozen articles, and this is the credit
 * the permission was given on - the CC credits below it give way first.
 */
function pressCreditSection(images: PublishKit['images']): string {
  const byArticle = new Map<string, { outlet: string; photographers: string[] }>();

  for (const image of images) {
    const outlet = image.provider ?? image.creator;
    const entry = byArticle.get(image.sourceUrl) ?? { outlet, photographers: [] };
    if (image.creator !== outlet && !entry.photographers.includes(image.creator)) {
      entry.photographers.push(image.creator);
    }
    byArticle.set(image.sourceUrl, entry);
  }

  return [
    'Ảnh báo chí - sử dụng với sự cho phép của toà soạn',
    ...[...byArticle].map(([url, { outlet, photographers }]) =>
      photographers.length > 0
        ? `${outlet} (ảnh: ${photographers.join(', ')}): ${url}`
        : `${outlet}: ${url}`,
    ),
  ].join('\n');
}

/**
 * The photo credits, at the most detailed level that fits.
 *
 * This exists because a length that was theoretical for two years stopped
 * being. A thirty-second short shows six photographs and its credits run to
 * eight hundred characters; a seventeen-minute video shows ninety-one, and the
 * first one written came to **nine thousand one hundred** - YouTube refused the
 * upload outright with `invalidDescription`, after the render, the narration
 * and the whole research pass had been paid for.
 *
 * The obligation cannot simply be trimmed away: CC BY asks for the creator, the
 * licence, and the work's URI where one was supplied. So instead of dropping
 * credits the section is written three ways and the fullest one that fits is
 * used:
 *
 *   1. one line per photograph, with its own link - what a short gets
 *   2. one line per *creator*, their photographs' links gathered - the licence
 *      URL moves to a single legend, which alone saves forty-five characters a
 *      line
 *   3. creators named, links dropped, with the video's own frames pointed at
 *
 * Level three still names every photographer and still names the licence, and
 * the per-frame credit drawn in the corner of the video carries the rest - so
 * the obligation survives even at the smallest size. It is a fallback for a
 * video with two hundred distinct photographs, not something a normal one
 * reaches.
 */
function creditSection(images: PublishKit['images']): string {
  return [
    CC_HEADING,
    ...images.map(
      (image) =>
        `${image.creator} — CC ${image.license.toUpperCase()} (${image.licenseUrl}) ${image.sourceUrl}`,
    ),
  ].join('\n');
}

/** The same credits, one line per creator and the licence stated once. */
function creditSectionGrouped(images: PublishKit['images']): string {
  const byCreator = new Map<string, string[]>();
  for (const image of images) {
    const urls = byCreator.get(image.creator) ?? [];
    if (!urls.includes(image.sourceUrl)) urls.push(image.sourceUrl);
    byCreator.set(image.creator, urls);
  }

  const licences = [...new Set(images.map((i) => i.licenseUrl))].sort();
  return [
    'Ảnh — Creative Commons',
    ...licences.map((url) => url),
    '',
    ...[...byCreator].map(([creator, urls]) => `${creator}: ${urls.join(' , ')}`),
  ].join('\n');
}

/** Creators and licence only; the per-frame credit in the video carries the rest. */
function creditSectionNamesOnly(images: PublishKit['images']): string {
  const creators = [...new Set(images.map((i) => i.creator))].sort();
  const licences = [...new Set(images.map((i) => i.licenseUrl))].sort();

  return [
    'Ảnh — Creative Commons, tác giả theo thứ tự chữ cái:',
    creators.join(' · '),
    '',
    `Giấy phép: ${licences.join(' , ')}`,
    'Từng bức ảnh được ghi tên tác giả ngay trên khung hình trong video.',
  ].join('\n');
}

/**
 * Assembles the description, shrinking only the credits until it fits.
 *
 * The credits are the only part that scales with the video's length, so they
 * are the only part that gives - the summary, the chapters and the music credit
 * are the same size on a short and on a documentary. A video that does not fit
 * even at the smallest level has a problem this function cannot solve, and it
 * says so in the description rather than letting YouTube refuse the upload.
 */
function fitDescription(sections: string[], credits: PublishKit['images']): string {
  const join = (parts: string[]) => parts.filter(Boolean).join('\n\n');

  const full = join(sections);
  if (full.length <= MAX_DESCRIPTION_CHARS || credits.length === 0) return full;

  const index = sections.findIndex((s) => s.startsWith(`${CC_HEADING}\n`));
  if (index === -1) return full.slice(0, MAX_DESCRIPTION_CHARS);

  for (const build of [creditSectionGrouped, creditSectionNamesOnly]) {
    const next = [...sections];
    next[index] = build(credits);
    const text = join(next);
    if (text.length <= MAX_DESCRIPTION_CHARS) return text;
  }

  // Every photographer still named, which is the part that is not negotiable.
  const last = [...sections];
  last[index] = creditSectionNamesOnly(credits);
  return join(last).slice(0, MAX_DESCRIPTION_CHARS);
}

/**
 * One entry per distinct photograph, in the order the video shows them.
 *
 * Deduplicated on the source URL rather than on the photographer: one person
 * may have taken two of the pictures, and crediting them twice reads as a
 * mistake - but two different photographs by the same person still need their
 * own links. (The photographer is part of the key only for press photographs,
 * where the URL is the article rather than the picture.)
 */
function collectImageCredits(timeline: Timeline): PublishKit['images'] {
  const seen = new Set<string>();
  const credits: PublishKit['images'] = [];

  for (const scene of timeline.scenes) {
    // A scene drawn rather than photographed has nobody to credit, which is
    // the point of drawing it.
    const credit = scene.background?.credit;
    // Keyed on the photographer as well: a press photograph's link is its
    // article, so five pictures from one story share a URL - and keying on the
    // URL alone kept the first photographer and silently dropped the others.
    const key = `${credit?.sourceUrl} ${credit?.creator}`;
    if (!credit || seen.has(key)) continue;
    seen.add(key);
    credits.push({
      creator: credit.creator,
      provider: credit.provider,
      license: credit.license,
      licenseUrl: credit.licenseUrl,
      sourceUrl: credit.sourceUrl,
    });
  }

  return credits;
}

/**
 * "#shorts #fact #matong" - the line that goes under the description.
 *
 * Diacritics are stripped and spaces closed up. YouTube accepts "#sựthậtthúvị"
 * and it is unreadable at hashtag size; every Vietnamese channel writes
 * "#suthatthuvi" instead, and the two match the same searches.
 */
function hashtagLine(tags: readonly string[], module: ModuleId): string {
  const base = BASE_HASHTAGS_BY_MODULE[module];
  const topical = tags
    .map(toHashtag)
    .filter((tag) => tag.length > 1 && !base.includes(tag))
    .filter((tag, index, all) => all.indexOf(tag) === index)
    .slice(0, MAX_TOPIC_HASHTAGS);

  const all = [...base, ...topical];
  return all.length > 0 ? all.map((tag) => `#${tag}`).join(' ') : '';
}

export function toHashtag(tag: string): string {
  return tag
    .normalize('NFD')
    // The combining marks Vietnamese stacks on its vowels, plus the two forms
    // of đ, which decomposition does not touch because it is a distinct letter
    // rather than a d with an accent.
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gu, 'd')
    .replace(/Đ/gu, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '');
}

/**
 * Scene titles become chapters, at the frame the scene actually starts.
 *
 * Only reached for a video past MIN_CHAPTERABLE_SECONDS, and only for scenes
 * that carry a title: an untitled scene is a continuation of the one before it,
 * and turning it into a chapter called "" helps nobody. Scenes shorter than
 * YouTube's ten-second floor are folded into the previous chapter for the same
 * reason.
 */
function buildChapters(timeline: Timeline, storyboard: Storyboard): { at: string; label: string }[] {
  const { fps } = timeline.video;
  const chapters: { at: string; label: string; seconds: number }[] = [];

  timeline.scenes.forEach((scene, index) => {
    const label = scene.title.trim();
    if (!label) return;

    const seconds = scene.from / fps;
    const previous = chapters[chapters.length - 1];
    if (previous && seconds - previous.seconds < MIN_CHAPTER_SECONDS) return;

    chapters.push({
      at: formatTimestamp(index === 0 ? 0 : seconds),
      label,
      seconds: index === 0 ? 0 : seconds,
    });
  });

  // YouTube ignores the whole list unless it opens at zero.
  if (chapters.length > 0 && chapters[0]!.seconds !== 0) {
    chapters.unshift({ at: '0:00', label: storyboard.project.episodeTitle, seconds: 0 });
  }

  return chapters.map(({ at, label }) => ({ at, label }));
}

/** m:ss under an hour, h:mm:ss over it - the forms YouTube parses. */
export function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** Reads the credit for one track, or null when nothing is recorded for it. */
export async function readMusicCredit(
  musicDir: string,
  filename: string | null,
): Promise<MusicCredit | null> {
  if (!filename) return null;

  const raw = await readFile(path.join(musicDir, 'credits.json'), 'utf8').catch(() => null);
  if (!raw) return null;

  try {
    const all = JSON.parse(raw) as Record<string, MusicCredit>;
    return all[path.basename(filename)] ?? null;
  } catch {
    return null;
  }
}

export async function writePublishKit(outputDir: string, kit: PublishKit): Promise<void> {
  const markdown = [
    `# ${kit.title}`,
    '',
    '## Title',
    '',
    kit.title,
    `(${kit.title.length}/100 characters)`,
    '',
    '## Description',
    '',
    kit.description,
    '',
    '## Tags',
    '',
    kit.tags.join(', ') || '(none)',
    '',
    '## Thumbnails',
    '',
    ...kit.thumbnails.map((name, i) => `${i + 1}. ${name}`),
    '',
    '## Ảnh dùng trong video',
    '',
    ...(kit.images.length > 0
      ? kit.images.map((image) =>
          mustPreserveOriginal(image.license)
            ? `- ${image.creator} / ${image.provider ?? image.creator} (dùng với sự cho phép của toà soạn) ${image.sourceUrl}`
            : `- ${image.creator} (${image.license.toUpperCase()}) ${image.sourceUrl}`,
        )
      : ['(none)']),
    '',
  ].join('\n');

  await writeFile(path.join(outputDir, 'youtube.md'), markdown, 'utf8');
  await writeFile(
    path.join(outputDir, 'youtube.json'),
    `${JSON.stringify(kit, null, 2)}\n`,
    'utf8',
  );
}
