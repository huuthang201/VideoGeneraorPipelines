import { ERROR_CODES, PipelineError } from '../../../../domain/errors';
import type { StockImage, StockImageProvider, StockSearchOptions } from './types';

/**
 * Openverse - the openly-licensed image search run by WordPress.
 *
 * Chosen over Pexels, Unsplash and Pixabay for one reason that outweighs image
 * quality: **it needs no API key**. Every alternative requires an account, and
 * a tool whose entire purpose is to remove a manual step should not begin by
 * demanding a signup. Openverse aggregates StockSnap, Flickr, museum
 * collections and Wikimedia behind one endpoint, and with the filters below it
 * returns 3000-8000px photographs.
 *
 * ## The filters are the licence policy
 *
 * `license=cc0,pdm,by` is doing real work and must not be widened casually:
 *
 * - `cc0` and `pdm` are public domain - no obligation at all.
 * - `by` needs the creator named, which the on-screen credit does.
 * - Everything else is excluded on purpose. `by-sa` would arguably make the
 *   finished video ShareAlike; `nc` forbids the monetised channel this feeds;
 *   `nd` forbids the cropping every scene does.
 *
 * `license_type=commercial,modification` would be the loose equivalent and is
 * *not* used, because it still admits `by-sa`.
 *
 * `size=large` is the sharpness rule: it drops the thumbnails and screenshots
 * that a full-text search otherwise surfaces alongside real photographs.
 *
 * ## Rate limits shape the design upstream
 *
 * Anonymous access is 20 requests a minute and **200 a day**. At a video an
 * hour that is the binding constraint on the whole system, and it is why a
 * storyboard names two to four image queries for the whole video rather than
 * one per scene: four searches a video is a hundred a day, comfortably inside
 * the budget, while nine would not be.
 *
 * There is a second, sharper anonymous limit that is easy to trip over:
 * `page_size` may not exceed 20, and asking for more returns **401**, not 400.
 * A 401 reads as "your credentials are wrong" when the real problem is that a
 * request with no credentials asked for too much at once - which is why
 * `MAX_PAGE_SIZE` is derived from whether a token is present, and why the error
 * below says so.
 */

const ENDPOINT = 'https://api.openverse.org/v1/images/';

/**
 * Licence codes accepted, in the order they are preferred.
 *
 * Public domain first: an image with no attribution obligation at all is
 * strictly safer than one that has to be credited correctly forever, and the
 * ranking costs nothing because the search returns both anyway.
 */
const LICENSES = ['cc0', 'pdm', 'by'] as const;

/**
 * Aspect ratio at or below which a photograph fills a vertical frame without
 * losing its subject.
 *
 * A 3:2 landscape photograph cropped to 9:16 keeps about a third of its width,
 * and whatever the photographer put off-centre goes with the rest - which is
 * how a search for "jellyfish" produces a frame of empty water with a fin at
 * the edge. Anything at 4:3 or squarer survives the crop with its middle
 * intact, so those are ranked first when the pool contains any.
 *
 * A preference rather than a filter, because it has to lose to relevance:
 * `aspect_ratio=tall` on the request itself returns nothing at all for many
 * subjects, and an on-topic landscape photograph beats a vertical one of
 * something else.
 */
const COMFORTABLE_ASPECT = 4 / 3;

/**
 * Words that mean the result is a picture *of* a picture.
 *
 * Openverse indexes museum and archive collections alongside stock
 * photography, and a text search for an animal happily returns
 * eighteenth-century engravings of it. They are correctly licensed, correctly
 * tagged, high resolution - and they look nothing like the other eight scenes,
 * which is what made an earlier video cut from a photograph of a hippo to a
 * Dutch copperplate of one.
 *
 * Matched against the title *and* the tags, because the two catch different
 * cases: the plate scans announce themselves in the title, while a cleaned-up
 * reproduction on a stock site looks like a photograph until you read its tags
 * and find "engravings" among them.
 *
 * The vaguer words - `art`, `cartoon`, `vintage` - earn their place because of
 * how the stock sites tag: a photograph gets concrete nouns ("mouse animal",
 * "grass", "rodent") while a digitised plate gets its medium ("art", "cartoon",
 * "pattern"). They cost the occasional genuine photograph of street art, which
 * is a trade worth making for a channel that would otherwise cut from a mouse
 * to a nineteenth-century engraving of one.
 */
