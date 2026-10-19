import type { StockImage, StockImageProvider, StockSearchOptions } from './types';
import { ERROR_CODES, PipelineError } from '../../../../domain/errors';
import { withRetry } from '../../../../utils/retry';

/**
 * Wikimedia Commons, asked directly.
 *
 * ## Why this exists when Openverse already indexes Commons
 *
 * Because it does not index it *yet*. Openverse rebuilds from Commons on its
 * own schedule, and the gap is weeks - which is precisely the window this
 * provider was added for. Searching Openverse for the August 2026 Nepal flood a
 * week later returned nothing; asking Commons the same question returned
 * fourteen files, including satellite passes over the valley the day it
 * happened and two videos of the debris flow arriving at the border post.
 *
 * So this is not a second general-purpose picture source. Openverse remains the
 * one that answers "a photograph of a mountain river": it is broader, better
 * ranked and rate-limit friendly. This one answers a different and much
 * narrower question - **"is there a picture of this actual event?"** - which
 * for a channel reporting real events is the only question that matters on the
 * scenes describing what happened.
 *
 * ## Categories, not just search
 *
 * The valuable thing on Commons is not its full-text search, which is poor. It
 * is that somebody has already curated `Category:2026 Nepal and Tibet floods`
 * and put the fourteen relevant files in it. So a query is tried as a category
 * first and as a text search second, and the category hits come back ahead of
 * the search hits because a human put them there.
 *
 * ## Licences
 *
 * The same rule as everywhere else in this directory, including the subtle one:
 * public domain, CC0 and CC BY are usable; **ShareAlike is not**, because a
 * video built from a BY-SA picture arguably has to be BY-SA itself and that is
 * not a decision a render pipeline should make for a channel. On this event
 * that costs one file, an explanatory map. Everything else in the category is
 * PD, CC0 or BY.
 */

const API = 'https://commons.wikimedia.org/w/api.php';

/**
 * Commons asks for a real User-Agent and throttles anonymous clients that do
 * not send one. Naming the project is the condition of the API, not politeness.
 */
const USER_AGENT = 'VideoGeneratorPipelines/1.0 (YouTube documentary pipeline)';

/** The prefix that routes a query here instead of to the stock library. */
export const COMMONS_PREFIX = 'commons:';

export const isCommonsQuery = (query: string) =>
  query.trim().toLowerCase().startsWith(COMMONS_PREFIX);

export const stripCommonsPrefix = (query: string) =>
  query.trim().slice(query.trim().toLowerCase().indexOf(COMMONS_PREFIX) + COMMONS_PREFIX.length).trim();

/**
 * Licence strings Commons reports, mapped to the short codes the timeline and
 * the publishing kit use. Anything not in here is not used.
 *
 * The keys are matched case-insensitively against `LicenseShortName`, which is
 * free text - "CC BY 4.0", "CC BY-SA 4.0", "Public domain", "Attribution", "CC0"
 * are all real values seen on one category.
 */
function licenseCodeOf(
  shortName: string,
  shareAlike = false,
): { code: string; url: string } | null {
  const name = shortName.toLowerCase();
  // The version the file was actually released under, so the credit links the
  // licence the photographer chose rather than always 4.0.
  const version = name.match(/(\d\.\d)/u)?.[1] ?? '4.0';

  if (name.includes('nc') || name.includes('noncommercial')) return null;
  if (name.includes('nd') || name.includes('noderiv')) return null;
  // Checked before the plain "cc by" test, which would otherwise match it.
  if (name.includes('sa')) {
    return shareAlike && name.includes('by')
      ? { code: 'by-sa', url: `https://creativecommons.org/licenses/by-sa/${version}/` }
      : null;
  }

  if (name.includes('cc0')) {
    return { code: 'cc0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' };
  }
  if (name.includes('public domain') || name.includes('pd-')) {
    return { code: 'pdm', url: 'https://creativecommons.org/publicdomain/mark/1.0/' };
  }
  if (name.includes('cc by') || name === 'attribution') {
    return { code: 'by', url: `https://creativecommons.org/licenses/by/${version}/` };
  }
  return null;
}

