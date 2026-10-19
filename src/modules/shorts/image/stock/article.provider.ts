import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { StockImage, StockImageProvider, StockSearchOptions } from './types';
import { PERMISSION_LICENCE } from '../../../../image/credit';
import { ERROR_CODES, PipelineError } from '../../../../domain/errors';

/**
 * The photographs inside a news article, for a video whose owner has the
 * paper's permission to use them.
 *
 * ## When this runs at all
 *
 * Only when a project declares it - `sourceImagesPermitted` on the brief - and
 * that gate is the design, not caution bolted on. A news photograph belongs to
 * the paper; every page this was written against says so in its footer ("Báo
 * điện tử Tuổi Trẻ giữ bản quyền nội dung trên website này"). Reading such a
 * page for facts is research. Putting its photographs in a video is only
 * legitimate because somebody asked the paper and was told yes, and that is a
 * claim about one project's sources - never a default for every link anyone
 * pastes.
 *
 * ## What it returns, and what it deliberately does not
 *
 * The **original** file, not the thumbnail the page shows. Vietnamese news CDNs
 * serve every photograph through a resize segment - `/thumb_w/1460/` - and
 * removing it returns the file as uploaded: measured on Tuổi Trẻ, 2000x1500
 * against 1460x1095. "Keep their photograph as it is" starts with not
 * re-encoding a downscale of it.
 *
 * Only photographs from the article body, and preferably from its `<figure>`s,
 * which is where these CMSs put the paper's own pictures with their captions.
 * The rest of a news page is thumbnails of *other* stories, and a video about a
 * flood in Đông Ngạc must not borrow the photograph from a story about a
 * traffic accident in Hải Phòng because it happened to sit in the sidebar.
 *
 * Videos embedded in the article are skipped. Those are separate works, served
 * as streams rather than files, and the permission given was for photographs.
 */

/** The query prefix that routes a URL here. See `RoutedStockProvider`. */
export const ARTICLE_PREFIX = 'article:';

export const isArticleQuery = (query: string) =>
  query.trim().toLowerCase().startsWith(ARTICLE_PREFIX);

/**
 * A paper's name as its readers write it, by domain.
 *
 * Because `og:site_name` is not that: Tuổi Trẻ calls itself "TUOI TRE ONLINE",
 * Tiền Phong "Báo điện tử Tiền Phong", and the credit drawn in the corner of the
 * frame is the paper's name, not its marketing. Anything not listed falls back
 * to the site's own name, then to the domain.
 */
const OUTLETS: Record<string, string> = {
  'tuoitre.vn': 'Tuổi Trẻ',
  'tienphong.vn': 'Tiền Phong',
  'thanhnien.vn': 'Thanh Niên',
  'nhandan.vn': 'Nhân Dân',
  'suckhoedoisong.vn': 'Sức Khỏe & Đời Sống',
  'vnexpress.net': 'VnExpress',
  'dantri.com.vn': 'Dân Trí',
  'vietnamnet.vn': 'VietNamNet',
  'laodong.vn': 'Lao Động',
  'nld.com.vn': 'Người Lao Động',
  'zingnews.vn': 'Znews',
  'znews.vn': 'Znews',
  'vov.vn': 'VOV',
  'vtv.vn': 'VTV',
  'baotintuc.vn': 'Báo Tin tức',
  'qdnd.vn': 'Quân đội Nhân dân',
  'cand.com.vn': 'Công an Nhân dân',
};

/**
 * Where the article body starts, across the CMS families these papers run on.
 *
 * Two families cover every page measured: `detail-content afcbc-body` (Tuổi Trẻ,
 * Thanh Niên, Sức Khỏe & Đời Sống) and `article__body ... cms-body` (Tiền Phong,
 * Nhân Dân). The rest are the obvious names, for papers not yet seen.
 */
const BODY_MARKERS = [
  'detail-content',
  'article__body',
  'cms-body',
  'detail__content',
  'article-body',
  'article-content',
  'content-detail',
  'fck_detail',
  'singular-content',
];