const ARTWORK_WORDS =
  /\b(engraving|engravings|engraved|lithograph|chromolithograph|etching|woodcut|drawing|drawn|painting|illustration|illustrated|sketch|watercolou?r|copperplate|art|artwork|cartoon|vector|clipart|vintage|antique|retro|poster)\b/iu;

/**
 * A title that is really a fragment of a museum catalogue record.
 *
 * Wikimedia stores some captions as HTML, so the "title" comes back as
 * `<div class='fn'> An hippopotamus, a pelican, ...`. Nothing good is ever
 * behind one of these.
 */
const MARKUP_TITLE = /<[a-z/!]/iu;

/**
 * A title that describes where things sit inside a composite plate.
 *
 * Digitised natural-history plates are catalogued by panel: "Top left, rat; top
 * right...", "Three chameleons shelf (top); one...", "left, hippopotamus
 * climbing water. right". A photograph is never described this way, because a
 * photograph has one subject and no panels - so the pattern is a reliable
 * signal even when the licence, the resolution and the source all look like
 * ordinary stock. These come from rawpixel, which is otherwise a good provider,
 * which is why they survive the source allowlist and need catching here.
 */
const PLATE_TITLE = /\b(top|bottom)\s+(left|right)\b|^\s*(left|right)\s*,/iu;

/**
 * Words too common to say anything about relevance.
 *
 * Deliberately tiny. This is not stopword removal for its own sake - it exists
 * so that "hippo in water" and "hippo water" score the same, rather than the
 * first being punished for containing a preposition.
 */
const IGNORED_TERMS = new Set(['in', 'on', 'at', 'of', 'the', 'a', 'an', 'and', 'with']);

/**
 * Longest edge a candidate may have.
 *
 * Openverse indexes museum and observatory collections alongside stock
 * photographs, and those include gigapixel scans - a 16823x16823 Hubble mosaic
 * came back for "ocean deep blue" and was 162MB. Nothing in a 1080x1920 frame
 * benefits from that, and downloading it costs minutes. Eight thousand pixels
 * is four times what the render uses and still an ordinary camera file.
 */
const MAX_SOURCE_EDGE = 8000;

/**
 * File types that are not worth attempting.
 *
 * TIFF is the one that actually costs something: Wikimedia serves archival
 * scans as multi-hundred-megabyte TIFFs that spend the whole download timeout
 * before being abandoned, and nothing they contain is better than the JPEG two
 * results further down. SVG is excluded for a different reason - it is a
 * drawing, not a photograph, and scales to any size so it passes the resolution
 * filter while looking nothing like the rest of the video.
 */
const UNUSABLE_EXTENSIONS = /\.(tiff?|svg|gif)(\?|$)/iu;

/** Bounded so a stalled search fails the job rather than parking the queue. */
const TIMEOUT_MS = 20_000;

/** Results per request. The anonymous ceiling is 20; a token raises it. */
const MAX_PAGE_SIZE = { anonymous: 20, authenticated: 50 } as const;

interface OpenverseResult {
  id: string;
  title?: string | null;
  thumbnail?: string | null;
  category?: string | null;
  tags?: { name?: string | null }[] | null;
  url?: string | null;
  creator?: string | null;
  foreign_landing_url?: string | null;
  license?: string | null;
  license_version?: string | null;
  license_url?: string | null;
  provider?: string | null;
  source?: string | null;
  width?: number | null;
  height?: number | null;
}

interface OpenverseResponse {
  result_count: number;
  results: OpenverseResult[];
}

export class OpenverseProvider implements StockImageProvider {
  readonly name = 'openverse';

  /**
   * @param token   optional Openverse API token. Anonymous access works and is
   *                the default; a token only raises the rate limit, so it is
   *                read from configuration rather than required.
   * @param sources comma-separated provider names to search. Empty searches
   *                everything, which is rarely what anyone wants - see
   *                STOCK_SOURCES for why.
   */
  constructor(
    private readonly token: string = '',
    private readonly sources: string = '',
  ) {}

