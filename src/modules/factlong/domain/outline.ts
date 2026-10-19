import { z } from 'zod';
import { PublishMetaSchema } from '../../../domain/storyboard';

/**
 * The plan, written before a word of the script is.
 *
 * ## Why a long video cannot be one call
 *
 * A seventeen-minute Vietnamese video is about five and a half thousand
 * syllables. Asked for that in one response, a model writes the first three
 * minutes properly and then compresses: sections four onward arrive as
 * summaries of themselves, the specifics thin out, and the last two minutes
 * restate the first. It is the failure the podcast prompt was written against -
 * "a model asked for ten minutes returns two" - except that here it does not
 * return two. It returns seventeen minutes of which nine are hollow, and no
 * word count catches that.
 *
 * So the video is planned once and written in pieces. This is the plan.
 *
 * ## Why the facts are a list rather than prose
 *
 * `facts` is the whole point of this module. The subject is real and recent, so
 * the model has to go and look it up - and then every section is written from
 * *this list* rather than from whatever it still remembers by section seven.
 * One research pass, one set of numbers, quoted the same way in minute two and
 * in minute fifteen.
 *
 * It is deliberately the same idea as `info.json` and the fact guard the shorts
 * use: a declared whitelist of checkable claims, and nothing outside it. The
 * difference is that here the model assembles the whitelist itself, from
 * sources it names, because nobody can hand-write one for an event that
 * happened last week.
 */

export const FactSchema = z.strictObject({
  /** Referred to by sections, so a claim can be traced to where it was used. */
  id: z.string().min(1),
  /** One checkable statement, in Vietnamese, as it would be said aloud. */
  claim: z.string().min(1).max(400),
  /**
   * Where it came from: a publication and, where there is one, a URL.
   *
   * Required rather than optional. A fact with no source is the failure this
   * module exists to prevent, and a mandatory field means the model has to
   * notice it is inventing before it can finish the object.
   */
  source: z.string().min(1).max(300),
  /**
   * When the figure was true.
   *
   * A death toll is a measurement with a timestamp, not a constant. Without
   * this the video says "more than a thousand" with no way for a viewer - or
   * for the next re-run - to know how stale that is.
   */
  asOf: z.string().max(40).default(''),
});
export type Fact = z.infer<typeof FactSchema>;

export const SectionPlanSchema = z.strictObject({
  id: z.string().min(1),
  /** Shown on screen at the top of the section, and used as a YouTube chapter. */
  heading: z.string().min(1).max(70),
  /** What this section covers and where it leaves the viewer. For the writer. */
  angle: z.string().min(1).max(600),
  /** Which facts belong here, by id. */
  factIds: z.array(z.string().min(1)).default([]),
  /** Syllables of narration this section gets. */
  wordBudget: z.number().int().positive(),
});
export type SectionPlan = z.infer<typeof SectionPlanSchema>;

/**
 * How many sections a video is cut into.
 *
 * Six is the floor because fewer means sections long enough to hit the
 * compression failure inside one call. Fourteen is the ceiling because each
 * section is both a Claude call and a YouTube chapter, and a fifteen-minute
 * video with twenty chapters has chapters nobody navigates by.
 */
export const MIN_SECTIONS = 6;
export const MAX_SECTIONS = 14;

export const MIN_FACTS = 10;
export const MAX_FACTS = 60;

/**
 * How many distinct photograph themes a video declares.
 *
 * Raised from 8-16. The floor is what decides how often a scene has to borrow
 * a picture from a different subject: at twelve queries a ninety-scene video
 * gives each query about seven scenes, and the outline prompt now asks for them
 * *per section* rather than for the video as a whole, so those seven are seven
 * scenes about the same thing.
 *
 * The ceiling is held near twenty by the search rather than by taste. Anonymous
 * Openverse allows twenty searches a minute, and a query that finds too little
 * is widened into a second search - so a video declaring thirty would spend the
 * minute's budget before it finished looking.
 */
export const MIN_IMAGE_QUERIES = 12;
export const MAX_IMAGE_QUERIES = 18;

/**
 * How many Wikimedia Commons categories a video may name for the event itself.
 *
 * Small on purpose, and the ceiling is not a style preference - it is the
 * supply. A stock query returns a dozen interchangeable photographs of a
 * mountain river; a Commons category for a disaster that happened last week
 * contains, in the measured case, **five usable files**. Naming ten categories
 * does not produce fifty pictures, it produces the same five plus whatever
 * full-text search drags in, and Commons full-text is poor enough that a loose
 * query for "Rasuwagadhi" comes back with map sheets of Pakistan.
 *
 * Zero is allowed, and is the right answer for a subject nobody has
 * photographed under a reusable licence.
 */