/**
 * Where the article body ends: the first block that is about other stories.
 *
 * Found by name rather than by walking the DOM, because this is a regex over
 * HTML rather than a parser, and the one thing that matters is not reading past
 * the article into the related-stories rail below it.
 */
const END_MARKERS = [
  'detail-tab',
  'detail__related',
  'box-related',
  'related-news',
  'relate-news',
  'article__related',
  'box-tag',
  'detail-tag',
  'tags-wrapper',
  'box-comment',
  'comment-wrapper',
  '</article>',
];

/** Largest body worth scanning, in case no end marker is found. */
const MAX_BODY_BYTES = 250_000;

/**
 * Shortest edge a news photograph may have.
 *
 * Far below the stock library's 1600, and deliberately: a permitted photograph
 * is shown *whole* - letterboxed, never cropped, never zoomed - so the frame
 * only ever scales it down or up to fit, and a 1200-pixel news photo in a
 * 1920x1080 frame looks like what it is. What this floor removes is the icons,
 * avatars and sidebar thumbnails that survive the body filter.
 */
const MIN_EDGE = 480;

/**
 * Most photographs taken from one article.
 *
 * Not the resolver's per-query `limit`, which is sized for a stock search where
 * twelve is a generous surplus of interchangeable results. An article is the
 * opposite: somebody pointed at it, its pictures are the event itself, and the
 * thirteenth is as wanted as the first. This only guards against a page that
 * turns out to be a gallery of hundreds.
 */
const MAX_PER_ARTICLE = 40;

/**
 * The lazy-loading attributes these pages use, best first.
 *
 * `src` is last and skipped when it is a data URI, because on half these papers
 * it is a one-pixel transparent GIF and the real address is somewhere else:
 * Tiền Phong keeps the full-size file in `data-large-src`, Nhân Dân in
 * `data-src`.
 */
const IMAGE_ATTRIBUTES = [
  'data-large-src',
  'data-original',
  'data-src',
  'data-lazy-src',
  'data-srcset',
  'srcset',
  'src',
];

const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124 Safari/537.36';

interface Candidate {
  url: string;
  caption: string;
  inFigure: boolean;
}

export class ArticleImageProvider implements StockImageProvider {
  readonly name = 'article';