  async search(options: StockSearchOptions): Promise<StockImage[]> {
    const ceiling = this.token ? MAX_PAGE_SIZE.authenticated : MAX_PAGE_SIZE.anonymous;

    const params = new URLSearchParams({
      q: options.query,
      // Asked for generously, because the minimum-size filter below throws some
      // away and scenes sharing a query each need their own picture. Capped at
      // what this client is actually allowed to ask for - see MAX_PAGE_SIZE.
      page_size: String(Math.min(ceiling, Math.max(options.limit * 3, 20))),
      license: LICENSES.join(','),
      size: 'large',
      mature: 'false',
      ...(this.sources ? { source: this.sources } : {}),
    });

    const response = await this.fetchJson(`${ENDPOINT}?${params.toString()}`, options.query);

    return response.results
      .map((result) => toStockImage(result))
      .filter((image): image is StockImage => image !== null)
      .filter((image) => Math.min(image.width, image.height) >= options.minEdge)
      .filter((image) => Math.max(image.width, image.height) <= MAX_SOURCE_EDGE)
      .filter((image) => !UNUSABLE_EXTENSIONS.test(image.url))
      .filter((image) => !isArtwork(image))
      /*
       * Ranked, not just filtered, and in this order of priority:
       *
       *   1. does the picture actually show what was asked for
       *   2. does it survive a crop into a vertical frame
       *
       * The first used to be missing entirely - the pool was sorted by aspect
       * alone, so a squarish photograph of the wrong thing outranked a wide one
       * of the right thing. That is exactly backwards: a badly cropped hippo is
       * still a hippo, while a perfectly framed impala is not.
       *
       * Licence deliberately plays no part. Every result here is already
       * publishable and the credit is drawn either way, so preferring CC0 would
       * reorder the pool for no gain.
       */
      .map((image, index) => ({ image, index, score: relevance(image, options.query) }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          cropCost(a.image) - cropCost(b.image) ||
          // The API's own relevance order, preserved as the final tie-break.
          a.index - b.index,
      )
      .map((entry) => entry.image)
      .slice(0, options.limit);
  }

  private async fetchJson(url: string, query: string): Promise<OpenverseResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          // Identifying the client is politeness on a free anonymous API, and
          // it is what a rate-limit complaint would be traced back to.
          'User-Agent': 'fact-shorts-generator (+https://github.com/)',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      });
    } catch (err) {
      throw new PipelineError(
        ERROR_CODES.PROJECT_NOT_FOUND,
        'process-images',
        `Could not reach Openverse to search for "${query}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
        undefined,
        { cause: err },
      );
    } finally {
      clearTimeout(timer);
    }

    // 429 is reported specially because it is the failure this design was built
    // around, and because the remedy is waiting rather than fixing anything.
    if (response.status === 429) {
      throw new PipelineError(
        ERROR_CODES.PROJECT_NOT_FOUND,
        'process-images',
        'Openverse rate limit reached (anonymous access allows 20 searches a minute and 200 a ' +
          'day). Wait, or set OPENVERSE_TOKEN in .env to raise it.',
      );
    }

    if (!response.ok) {
      // The body carries Openverse's own explanation, and for a 401 it is the
      // only thing that distinguishes "page_size too large for an anonymous
      // request" from "your token is wrong". Worth the extra read: without it
      // this failure looks like a credentials problem on a client that
      // deliberately has no credentials.
      const detail = await response.text().catch(() => '');
      throw new PipelineError(
        ERROR_CODES.PROJECT_NOT_FOUND,
        'process-images',
        `Openverse returned ${response.status} searching for "${query}"` +
          `${detail ? `: ${detail.slice(0, 200)}` : '.'}`,
      );
    }

    return (await response.json()) as OpenverseResponse;
  }
}

/**
 * How much of the query the picture's own words account for, 0 to 1.
 *
 * Title and tags together, because they fail in opposite directions: a stock
 * photo called "Hippo water" has almost no title but a dozen useful tags, while
 * a museum scan has a descriptive title and no tags at all. A result whose
 * category the API states as a photograph gets a small bonus - enough to break
 * a tie with an equally-worded result of unknown kind, not enough to promote an
 * irrelevant one.
 */
function relevance(image: StockImage, query: string): number {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1 && !IGNORED_TERMS.has(term));

  if (terms.length === 0) return 0;

  const haystack = `${image.title} ${image.words}`.toLowerCase();
  // Substring rather than whole-word: "hippo" should match a tag reading
  // "hippopotamus", and in this direction a false positive costs nothing.
  const hits = terms.filter((term) => haystack.includes(term)).length;

  /*
   * Untagged results are pushed down rather than dropped.
   *
   * A stock photograph arrives with a dozen tags; an archive scan arrives with
   * none, because nobody tagged a plate from 1823. That is a good signal and a
   * soft one - some genuine photographs on Wikimedia have no tags either, and
   * banning them outright would empty the pool for any subject the stock sites
   * do not cover. A penalty lets a tagless photograph still win when it is the
   * only thing that matches the query.
   */
  const untagged = image.words.trim() === '' ? 0.2 : 0;

  return hits / terms.length + (image.isPhotograph ? 0.15 : 0) - untagged;
}

/** True when the result is a reproduction of an artwork rather than a photo. */
function isArtwork(image: StockImage): boolean {
  if (MARKUP_TITLE.test(image.title)) return true;
  if (PLATE_TITLE.test(image.title)) return true;
  if (image.category === 'illustration' || image.category === 'digitized_artwork') return true;
  return ARTWORK_WORDS.test(`${image.title} ${image.words}`);
}

/** 0 for a photograph that survives a vertical crop, 1 for one that does not. */
function cropCost(image: StockImage): number {
  return image.width / image.height <= COMFORTABLE_ASPECT ? 0 : 1;
}

function toStockImage(result: OpenverseResult): StockImage | null {
  const { id, url, width, height } = result;
  if (!id || !url || !width || !height) return null;

  const license = (result.license ?? '').toLowerCase();
  // The API was asked for these three, but the filter is re-applied here rather
  // than trusted: a licence this code has no rule for must never reach a render.
  if (!LICENSES.includes(license as (typeof LICENSES)[number])) return null;

  return {
    id,
    provider: result.source ?? result.provider ?? 'openverse',
    url,
    // Falls back to the full image so a provider that reports no thumbnail
    // still appears in a review, just more slowly.
    thumbnailUrl: result.thumbnail ?? url,
    width,
    height,
    title: result.title ?? '',
    words: (result.tags ?? [])
      .map((tag) => tag?.name ?? '')
      .filter(Boolean)
      .join(' '),
    category: result.category ?? null,
    isPhotograph: result.category === 'photograph',
    // Percent-encoded names come back from some upstream providers ("Ferdinand%20St%F6hr").
    // Decoding is best-effort: a malformed sequence keeps the raw string rather
    // than throwing away an otherwise usable photograph.
    creator: decodeCreator(result.creator ?? 'Unknown'),
    sourceUrl: result.foreign_landing_url ?? url,
    license,
    licenseUrl: result.license_url ?? licenseUrlFor(license, result.license_version ?? ''),
  };
}

/**
 * Un-escapes a percent-encoded photographer's name.
 *
 * Two passes, because upstream providers do not agree on the encoding.
 * `decodeURIComponent` handles the UTF-8 ones; it *throws* on the rest, and
 * "Ferdinand%20St%F6hr" is the common case - `%F6` is ö in Latin-1, which is
 * not a valid UTF-8 sequence. Falling back byte by byte recovers the name.
 *
 * Worth the twelve lines: this string is drawn in the corner of every frame of
 * the video, and a mangled name is a worse credit than a plain one.
 */
function decodeCreator(creator: string): string {
  if (!creator.includes('%')) return creator;

  try {
    return decodeURIComponent(creator);
  } catch {
    return creator.replace(/%([0-9A-Fa-f]{2})/gu, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  }
}

function licenseUrlFor(license: string, version: string): string {
  if (license === 'pdm') return 'https://creativecommons.org/publicdomain/mark/1.0/';
  if (license === 'cc0') return 'https://creativecommons.org/publicdomain/zero/1.0/';
  return `https://creativecommons.org/licenses/${license}/${version || '4.0'}/`;
}