export const MAX_EVENT_QUERIES = 6;

/** Marks a query as one for the event itself. See the Commons provider. */
export const COMMONS_PREFIX = 'commons:';

/**
 * The queries a scene may choose from: the generic themes, then the event ones
 * with the prefix that routes them to Commons.
 *
 * The prefix is attached here rather than asked for in the prompt, because it
 * is a routing detail of this engine and the model has no way to know it is
 * required - and a query that should have gone to Commons and went to the stock
 * library instead comes back with a photograph of a different mountain, which
 * is exactly the failure this whole mechanism exists to remove.
 */
export function allQueriesOf(outline: {
  imageQueries: readonly string[];
  eventImageQueries?: readonly string[];
}): string[] {
  return [
    ...outline.imageQueries,
    ...(outline.eventImageQueries ?? []).map((q) => `${COMMONS_PREFIX}${q}`),
  ];
}

export const OutlineSchema = z.strictObject({
  episodeTitle: z.string().min(1).max(200),
  summary: z.string().min(1).max(1200),
  facts: z.array(FactSchema).min(MIN_FACTS).max(MAX_FACTS),
  sections: z.array(SectionPlanSchema).min(MIN_SECTIONS).max(MAX_SECTIONS),
  imageQueries: z.array(z.string().min(1)).min(MIN_IMAGE_QUERIES).max(MAX_IMAGE_QUERIES),
  /**
   * Wikimedia Commons categories holding pictures of *this* event.
   *
   * The one thing a stock library cannot supply. Openverse indexes openly
   * licensed stock and rebuilds from Commons on its own schedule, so an event
   * from last week is on Commons and not yet in Openverse - which is why these
   * are searched separately rather than folded into `imageQueries`.
   *
   * Defaults to empty, because most subjects have no such category and a video
   * about the history of honey should not be forced to invent one.
   */
  eventImageQueries: z.array(z.string().min(1)).max(MAX_EVENT_QUERIES).default([]),
  publish: PublishMetaSchema,
});
export type Outline = z.infer<typeof OutlineSchema>;

/** Anything outside plain ASCII, which for a query means Vietnamese tone marks. */
const NON_ASCII = /[^\u0000-\u007f]/u;

/**
 * Structural rules a plain schema cannot express, written in the language of
 * the prompt so they can be echoed back verbatim on a retry.
 */