  async search(options: StockSearchOptions): Promise<StockImage[]> {
    const pageUrl = options.query.trim().slice(ARTICLE_PREFIX.length).trim();
    if (!pageUrl) return [];

    const html = await this.fetchText(pageUrl);
    const outlet = outletOf(pageUrl, html);
    const candidates = candidatesIn(html, pageUrl);

    const images: StockImage[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      // The original first; the page's own resized copy if the original will
      // not come - a CDN that does not honour the stripped path still serves
      // the version the page itself links.
      for (const url of [originalOf(candidate.url), candidate.url]) {
        if (seen.has(url)) break;

        const size = await this.measure(url);
        if (!size) continue;
        seen.add(url);
        seen.add(candidate.url);

        if (Math.min(size.width, size.height) < MIN_EDGE) break;

        const photographer = photographerIn(candidate.caption);
        images.push({
          id: createHash('sha1').update(url).digest('hex').slice(0, 16),
          provider: outlet,
          url,
          thumbnailUrl: url,
          width: size.width,
          height: size.height,
          title: candidate.caption || `Ảnh ${outlet}`,
          words: candidate.caption,
          category: 'photograph',
          isPhotograph: true,
          creator: photographer ?? outlet,
          sourceUrl: pageUrl,
          license: PERMISSION_LICENCE,
          // There is no licence page for a private permission; the article is
          // where the photograph was published and where anyone checking the
          // credit would go.
          licenseUrl: pageUrl,
        });
        break;
      }

      if (images.length >= MAX_PER_ARTICLE) break;
    }

    return images;
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'vi,en;q=0.8' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch((err: unknown) => {
      throw new PipelineError(
        ERROR_CODES.STOCK_SEARCH_UNREACHABLE,
        'process-images',
        `Không mở được ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    if (!response.ok) {
      throw new PipelineError(
        response.status >= 500 ? ERROR_CODES.STOCK_SEARCH_UNREACHABLE : ERROR_CODES.IMAGE_PROCESSING_FAILED,
        'process-images',
        `${url} trả về ${response.status}.`,
      );
    }
    return response.text();
  }

  /**
   * The real dimensions of an image, by downloading it.
   *
   * News pages do not state sizes reliably - Tiền Phong does in `data-width`,
   * most do not - and the resolver needs them before it ranks anything. The
   * files are a few hundred kilobytes and there are a dozen per article, so
   * measuring the actual file is cheaper than being wrong about it.
   */
  private async measure(url: string): Promise<{ width: number; height: number } | null> {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Referer: new URL(url).origin },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const type = response.headers.get('content-type') ?? '';
      if (type && !type.startsWith('image/')) return null;

      const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      return meta.width && meta.height ? { width: meta.width, height: meta.height } : null;
    } catch {
      return null;
    }
  }
}

/** The paper's name for the credit. See OUTLETS. */
function outletOf(pageUrl: string, html: string): string {
  const host = new URL(pageUrl).hostname.replace(/^www\./u, '');
  const known = Object.entries(OUTLETS).find(([domain]) => host === domain || host.endsWith(`.${domain}`));
  if (known) return known[1];

  const site = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/iu)?.[1];
  return decodeEntities(site ?? host).trim();
}

/**
 * Where an element carrying one of these classes starts, or -1.
 *
 * Matched as a class attribute on an element, not as a bare string, and that
 * distinction is the whole of the first bug here. The names appear in these
 * pages long before the elements do - in the stylesheet in the head, in the
 * scripts that lazy-load the images - and a search for the text found those
 * instead. Sức Khỏe & Đời Sống's article body came out 717 bytes long, cut off
 * by "detail-tag" written in a CSS rule, with every photograph after it.
 */
function classIndex(html: string, names: readonly string[], from = 0): number {
  const pattern = new RegExp(
    `<[a-z][a-z0-9]*\\b[^>]*\\bclass=["'][^"']*\\b(?:${names.map(escapeRegExp).join('|')})\\b`,
    'giu',
  );
  pattern.lastIndex = from;
  return pattern.exec(html)?.index ?? -1;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** The part of the page that is the article, not the site around it. */
function bodyOf(html: string): string {
  const start = classIndex(html, BODY_MARKERS);
  if (start === -1) return html.slice(0, MAX_BODY_BYTES);

  const classEnd = classIndex(html, END_MARKERS.filter((m) => !m.startsWith('<')), start + 1);
  const articleEnd = html.indexOf('</article>', start);
  const ends = [classEnd, articleEnd].filter((i) => i > start);
  const end = ends.length > 0 ? Math.min(...ends) : start + MAX_BODY_BYTES;
  return html.slice(start, Math.min(end, start + MAX_BODY_BYTES));
}

/**
 * Every photograph in the body, with its caption, figures first.
 *
 * Figures first because that is where these papers put their own pictures, with
 * the caption that names the photographer. A bare `<img>` in the body is kept
 * too - some pages set photographs without a figure - but ranked after, and the
 * size floor removes the inline icons that come with it.
 */
function candidatesIn(page: string, pageUrl: string): Candidate[] {
  /*
   * Scripts and stylesheets out first, because markup inside them is not on
   * the page. Tuổi Trẻ builds a "make us your preferred source on Google" popup
   * from a string of HTML in a script after the article, and its `<img>` - a
   * screenshot of Google's settings - came through as the article's thirteenth
   * photograph.
   */
  const html = page.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/giu, '');
  const fromBody = scan(bodyOf(html), pageUrl);
  if (fromBody.length > 0) return fromBody;

  /*
   * A video article's still.
   *
   * Some of the pages a person pastes are video reports, and their body is a
   * player rather than photographs. The paper still publishes one frame of it
   * as the page's `og:image` - its own picture of the event - and that is worth
   * having; a placeholder GIF, which is what one of these papers serves there,
   * is not, and `bestUrlIn` already refuses GIFs.
   */
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/iu)?.[1];
  const still = og ? bestUrlIn(`<img src="${og}">`, pageUrl) : null;
  if (still) {
    const title = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/iu)?.[1];
    return [{ url: still, caption: plain(title ?? ''), inFigure: true }];
  }

  /*
   * The page's figures, when no body could be found or it held nothing.
   *
   * Figures rather than every image, because a figure is how these CMSs set a
   * picture that belongs to the article - with its caption - while the rails of
   * other stories are plain linked thumbnails. It is the safe way to be wrong
   * about where the body is.
   */
  return scan(html, pageUrl).filter((candidate) => candidate.inFigure);
}

function scan(body: string, pageUrl: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();

  const add = (tag: string, caption: string, inFigure: boolean, index = -1) => {
    if (index >= 0 && isTeaser(body, index, tag, pageUrl)) return;
    const url = bestUrlIn(tag, pageUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, caption, inFigure });
  };

  for (const figure of body.matchAll(/<figure\b[\s\S]*?<\/figure>/giu)) {
    const block = figure[0];
    const caption = plain(block.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/iu)?.[1] ?? '');
    for (const img of block.matchAll(/<img\b[^>]*>/giu)) {
      add(img[0], caption, true, (figure.index ?? 0) + (img.index ?? 0));
    }
  }