/** Strips the HTML Commons wraps its metadata fields in. */
function plainText(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#0?39;/gu, "'")
    .replace(/&nbsp;/gu, ' ')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Collapses a credit that repeats itself.
 *
 * Commons stores `Artist` as free HTML, and a template that renders the same
 * name twice - once as a link and once as plain text - comes out of `plainText`
 * as "Unknown author Unknown author". That string is drawn in the corner of
 * every frame it appears on, so it is worth the four lines.
 */
function dedupe(text: string): string {
  const half = text.length / 2;
  const first = text.slice(0, Math.floor(half)).trim();
  return first && text === `${first} ${first}` ? first : text;
}

/**
 * File types worth asking for.
 *
 * PDFs and videos are in these categories too - situation reports and phone
 * footage - and neither is a backdrop. Everything else is taken through
 * Commons' thumbnail renderer, which turns an SVG map or an animated GIF into a
 * flat raster the same way it does a JPEG, so those are usable without any
 * special handling here.
 */
/** Commons is usually fast; this only stops a hung socket parking a run. */
const TIMEOUT_MS = 20_000;

/**
 * Shortest gap between two requests to Commons.
 *
 * Wikimedia asks anonymous clients to stay around one request a second, and it
 * enforces it: this provider spends up to three requests per query - a category
 * lookup, a plural retry, an imageinfo batch - so a video asking eighteen
 * queries is fifty requests, and unthrottled it was refused after about four.
 *
 * A gap rather than a token bucket because the requests are already sequential;
 * there is nothing to smooth, only a floor to keep.
 *
 * Two seconds is a floor that held in testing, not a published figure -
 * Wikimedia does not document the anonymous limit, and the measurement here was
 * taken from a client that had already been throttled that afternoon, so treat
 * it as "known to be enough" rather than as "known to be the limit". The retry
 * below is what actually makes this safe; the gap only keeps it from being
 * needed.
 */
const MIN_REQUEST_GAP_MS = 2000;

/** Serialises every call in this process, whichever provider instance made it. */
let nextRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = nextRequestAt - Date.now();
  nextRequestAt = Math.max(Date.now(), nextRequestAt) + MIN_REQUEST_GAP_MS;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/**
 * The spellings worth trying for a category, best first.
 *
 * Title case because Commons capitalises category names, and plurals because
 * a category of a *kind of thing* is plural there almost without exception.
 * Only the head noun is pluralised: `Category:Tropical islands`, not
 * `Category:Tropicals islands`.
 */
function categoryNames(term: string): string[] {
  const words = term.trim().split(/\s+/u);
  if (words.length === 0) return [];

  const titled = [words[0]![0]!.toUpperCase() + words[0]!.slice(1), ...words.slice(1)];
  const exact = titled.join(' ');

  const last = titled[titled.length - 1]!;
  const plural = /(s|x|z|ch|sh)$/iu.test(last)
    ? `${last}es`
    : /[^aeiou]y$/iu.test(last)
      ? `${last.slice(0, -1)}ies`
      : `${last}s`;

  const pluralised = [...titled.slice(0, -1), plural].join(' ');
  return [...new Set([exact, pluralised])];
}

const SKIP_EXTENSIONS = /\.(pdf|webm|ogv|mp4|djvu|tif|tiff)$/iu;

interface CommonsImageInfo {
  url: string;
  thumburl?: string;
  width: number;
  height: number;
  descriptionurl: string;
  extmetadata?: Record<string, { value?: string }>;
}

export class WikimediaCommonsProvider implements StockImageProvider {
  readonly name = 'wikimedia-commons';

  /**
   * Shorter edges are accepted here than the stock library allows, and it is a
   * deliberate trade rather than an oversight.
   *
   * The 1600px floor elsewhere exists because a stock photograph is cropped
   * hard to fill a frame and then pushed another twenty percent by the camera
   * move. It assumes there is always another photograph. Here there is not:
   * these are the only pictures of this event that exist under a licence this
   * channel may use, and a slightly soft frame of the actual valley is worth
   * more than a sharp photograph of a different mountain. A Landsat pass at
   * 1918x1094 also happens to be an almost exact fit for a 1920x1080 frame, so
   * in practice the softness is theoretical.
   */
  private static readonly MIN_EDGE = 800;

  private readonly shareAlike: boolean;

  constructor(options: { shareAlike?: boolean } = {}) {
    this.shareAlike = options.shareAlike ?? false;
  }

  async search(options: StockSearchOptions): Promise<StockImage[]> {
    const term = isCommonsQuery(options.query)
      ? stripCommonsPrefix(options.query)
      : options.query.trim();
    if (!term) return [];

    /*
     * An exact page name is looked up exactly.
     *
     * "Category:Đông Ngạc" and "File:Hanoi flood 2008.jpg" come from a search
     * made for one scene by something that read the page; running them through
     * the full-text search as well would add whatever else mentions the words,
     * which is the noise that search was asked to get away from.
     */
    const lower = term.toLowerCase();
    const titles = lower.startsWith('file:')
      ? [`File:${term.slice('file:'.length).trim()}`]
      : lower.startsWith('category:')
        ? await this.membersOf(`Category:${term.slice('category:'.length).trim()}`)
        : [...(await this.categoryMembers(term)), ...(await this.textSearch(term))];

    const seen = new Set<string>();
    const unique = titles.filter((t) => !seen.has(t) && (seen.add(t), true));
    if (unique.length === 0) return [];

    const info = await this.imageInfo(unique.slice(0, 50));
    const minEdge = Math.min(options.minEdge, WikimediaCommonsProvider.MIN_EDGE);

    const images: StockImage[] = [];
    for (const [title, ii] of info) {
      const meta = ii.extmetadata ?? {};
      const licence = licenseCodeOf(plainText(meta.LicenseShortName?.value), this.shareAlike);
      if (!licence) continue;

      const creator = dedupe(
        plainText(meta.Artist?.value) || plainText(meta.Credit?.value) || 'Wikimedia Commons',
      );
      if (!creator) continue;
      if (Math.min(ii.width, ii.height) < minEdge) continue;

      // The rendered thumbnail rather than the original: it is what makes an
      // SVG map or an animated GIF usable as a still, and for an ordinary
      // raster at this width it is the original in all but name.
      const url = ii.thumburl ?? ii.url;

      images.push({
        id: title.replace(/^File:/u, ''),
        provider: this.name,
        url,
        thumbnailUrl: url,
        width: ii.width,
        height: ii.height,
        title: plainText(meta.ObjectName?.value) || title.replace(/^File:/u, ''),
        words: [
          plainText(meta.ImageDescription?.value),
          plainText(meta.Categories?.value),
        ]
          .filter(Boolean)
          .join(' ')
          .slice(0, 600),
        category: 'photograph',
        // Ranked as a photograph, which on this source is a claim about intent
        // rather than about the file: a satellite pass and a screenshot from
        // phone footage are both records of the event, which is the whole
        // reason to reach for this provider.
        isPhotograph: true,
        creator: creator.slice(0, 120),
        sourceUrl: ii.descriptionurl,
        license: licence.code,
        licenseUrl: licence.url,
      });
    }

    return images.slice(0, options.limit);
  }

  /**
   * Files a human has already filed under this subject.
   *
   * Tried in a few spellings, because Commons category names follow a
   * convention this engine's queries do not: they are **title-cased and
   * plural** for anything that is a class of thing. `Category:Jellyfish`
   * exists; `Category:lighthouse` does not, while `Category:Lighthouses` holds
   * thousands. Measured on seven ordinary queries, the exact-name lookup found
   * three - every miss was a singular.
   *
   * Stops at the first spelling that has files, so a hit costs one request and
   * only a genuine miss costs the rest.
   */
  private async categoryMembers(term: string): Promise<string[]> {
    if (term.toLowerCase().startsWith('category:')) return this.membersOf(term);

    for (const name of categoryNames(term)) {
      const found = await this.membersOf(`Category:${name}`);
      if (found.length > 0) return found;
    }
    return [];
  }

  private async membersOf(title: string): Promise<string[]> {
    const data = await this.get({
      action: 'query',
      list: 'categorymembers',
      cmtitle: title,
      cmtype: 'file',
      cmlimit: '60',
    });

    const members = (data?.query?.categorymembers ?? []) as { title: string }[];
    return members.map((m) => m.title).filter((t) => !SKIP_EXTENSIONS.test(t));
  }

  private async textSearch(term: string): Promise<string[]> {
    const data = await this.get({
      action: 'query',
      list: 'search',
      srsearch: term,
      srnamespace: '6',
      srlimit: '40',
    });

    const hits = (data?.query?.search ?? []) as { title: string }[];
    return hits.map((h) => h.title).filter((t) => !SKIP_EXTENSIONS.test(t));
  }

  /** Size, licence and author for a batch of files, in one call per fifty. */
  private async imageInfo(titles: string[]): Promise<Map<string, CommonsImageInfo>> {
    const out = new Map<string, CommonsImageInfo>();
    if (titles.length === 0) return out;

    const data = await this.get({
      action: 'query',
      prop: 'imageinfo',
      titles: titles.join('|'),
      iiprop: 'url|size|extmetadata|mime',
      iiurlwidth: '2000',
    });

    const pages = (data?.query?.pages ?? {}) as Record<
      string,
      { title: string; imageinfo?: CommonsImageInfo[] }
    >;
    for (const page of Object.values(pages)) {
      const ii = page.imageinfo?.[0];
      if (ii) out.set(page.title, ii);
    }

    // The API returns pages in its own order; restore the caller's, so curated
    // category members stay ahead of full-text hits.
    const ordered = new Map<string, CommonsImageInfo>();
    for (const title of titles) {
      const ii = out.get(title);
      if (ii) ordered.set(title, ii);
    }
    return ordered;
  }

  /**
   * One request, retried when Commons says to slow down.
   *
   * The gap above keeps this from happening; this handles the case where it
   * happens anyway - a burst from somewhere else on the same address, or a
   * limit tighter than the floor assumes. Commons' throttle clears in seconds,
   * unlike Openverse's daily quota, so waiting is the right answer here where
   * it is not there.
   */
  private get(params: Record<string, string>): Promise<any> {
    return withRetry(() => this.getOnce(params), {
      attempts: 3,
      initialDelayMs: 5000,
      maxDelayMs: 20_000,
      shouldRetry: (err) =>
        err instanceof PipelineError &&
        (err.code === ERROR_CODES.RATE_LIMITED ||
          err.code === ERROR_CODES.STOCK_SEARCH_UNREACHABLE),
    });
  }

  private async getOnce(params: Record<string, string>): Promise<any> {
    const url = new URL(API);
    for (const [k, v] of Object.entries({ ...params, format: 'json', origin: '*' })) {
      url.searchParams.set(k, v);
    }

    await throttle();

    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((err: unknown) => {
      throw new PipelineError(
        ERROR_CODES.STOCK_SEARCH_UNREACHABLE,
        'process-images',
        `Could not reach Wikimedia Commons: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    /*
     * A refusal is raised, not swallowed.
     *
     * This used to `return null` on any non-200, which meant Commons answering
     * "You are making too many requests to the API" was indistinguishable from
     * a category that genuinely has no files - and the caller would go looking
     * for a better category name for a query that was never actually asked.
     * Commons throttles anonymous clients, and this provider spends three
     * requests per query, so it is a limit a long video reaches.
     */
    if (response.status === 429) {
      throw new PipelineError(
        ERROR_CODES.RATE_LIMITED,
        'process-images',
        'Wikimedia Commons is rate-limiting this client. Space the searches out, or wait.',
      );
    }
    if (!response.ok) {
      throw new PipelineError(
        ERROR_CODES.STOCK_SEARCH_UNREACHABLE,
        'process-images',
        `Wikimedia Commons returned ${response.status}.`,
      );
    }

    const body = await response.text();
    try {
      return JSON.parse(body) as unknown;
    } catch {
      // Commons answers its throttle in plain text with a 200, which JSON.parse
      // reports as a syntax error rather than as the refusal it is.
      throw new PipelineError(
        ERROR_CODES.RATE_LIMITED,
        'process-images',
        `Wikimedia Commons did not return JSON: ${body.slice(0, 120)}`,
      );
    }
  }
}

/**
 * Sends a query to whichever source can answer it.
 *
 * A `commons:` prefix is the storyboard saying "this scene is about the thing
 * itself, find the real one"; everything else goes to the stock library first
 * and falls through to Commons when that library is unreachable or empty. Written as a provider rather than as a branch
 * inside `resolveSceneImages` so the resolver keeps knowing nothing about where
 * pictures come from - it deals in queries, and the cache key it builds from
 * `provider.name` stays stable because that name is this router's, not the
 * source it happened to pick.
 */
export class RoutedStockProvider implements StockImageProvider {
  readonly name: string;

  constructor(
    private readonly stock: StockImageProvider,
    private readonly commons: StockImageProvider,
    /** Photographs from a news article, used with the paper's permission. */
    private readonly article: StockImageProvider | null = null,
    options: { shareAlike?: boolean } = {},
  ) {
    // Both names, so widening the router invalidates cached searches that were
    // answered by the old arrangement - and the licence policy, because a pool
    // searched without ShareAlike is the wrong pool once a channel allows it.
    this.name = `${stock.name}+${commons.name}${options.shareAlike ? '+sa' : ''}`;
  }

  async search(options: StockSearchOptions): Promise<StockImage[]> {
    if (isCommonsQuery(options.query)) return this.commons.search(options);
    // Only reachable when the project declared permission: the router is built
    // without an article provider otherwise, and an `article:` query then finds
    // nothing rather than quietly fetching somebody's photographs.
    if (options.query.trim().toLowerCase().startsWith('article:')) {
      return this.article ? this.article.search(options) : [];
    }

    try {
      const images = await this.stock.search(options);
      if (images.length > 0) return images;
    } catch (err) {
      /*
       * Commons as the understudy, not as the replacement.
       *
       * Openverse is broader and better ranked and answers the ordinary
       * question well - but it is a free public API that has now been down for
       * two days at a stretch, and a channel publishing every six hours cannot
       * wait for it. Commons is not down: it is Wikipedia's own infrastructure.
       *
       * Only for "could not reach it". A 4xx means this code asked wrongly and
       * asking Commons instead would hide that; a rate limit is worth waiting
       * out rather than working around.
       */
      const unreachable =
        err instanceof PipelineError && err.code === ERROR_CODES.STOCK_SEARCH_UNREACHABLE;
      if (!unreachable) throw err;
    }

    // Also reached when the stock library simply had nothing: Commons holds
    // subjects a commercial library does not, so it is worth the second ask.
    return this.commons.search(options);
  }
}
