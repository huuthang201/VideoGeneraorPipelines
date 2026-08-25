import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { StoryboardLike } from '../modules/contract';
import type { ModuleId } from '../domain/config';
import type { Timeline } from '../domain/timeline';
import { requiresAttribution } from '../image/credit';

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
  images: { creator: string; license: string; licenseUrl: string; sourceUrl: string }[];
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
  podcast: [],
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
  const mustCredit = images.filter((image) => requiresAttribution(image.license));

  if (mustCredit.length > 0) {
    sections.push(
      [
        'Ảnh',
        ...mustCredit.map(
          (image) =>
            `${image.creator} — CC ${image.license.toUpperCase()} (${image.licenseUrl}) ${image.sourceUrl}`,
        ),
      ].join('\n'),
    );
  }

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
    description: sections.filter(Boolean).join('\n\n'),
    tags,
    chapters,
    thumbnails: input.thumbnails,
    music: input.music,
    images,
  };
}

/**
 * One entry per distinct photograph, in the order the video shows them.
 *
 * Deduplicated on the source URL rather than on the photographer: one person
 * may have taken two of the pictures, and crediting them twice reads as a
 * mistake - but two different photographs by the same person still need their
 * own links.
 */
function collectImageCredits(timeline: Timeline): PublishKit['images'] {
  const seen = new Set<string>();
  const credits: PublishKit['images'] = [];

  for (const scene of timeline.scenes) {
    const credit = scene.background.credit;
    if (!credit || seen.has(credit.sourceUrl)) continue;
    seen.add(credit.sourceUrl);
    credits.push({
      creator: credit.creator,
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
      ? kit.images.map((image) => `- ${image.creator} (${image.license.toUpperCase()}) ${image.sourceUrl}`)
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