  // Blanked rather than removed, so every index below still points at the same
  // place in `body` - the teaser check reads the text before each image.
  const outsideFigures = body.replace(/<figure\b[\s\S]*?<\/figure>/giu, (m) => ' '.repeat(m.length));
  for (const img of outsideFigures.matchAll(/<img\b[^>]*>/giu)) {
    add(img[0], plain(attributeOf(img[0], 'alt') ?? ''), false, img.index ?? -1);
  }

  return out;
}

/** The real address of an image tag, skipping placeholders and videos. */
function bestUrlIn(tag: string, pageUrl: string): string | null {
  for (const attribute of IMAGE_ATTRIBUTES) {
    const raw = attributeOf(tag, attribute);
    if (!raw) continue;

    // A srcset lists several; the last is the largest by convention.
    const value = attribute.endsWith('srcset')
      ? raw.split(',').map((part) => part.trim().split(/\s+/u)[0]!).filter(Boolean).at(-1)!
      : raw;

    const decoded = decodeEntities(value).trim();
    if (!decoded || decoded.startsWith('data:')) continue;

    let url: string;
    try {
      url = new URL(decoded, pageUrl).href;
    } catch {
      continue;
    }

    if (/\/videos?\//iu.test(url) || /\.(mp4|m3u8|webm|gif)(\?|$)/iu.test(url)) return null;
    return url;
  }
  return null;
}

/**
 * One attribute's value, quoted or not.
 *
 * HTML allows `src=https://...` without quotes, and Sức Khỏe & Đời Sống writes
 * every image that way - so a reader that only understood quotes found nine
 * images in its article body and could read none of them.
 */
function attributeOf(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu'));
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

/**
 * Whether an image in the body belongs to a *different* story.
 *
 * News bodies embed teasers for related stories inline - a thumbnail floated
 * beside a paragraph, linking elsewhere - and these are the dangerous ones,
 * because stripping the resize segment turns a 215-pixel teaser into a full
 * photograph that sails through the size floor. Measured on the Sức Khỏe & Đời
 * Sống article about this flood: two of its first three images were teasers,
 * one for a flood in October 2025 and one headed "Tìm thấy thi thể" from August.
 * Put in this video, that is a photograph of a different death presented as
 * this one.
 *
 * Three signals, any one enough: the image sits inside a link to another page,
 * it is marked as an avatar, or it is styled narrow on purpose.
 */
function isTeaser(body: string, index: number, tag: string, pageUrl: string): boolean {
  if (/\bdata-type=["']?avatar/iu.test(tag)) return true;

  const styledWidth = tag.match(/\bstyle=["']?[^>]*?\bwidth\s*:\s*(\d+)px/iu)?.[1];
  if (styledWidth && Number(styledWidth) < 400) return true;

  // Inside an <a> that has not been closed yet, pointing somewhere else.
  const before = body.slice(Math.max(0, index - 1500), index);
  const open = before.lastIndexOf('<a ');
  const close = before.lastIndexOf('</a>');
  if (open > close) {
    const href = attributeOf(before.slice(open), 'href');
    if (href) {
      try {
        const target = new URL(href, pageUrl);
        const here = new URL(pageUrl);
        if (target.pathname !== here.pathname && !/\.(jpe?g|png|webp)$/iu.test(target.pathname)) {
          return true;
        }
      } catch {
        // An href that will not parse is not evidence either way.
      }
    }
  }
  return false;
}

/**
 * The file as uploaded, from the resized copy a page links.
 *
 * These CDNs put the resize instruction in the path - `thumb_w/1460/`,
 * `zoom/1200_630/`, `resize/800x450/` - ahead of the real path. Removing it
 * returns the original. When a CDN does not work that way the stripped address
 * simply fails and the caller falls back to the one the page used.
 */
function originalOf(url: string): string {
  return url.replace(/\/(?:thumb_w|thumb_h|w)\/\d+\//u, '/').replace(/\/(?:zoom|crop|resize)\/\d+[_x]\d+\//u, '/');
}

/**
 * The photographer named in a caption, if any.
 *
 * Vietnamese papers end a caption with "- Ảnh: PHẠM TUẤN" or "(Ảnh: Hữu Thắng)".
 * Names are often set in capitals, which reads as shouting in a corner credit,
 * so an all-capitals name is title-cased.
 */
function photographerIn(caption: string): string | null {
  const raw = caption.match(/Ảnh\s*:\s*([^()\n]+)/iu)?.[1] ?? '';
  // A dot inside a name is an initial - Tuổi Trẻ credits "T.HOÀNG" - so only a
  // dot followed by a space, or the end of the caption, closes the credit.
  // Stopping at the first dot turned that photographer into "T".
  const name = raw.split(/\.(?=\s|$)/u)[0]?.trim();
  if (!name || name.length > 60) return null;

  // "Ảnh: PV" is the paper's own staff, unnamed - PV is "phóng viên", reporter.
  // Crediting a person called "Pv" is wrong twice over; the paper is the credit.
  if (/^(?:pv|phóng viên|nhóm pv|minh họa|minh hoạ|tư liệu|internet|nguồn internet)$/iu.test(name)) {
    return null;
  }

  return name === name.toUpperCase()
    ? name
        .toLowerCase()
        .replace(/(^|[\s.])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase())
    : name;
}

function plain(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/gu, ' ')).replace(/\s+/gu, ' ').trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#0?39;|&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&agrave;/gu, 'à')
    .replace(/&aacute;/gu, 'á')
    .replace(/&acirc;/gu, 'â')
    .replace(/&atilde;/gu, 'ã')
    .replace(/&egrave;/gu, 'è')
    .replace(/&eacute;/gu, 'é')
    .replace(/&ecirc;/gu, 'ê')
    .replace(/&igrave;/gu, 'ì')
    .replace(/&iacute;/gu, 'í')
    .replace(/&ograve;/gu, 'ò')
    .replace(/&oacute;/gu, 'ó')
    .replace(/&ocirc;/gu, 'ô')
    .replace(/&otilde;/gu, 'õ')
    .replace(/&ugrave;/gu, 'ù')
    .replace(/&uacute;/gu, 'ú')
    .replace(/&yacute;/gu, 'ý')
    .replace(/&Agrave;/gu, 'À')
    .replace(/&Aacute;/gu, 'Á');
}
