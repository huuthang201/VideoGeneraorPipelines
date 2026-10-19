import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

/**
 * The cover image, composed rather than grabbed.
 *
 * A still lifted out of the video is what this pipeline shipped for two years,
 * and on a Short it is defensible - the Shorts feed plays the video instead of
 * showing a cover, so the picture barely matters. On an ordinary video it is
 * the single thing that decides whether anybody clicks, and a frame of a
 * mountain with a subtitle across it decides "no".
 *
 * So this draws one: the frame, darkened where the words go, and two lines of
 * type big enough to survive being shown at two hundred pixels wide in a search
 * result. Everything here follows from that last constraint, which is the one
 * people forget - YouTube's own player shows a cover at 1280 wide exactly once,
 * on the watch page of somebody who has already clicked.
 */

/** YouTube's recommended cover size. Anything else is scaled by them, badly. */
const WIDTH = 1280;
const HEIGHT = 720;

/**
 * Where the type starts and how much room it has.
 *
 * The right margin is the part that was missing on the first attempt: the
 * headline was wrapped on a character count and then set at a fixed size, and
 * "CẢ CỬA KHẨU BIẾN MẤT" - exactly at the twenty-character limit - ran off the
 * edge of the image. A character count cannot bound a pixel width, so the size
 * is now solved for the width instead.
 */
const MARGIN_LEFT = 100;
const MARGIN_RIGHT = 72;

/**
 * Longest a headline line may be before it stops being readable small.
 *
 * This is now about legibility rather than about fitting: at a search result's
 * scale a line of thirty characters is a grey smear, and the viewer reads the
 * title text underneath instead - which they were going to read anyway, so the
 * cover has told them nothing.
 */
const MAX_LINE_CHARS = 20;

/** The size the probe render uses; the real size is scaled from what it measures. */
const PROBE_SIZE = 100;

/**
 * How wide a line actually is, by drawing it and looking.
 *
 * The obvious approach - characters times a per-character ratio - was tried
 * first and shipped a cover with the headline running off the right edge.
 * There is no ratio that works: a heavy sans varies by more than a third
 * between "I" and "M", and Vietnamese adds tone marks that widen some glyphs
 * and not others. A cover is rendered once per video, so paying for one extra
 * rasterise to get an exact answer is not a trade worth thinking about.
 *
 * The probe draws the line on a transparent canvas at a known size and trims to
 * the ink; the width that comes back scales linearly with the font size.
 */
async function measureWidth(line: string, weight: number): Promise<number> {
  const svg =
    `<svg width="4000" height="${PROBE_SIZE * 2}" xmlns="http://www.w3.org/2000/svg">` +
    `<text x="0" y="${PROBE_SIZE}" font-family="${FONT_STACK}" font-size="${PROBE_SIZE}" ` +
    `font-weight="${weight}" letter-spacing="-1.5" fill="#000">${escapeXml(line)}</text></svg>`;

  const trimmed = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true });
  return trimmed.info.width;
}

const FONT_STACK = 'Helvetica Neue, Helvetica, Arial, sans-serif';

/** SVG is XML: an ampersand in a photographer's name would end the document. */
function escapeXml(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

/**
 * Breaks the headline into at most two lines, at a space.
 *
 * Two, not three. A third line means either smaller type or less room for the
 * picture, and a cover that needs three lines is a cover whose text is a
 * sentence - which is the failure this whole file exists to avoid.
 */
function wrap(text: string): string[] {
  const words = text.trim().split(/\s+/u);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > MAX_LINE_CHARS && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  if (lines.length <= 2) return lines;
  // Everything past the second line is folded back into it: too long is better
  // than silently dropped, and it is visible the moment anybody looks.
  return [lines[0]!, lines.slice(1).join(' ')];
}

export interface ThumbnailInput {
  /** A still from the video, at any size; it is cropped to 16:9. */
  sourcePath: string;
  /** Three to six words. Longer is folded onto two lines and gets smaller. */
  text: string;
  /** Optional second line, set smaller and in the accent colour. */
  kicker?: string;
  /** The channel's accent, for the rule and the kicker. */
  accent?: string;
  outputPath: string;
}

/**
 * Draws the cover and writes it as JPEG.
 *
 * The scrim is a gradient rather than a flat panel, and that is the difference
 * between a cover and a caption: a rectangle behind the words reads as a
 * template, while a gradient reads as part of the photograph. It is heavy at
 * the bottom because that is where the words are, and it stops well short of
 * the top so the picture still has a picture in it.
 */
export async function composeThumbnail(input: ThumbnailInput): Promise<void> {
  const lines = wrap(input.text);
  const accent = input.accent ?? '#ffe066';

  /*
   * Solved for the width rather than chosen from the line count.
   *
   * The longest line decides: whatever size makes it end inside the right
   * margin, capped so a two-word headline does not become absurd and floored so
   * a long one stays readable at search-result scale. A headline that would
   * need less than the floor is one `wrap` should have broken differently, and
   * running slightly wide is visible where silently shrinking to nothing is
   * not.
   */
  const available = WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const widest = Math.max(...(await Promise.all(lines.map((line) => measureWidth(line, 800)))));
  const size = Math.max(
    64,
    Math.min(lines.length > 1 ? 96 : 120, Math.floor((PROBE_SIZE * available) / widest)),
  );
  const lineHeight = size * 1.08;
  const kicker = input.kicker?.trim();

  const blockHeight = lines.length * lineHeight + (kicker ? 62 : 0);
  const top = HEIGHT - 62 - blockHeight;

  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.28" stop-color="#05070d" stop-opacity="0"/>
      <stop offset="0.62" stop-color="#05070d" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#05070d" stop-opacity="0.9"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#scrim)"/>
  <rect x="${MARGIN_LEFT - 36}" y="${top - 8}" width="10" height="${blockHeight - 12}" fill="${accent}"/>
  ${lines
    .map(
      (line, i) =>
        `<text x="${MARGIN_LEFT}" y="${top + (i + 1) * lineHeight - lineHeight * 0.22}" ` +
        `font-family="${FONT_STACK}" font-size="${size}" ` +
        `font-weight="800" fill="#ffffff" letter-spacing="-1.5" ` +
        // A soft shadow rather than an outline: an outline at this weight
        // closes up the counters in Vietnamese diacritics and the tone marks
        // turn into blobs at search-result size.
        `style="paint-order:stroke;stroke:#05070d;stroke-width:10;stroke-opacity:0.45">` +
        `${escapeXml(line)}</text>`,
    )
    .join('\n  ')}
  ${
    kicker
      ? `<text x="${MARGIN_LEFT}" y="${HEIGHT - 66}" font-family="${FONT_STACK}" ` +
        `font-size="46" font-weight="700" fill="${accent}" ` +
        `style="paint-order:stroke;stroke:#05070d;stroke-width:8;stroke-opacity:0.5">` +
        `${escapeXml(kicker)}</text>`
      : ''
  }
</svg>`;

  // Read into memory first: the pipeline draws the cover over the very frame it
  // replaces, and Sharp refuses to write a file it is still reading - which
  // failed every cover, quietly, into the fallback of the bare frame.
  await sharp(await readFile(input.sourcePath))
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' })
    // `attention` rather than a centre crop: these frames are 16:9 already, so
    // it changes nothing here - but a portrait still would otherwise be cropped
    // through the middle of whatever the picture is of.
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    // 88 keeps a photographic cover under YouTube's two megabyte limit with
    // room to spare, and the artefacts are invisible at this size.
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(input.outputPath);
}