export function checkOutline(
  outline: Outline,
  targetWords: number,
  /** Pages the person asked the video to be built from. Empty for most runs. */
  sources: readonly string[] = [],
): string[] {
  const problems: string[] = [];
  const factIds = new Set(outline.facts.map((f) => f.id));

  const seenFacts = new Set<string>();
  for (const fact of outline.facts) {
    if (seenFacts.has(fact.id)) problems.push(`Trùng id sự kiện: "${fact.id}".`);
    seenFacts.add(fact.id);
  }

  const seenSections = new Set<string>();
  for (const section of outline.sections) {
    if (seenSections.has(section.id)) problems.push(`Trùng id phần: "${section.id}".`);
    seenSections.add(section.id);

    for (const id of section.factIds) {
      if (!factIds.has(id)) {
        problems.push(
          `Phần "${section.id}" tham chiếu sự kiện "${id}" không có trong danh sách facts.`,
        );
      }
    }
  }

  for (const query of [...outline.imageQueries, ...outline.eventImageQueries]) {
    if (NON_ASCII.test(query)) {
      problems.push(
        `imageQuery "${query}" có dấu tiếng Việt. Kho ảnh chỉ đánh chỉ mục bằng tiếng Anh.`,
      );
    }
  }

  /*
   * The title must be Vietnamese, tone marks and all.
   *
   * This looks paranoid and is not: the first real video written by this module
   * came back with `publish.title` stripped to plain ASCII - "Lu bang da bien
   * gioi Nepal" - while `episodeTitle` two fields above it kept its tones. The
   * cause is upstream in this same prompt, which spends a paragraph insisting
   * that image queries must be unaccented English, and the rule leaked onto the
   * one other field the model thought of as machine-facing.
   *
   * Nothing else catches it. The schema is happy, the video renders, and the
   * mistake is only visible on YouTube, where a Vietnamese title without tones
   * reads as broken and matches nobody's search.
   */
  if (!NON_ASCII.test(outline.publish.title)) {
    problems.push(
      `publish.title ("${outline.publish.title}") không có dấu tiếng Việt nào. Quy tắc viết ` +
        'không dấu CHỈ áp dụng cho imageQueries - tiêu đề, mô tả và thẻ đều là tiếng Việt có ' +
        'dấu đầy đủ.',
    );
  }

  /*
   * The budgets have to add up, because each one is what a section call is
   * given as its own target. A plan whose parts sum to eleven minutes produces
   * an eleven-minute video however clearly the outline prompt asked for
   * seventeen - and it does so without any single call having disobeyed, which
   * is why this is checked here rather than discovered at the end.
   */
  const planned = outline.sections.reduce((sum, s) => sum + s.wordBudget, 0);
  const drift = Math.abs(planned - targetWords) / targetWords;
  if (drift > 0.05) {
    problems.push(
      `Tổng wordBudget của các phần là ${planned} từ, trong khi cả video cần ${targetWords} từ ` +
        `(lệch ${Math.round(drift * 100)}%). Chia lại cho tổng đúng bằng ${targetWords}.`,
    );
  }

  const unused = outline.facts.filter(
    (f) => !outline.sections.some((s) => s.factIds.includes(f.id)),
  );
  if (unused.length > outline.facts.length / 3) {
    problems.push(
      `${unused.length}/${outline.facts.length} sự kiện không phần nào dùng đến. Hoặc gán chúng ` +
        'vào phần phù hợp, hoặc bỏ hẳn - đừng tra cứu ra rồi để đấy.',
    );
  }

  /*
   * The sources somebody chose have to actually carry the video.
   *
   * The prompt says so, and the first real run mostly listened - thirteen of
   * twenty-eight facts came from the two articles given. But "mostly listened"
   * is the same guarantee as "usually", and the failure it leaves open is the
   * whole reason this feature exists: a person pastes the story they want, the
   * research call searches, finds a livelier one, and writes that instead. So
   * the share is measured, and an outline that barely touches the given pages
   * is sent back naming them.
   *
   * Matched on the URL *or* the site's name, because the model cites by name as
   * often as by address - "Wikipedia, Honey" for en.wikipedia.org/wiki/Honey -
   * and rejecting a correct outline over citation style would be a retry spent
   * on formatting. Commons category links are left out of the count: they are
   * pictures, and a fact is not expected to cite them.
   */
  const readable = sources.filter((url) => !url.includes('commons.wikimedia.org'));
  if (readable.length > 0 && outline.facts.length > 0) {
    const marks = readable.flatMap(sourceMarks);
    const fromGiven = outline.facts.filter((f) => {
      const cited = f.source.toLowerCase();
      return marks.some((mark) => cited.includes(mark));
    }).length;

    const share = fromGiven / outline.facts.length;
    if (share < MIN_SOURCED_SHARE) {
      problems.push(
        `Chỉ ${fromGiven}/${outline.facts.length} dữ kiện lấy từ những trang người dùng đã chỉ ` +
          `định (${readable.join(', ')}). Video phải dựng CHỦ YẾU từ những trang này - đọc chúng ` +
          'bằng WebFetch, lấy dữ kiện từ đó, và ghi đúng URL vào trường "source". Tìm thêm chỉ ' +
          'để bổ sung, không được đổi sang câu chuyện khác.',
      );
    }
  }

  return problems;
}

/**
 * How much of the research has to come from the pages somebody chose.
 *
 * A quarter. Low on purpose: a fifteen-minute video legitimately needs more than
 * three articles can supply, and the research call is *meant* to fill gaps. The
 * threshold is there to catch the outline that read the links and then ignored
 * them, not to punish one that went looking for a second source on a figure -
 * the first real run sat at forty-six percent and was exactly the outline this
 * feature is supposed to produce.
 */
const MIN_SOURCED_SHARE = 0.25;

/**
 * What a citation of this page might contain: the URL itself, and the site's
 * name as a person would write it.
 *
 * `en.wikipedia.org` becomes "wikipedia" and `www.smithsonianmag.com` becomes
 * "smithsonianmag" - the part of the hostname a citation actually repeats.
 */
function sourceMarks(url: string): string[] {
  const marks = [url.toLowerCase()];
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./u, '');
    const labels = host.split('.');
    // The registrable name: second-from-last label, or the one before a
    // two-letter country suffix ("bbc.co.uk" -> "bbc").
    const name = labels.length >= 3 && labels.at(-2)!.length <= 3 ? labels.at(-3) : labels.at(-2);
    if (name && name.length >= 3) marks.push(name);
  } catch {
    // An unparseable URL still matches on its own text.
  }
  return marks;
}
