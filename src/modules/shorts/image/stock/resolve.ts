import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import sharp from 'sharp';
import { classifyOrientation, type ProcessedImage } from '../../../../domain/project';
import { ERROR_CODES, PipelineError } from '../../../../domain/errors';
import {
  creditOf,
  type ImageCredit,
  type ReviewCandidate,
  type StockImage,
  type StockImageProvider,
} from './types';

/**
 * Turns the image queries in a storyboard into files on disk.
 *
 * This is the stage that replaced the uploaded backdrop library. The trade it
 * makes is worth stating plainly: the model no longer *looks* at the
 * photographs before choosing them, because there is nothing to look at until
 * after it has written the script. It picks a subject in words, and the search
 * decides what that subject looks like. In exchange nobody has to find, crop
 * and upload pictures before a video can exist, which was the one manual step
 * left in an otherwise automatic pipeline.
 *
 * Three things make that trade survivable, and all three live here:
 *
 * - **A pool per query, not a picture per query.** Each search returns a dozen
 *   candidates, so several scenes sharing a query still get different
 *   photographs, and a video never cuts back and forth between two images.
 * - **Everything is cached on disk, keyed by the query and by the image id.**
 *   A re-render costs no searches and no downloads, which matters because the
 *   free tier of the search API is the binding constraint on the whole system.
 * - **A missing result is never fatal.** A query that finds nothing falls back
 *   to a broader one rather than failing a job that has already paid for a
 *   Claude call.
 */

/** How long a cached search stays usable. */
const SEARCH_CACHE_DAYS = 30;

/**
 * Candidates fetched per query.
 *
 * Twelve, which is more than any one video needs. The surplus is what lets
 * scene four and scene seven share a query and still show different pictures,
 * and it costs nothing: the request is the same price whatever `page_size`
 * says.
 */
const CANDIDATES_PER_QUERY = 12;

/**
 * Shortest edge a photograph may have.
 *
 * A backdrop is cropped to fill 1080x1920 and then pushed in by up to another
 * twenty percent by the camera move, so the frame samples about 1300px of the
 * short edge by the end of a scene. 1600 leaves headroom above that; below it
 * the softness is visible on a phone.
 */
export const MIN_IMAGE_EDGE = 1600;

/**
 * Below this, a query is treated as having failed and is broadened.
 *
 * Six, because scenes share pools: a video is eight or nine scenes across two
 * to four queries, so a pool of six can dress two or three scenes without
 * repeating. Under that the scenes start borrowing from a *different* query,
 * which is where relevance actually breaks - a video about hippos ended on a
 * photograph of an impala because "african savanna sunset" returned one result
 * and the rest of its scenes went looking elsewhere.
 */
const MIN_POOL = 6;

/**
 * How many times a thin query may be shortened before giving up.
 *
 * Each attempt drops the last word - "hippo riverbank africa" becomes "hippo
 * riverbank", then "hippo" - because the last word is usually the qualifier
 * that made the phrase specific enough to match nothing. Two is enough to get
 * from a four-word phrase to a subject noun, and it is bounded because every
 * attempt spends one of the two hundred searches the free tier allows a day.
 */
const MAX_BROADENING = 2;

/**
 * How many candidates the review pass is shown.
 *
 * Enough that every scene has a real choice - a nine-scene video needs nine
 * distinct pictures, so offering nine would be no choice at all - and few
 * enough that the model is reading a contact sheet rather than a catalogue.
 * Twenty thumbnails is about two megabytes and one comfortable prompt.
 */
const MAX_REVIEW_CANDIDATES = 20;

/** Bounded so one slow thumbnail cannot hold up a render. */
const THUMBNAIL_TIMEOUT_MS = 15_000;

/** Longest edge kept after processing. Matches the uploaded-library pipeline. */
const MAX_EDGE = 2160;
const JPEG_QUALITY = 88;

/** Bounded so one enormous original cannot stall a render. */
const DOWNLOAD_TIMEOUT_MS = 45_000;
const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;

export interface SceneImageRequest {
  sceneId: string;
  query: string;
}

export interface ResolvedSceneImage {
  sceneId: string;
  image: ProcessedImage;
  credit: ImageCredit;
}

export interface ResolveInput {
  scenes: readonly SceneImageRequest[];
  provider: StockImageProvider;
  /** Root of the shared stock cache, e.g. runtime/stock. */
  cacheDir: string;
  /** Used when a scene's own query finds nothing usable. */
  fallbackQuery: string;
  onProgress?: (message: string) => void;
  /** A candidate that had to be skipped. Never fatal on its own. */
  onWarn?: (message: string) => void;
  /**
   * An optional pass that looks at the candidates and says which belongs to
   * which scene.
   *
   * This is the one judgement the automatic path cannot make. Everything above
   * it - the source allowlist, the artwork filter, the relevance ranking -
   * reasons about *words*: the query, the title, the tags. None of it has seen
   * the picture. A photograph tagged "mouse" is a photograph tagged "mouse"
   * whether it shows a field mouse or a computer accessory.
   *
   * Given thumbnails on disk and the scenes they are for, this returns
   * `sceneId -> candidate key`. It is allowed to fail, return nothing, or cover
   * only some scenes: whatever it leaves unassigned falls through to the
   * automatic tiers, so a review that goes wrong costs relevance rather than
   * the whole job.
   */
  review?: (input: {
    /** Directory holding the thumbnails, one file per candidate. */
    directory: string;
    candidates: readonly ReviewCandidate[];
  }) => Promise<ReadonlyMap<string, string>>;
}

export interface ResolveResult {
  images: ResolvedSceneImage[];
  /** How many searches actually hit the network, for the rate-limit budget. */
  searchesPerformed: number;
  /** How many scenes the review pass placed, of those it was offered. */
  reviewed: number;
}

export async function resolveSceneImages(input: ResolveInput): Promise<ResolveResult> {
  const { scenes, provider, cacheDir } = input;
  if (scenes.length === 0) {
    throw new PipelineError(
      ERROR_CODES.MINIMUM_IMAGES_NOT_MET,
      'process-images',
      'The storyboard has no scenes, so there is nothing to find pictures for.',
    );
  }

  const pools = new Map<string, StockImage[]>();
  /** Results from a shortened query, ranked behind every exact pool. */
  const widened = new Map<string, StockImage[]>();
  let searchesPerformed = 0;

  const searchOnce = async (query: string): Promise<StockImage[]> => {
    const { images, fromNetwork } = await searchWithCache(provider, cacheDir, query);
    if (fromNetwork) searchesPerformed++;
    input.onProgress?.(
      `"${query}" → ${images.length} candidate(s)${fromNetwork ? '' : ' (cached)'}`,
    );
    return images;
  };

  /*
   * A query, broadened until it finds enough or runs out of words.
   *
   * The results of the shortened attempts are merged rather than replacing the
   * original: the few pictures the specific phrase found are the most relevant
   * ones there are, and they should stay at the front of the pool. What the
   * broader phrase adds is the difference between a scene borrowing from
   * another topic and a scene getting something at least adjacent.
   */
  const poolFor = async (query: string): Promise<StockImage[]> => {
    const cached = pools.get(query);
    if (cached) return cached;

    const exact = await searchOnce(query);
    pools.set(query, exact);

    /*
     * Broadened results are kept in a *separate* pool, and this separation is
     * the whole point of it.
     *
     * They used to be appended to the query's own pool, which quietly made
     * things worse: "pet rodent cage" finds nothing, widens to "pet", and the
     * scene gets a photograph of a dog - beating a perfectly good mouse from a
     * sibling query, because a scene exhausts its own pool before it borrows.
     * Held apart, the widened results sit *behind* the video's other queries,
     * so a scene reaches for something on the wrong subject only once
     * everything on the right one is spoken for.
     */
    const wide: StockImage[] = [];
    const seen = new Set(exact.map(keyOf));

    let words = query.split(/\s+/u).filter(Boolean);
    for (
      let attempt = 0;
      attempt < MAX_BROADENING && exact.length + wide.length < MIN_POOL;
      attempt++
    ) {
      if (words.length <= 1) break;
      words = words.slice(0, -1);

      input.onWarn?.(
        `"${query}" found only ${exact.length + wide.length} usable photograph(s); widening to ` +
          `"${words.join(' ')}" as a second choice.`,
      );

      for (const image of await searchOnce(words.join(' '))) {
        if (seen.has(keyOf(image))) continue;
        seen.add(keyOf(image));
        wide.push(image);
      }
    }

    widened.set(query, wide);
    return exact;
  };

  // Queries in first-seen order, so the same storyboard always issues the same
  // searches in the same order - which is what makes the cache deterministic.
  const queries = [...new Set(scenes.map((s) => s.query))];
  for (const query of queries) await poolFor(query);

  for (const query of queries) {
    if ((pools.get(query) ?? []).length === 0 && (widened.get(query) ?? []).length === 0) {
      input.onWarn?.(
        `"${query}" found no usable photograph even after widening. Scenes using it will be ` +
          "shot against one of the video's other queries instead.",
      );
    }
  }

  /*
   * Warned about as a whole, not just per empty query.
   *
   * A pool of one is not a failure - the scene still gets a picture, borrowed
   * from another query - but it is the reason a video about hippos ends on a
   * photograph of an antelope, and that is invisible from the log otherwise.
   * The remedy is a broader query, so the message says which ones were thin.
   */
  const available = queries.reduce((total, q) => total + (pools.get(q) ?? []).length, 0);
  if (available < scenes.length) {
    const thin = queries
      .map((q) => `"${q}" (${(pools.get(q) ?? []).length})`)
      .join(', ');
    input.onWarn?.(
      `Only ${available} photograph(s) found for ${scenes.length} scenes - ${thin}. Some scenes ` +
        'will borrow from another query and may not match what they are describing. Broader, ' +
        'more common search phrases fix this.',
    );
  }

  /*
   * The generic fallback is fetched lazily, and usually never.
   *
   * It costs a search against a daily budget of two hundred, and a video whose
   * every query worked has no use for it. This *was* eager and guarded by a
   * condition that read `queries.includes(fallbackQuery)` - which is true
   * essentially never, so the fallback pool was always empty and a query that
   * found nothing failed the job outright rather than falling back at all.
   */
  let genericPool: StockImage[] | null = null;
  const genericFallback = async (): Promise<StockImage[]> => {
    if (genericPool === null) genericPool = await poolFor(input.fallbackQuery);
    return genericPool;
  };

  /*
   * The review pass, if one was supplied.
   *
   * Run before any assignment so its answers take precedence, and built from
   * the exact pools only: a widened pool exists precisely because the query
   * failed, and offering the model a photograph of a dog to choose from is
   * inviting the mistake this pass exists to prevent.
   */
  const used = new Set<string>();
  const chosenByScene = new Map<string, StockImage>();
  let reviewed = 0;

  if (input.review) {
    const offered = candidatesForReview(queries, pools);
    if (offered.length > 0) {
      try {
        const directory = path.join(cacheDir, 'review');
        const candidates = await writeThumbnails(offered, directory);

        const verdict = await input.review({ directory, candidates });
        const byKey = new Map(offered.map(({ image }) => [keyOf(image), image]));

        for (const [sceneId, key] of verdict) {
          const image = byKey.get(key);
          // A key the review invented, or one it used twice, is ignored rather
          // than argued with - the scene simply falls through to the tiers.
          if (!image || used.has(keyOf(image))) continue;
          used.add(keyOf(image));
          chosenByScene.set(sceneId, image);
          reviewed++;
        }

        input.onProgress?.(
          `review placed ${reviewed}/${scenes.length} scene(s) from ${candidates.length} candidates`,
        );
      } catch (err) {
        // Losing the review costs relevance, not the video.
        input.onWarn?.(
          `Image review failed, falling back to automatic assignment: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const images: ResolvedSceneImage[] = [];

  /*
   * Choosing and downloading are interleaved rather than done in two passes,
   * because a candidate can still fail after it has been chosen: a link rots, a
   * server refuses, a file turns out not to be an image. Two passes meant one
   * bad URL failed a job that had already paid for a Claude call and a round of
   * speech. Here it costs one more candidate from the same pool.
   */
  /** One candidate, downloaded and normalised, or null if it would not open. */
  const materialiseOne = async (
    sceneId: string,
    candidate: StockImage,
  ): Promise<ResolvedSceneImage | null> => {
    try {
      return {
        sceneId,
        image: await materialise(candidate, cacheDir, input.onProgress),
        credit: creditOf(candidate),
      };
    } catch (err) {
      input.onWarn?.(
        `Skipped a photograph for "${sceneId}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  };

  const tryPool = async (
    sceneId: string,
    pool: readonly StockImage[],
  ): Promise<ResolvedSceneImage | null> => {
    for (const candidate of pool) {
      if (used.has(keyOf(candidate))) continue;

      // Marked used before the attempt, not after: a candidate that fails must
      // not be offered to the next scene either.
      used.add(keyOf(candidate));

      try {
        return {
          sceneId,
          image: await materialise(candidate, cacheDir, input.onProgress),
          credit: creditOf(candidate),
        };
      } catch (err) {
        input.onWarn?.(
          `Skipped a photograph for "${sceneId}": ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return null;
  };

  for (const scene of scenes) {
    /*
     * Four tiers, each one further from what the scene asked for.
     *
     * The order is the whole quality argument. A scene about a mouse should
     * take: its own query's photographs; then a *sibling* query's, which are
     * still about mice; then its own query broadened, which is about pets in
     * general; and only then the generic fallback. Any other order trades an
     * on-subject picture for a better-matching search string, which is how a
     * video about rodents ends on a photograph of a dog.
     */
    // What the review chose, if it chose anything for this scene. `tryPool` is
    // reused so a chosen candidate that fails to download still falls through.
    const picked = chosenByScene.get(scene.sceneId);
    let resolved = picked ? await materialiseOne(scene.sceneId, picked) : null;

    if (!resolved) resolved = await tryPool(scene.sceneId, pools.get(scene.query) ?? []);

    if (!resolved) {
      for (const query of queries) {
        if (query === scene.query) continue;
        resolved = await tryPool(scene.sceneId, pools.get(query) ?? []);
        if (resolved) break;
      }
    }

    if (!resolved) {
      // Widened pools, own query first, then the siblings'.
      const order = [scene.query, ...queries.filter((q) => q !== scene.query)];
      for (const query of order) {
        resolved = await tryPool(scene.sceneId, widened.get(query) ?? []);
        if (resolved) break;
      }
    }

    if (!resolved) resolved = await tryPool(scene.sceneId, await genericFallback());

    if (!resolved) {
      throw new PipelineError(
        ERROR_CODES.MINIMUM_IMAGES_NOT_MET,
        'process-images',
        `No usable photograph for scene "${scene.sceneId}". Tried every query in this ` +
          `storyboard (${queries.join(', ')}) and the fallback "${input.fallbackQuery}", and ` +
          `every result was rejected: under ${MIN_IMAGE_EDGE}px, carrying a licence this tool ` +
          'will not publish, or failing to download.',
      );
    }

    images.push(resolved);
  }

  return { images, searchesPerformed, reviewed };
}

const keyOf = (image: StockImage): string => `${image.provider}-${image.id}`;

/** Safe on every filesystem, and stable for the same image across runs. */
function fileKeyOf(image: StockImage): string {
  const raw = keyOf(image).replace(/[^a-zA-Z0-9._-]/gu, '-');
  // Long ids from museum collections would otherwise exceed the 255-byte
  // filename limit; the hash suffix keeps distinct images distinct after the cut.
  return raw.length <= 80 ? raw : `${raw.slice(0, 60)}-${sha1(raw).slice(0, 12)}`;
}

interface CachedSearch {
  query: string;
  fetchedAt: string;
  results: StockImage[];
}

/**
 * A search, answered from disk when possible.
 *
 * The cache is the reason this tool can render a video an hour on an API that
 * allows two hundred searches a day: a re-render, a `--force` rebuild, or a
 * second video on the same subject all cost nothing. Entries expire after a
 * month so a stale pool does not pin a channel to the same dozen photographs
 * forever.
 */
async function searchWithCache(
  provider: StockImageProvider,
  cacheDir: string,
  query: string,
): Promise<{ images: StockImage[]; fromNetwork: boolean }> {
  const cachePath = path.join(cacheDir, 'searches', `${sha1(`${provider.name}:${query}`)}.json`);

  const cached = await readJson<CachedSearch>(cachePath);
  if (cached && !isExpired(cached.fetchedAt) && cached.results.length > 0) {
    return { images: cached.results, fromNetwork: false };
  }

  const images = await provider.search({
    query,
    limit: CANDIDATES_PER_QUERY,
    minEdge: MIN_IMAGE_EDGE,
  });

  // An empty result is cached too, briefly, only by *not* being written: a
  // query that found nothing should be retried on the next run rather than
  // remembered as empty for a month.
  if (images.length > 0) {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(
      cachePath,
      `${JSON.stringify({ query, fetchedAt: new Date().toISOString(), results: images }, null, 2)}\n`,
      'utf8',
    );
  }

  return { images, fromNetwork: true };
}

interface CachedImageMeta {
  width: number;
  height: number;
}

/**
 * Downloads and normalises one photograph, or reuses the copy already on disk.
 *
 * The Sharp settings deliberately match what the uploaded-library pipeline used
 * before it: 2160px on the long edge, JPEG at 88, EXIF rotation applied and
 * cleared. `withoutEnlargement` matters more here than it did there - a search
 * result is whatever size its photographer uploaded, and upscaling a small one
 * to look like the others would only make it blurrier.
 */
async function materialise(
  image: StockImage,
  cacheDir: string,
  onProgress?: (message: string) => void,
): Promise<ProcessedImage> {
  const key = fileKeyOf(image);
  const imagePath = path.join(cacheDir, 'images', `${key}.jpg`);
  const metaPath = path.join(cacheDir, 'meta', `${key}.json`);

  const meta = await readJson<CachedImageMeta>(metaPath);
  if (meta && (await exists(imagePath))) {
    return toProcessedImage(key, imagePath, meta.width, meta.height);
  }

  onProgress?.(`downloading ${image.width}x${image.height} from ${image.provider}`);
  const bytes = await download(image.url);

  await mkdir(path.dirname(imagePath), { recursive: true });
  await mkdir(path.dirname(metaPath), { recursive: true });

  let info;
  try {
    info = await sharp(bytes, { failOn: 'error' })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      // Flattened before encoding, so a PNG with transparency does not come out
      // of JPEG with black holes in it.
      .flatten({ background: '#000000' })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(imagePath);
  } catch (err) {
    throw new PipelineError(
      ERROR_CODES.IMAGE_PROCESSING_FAILED,
      'process-images',
      `Could not process the photograph from ${image.sourceUrl}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      undefined,
      { cause: err },
    );
  }

  await writeFile(
    metaPath,
    `${JSON.stringify({ width: info.width, height: info.height }, null, 2)}\n`,
    'utf8',
  );

  return toProcessedImage(key, imagePath, info.width, info.height);
}

function toProcessedImage(
  key: string,
  imagePath: string,
  width: number,
  height: number,
): ProcessedImage {
  return {
    filename: `${key}.jpg`,
    path: imagePath,
    kind: 'environment',
    width,
    height,
    aspectRatio: width / height,
    orientation: classifyOrientation(width, height),
  };
}

async function download(url: string, timeoutMs = DOWNLOAD_TIMEOUT_MS): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'fact-shorts-generator (+https://github.com/)' },
    });

    if (!response.ok) {
      throw new PipelineError(
        ERROR_CODES.IMAGE_PROCESSING_FAILED,
        'process-images',
        `Downloading ${url} returned ${response.status}.`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new PipelineError(
        ERROR_CODES.IMAGE_PROCESSING_FAILED,
        'process-images',
        `${url} is ${(buffer.byteLength / 1e6).toFixed(0)}MB, past the ` +
          `${MAX_DOWNLOAD_BYTES / 1e6}MB ceiling.`,
      );
    }
    return buffer;
  } catch (err) {
    if (err instanceof PipelineError) throw err;
    throw new PipelineError(
      ERROR_CODES.IMAGE_PROCESSING_FAILED,
      'process-images',
      `Could not download ${url}: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
  }
}

function isExpired(fetchedAt: string): boolean {
  const at = new Date(fetchedAt).getTime();
  if (Number.isNaN(at)) return true;
  return Date.now() - at > SEARCH_CACHE_DAYS * 24 * 3600 * 1000;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  const raw = await readFile(filePath, 'utf8').catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  );
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

/**
 * The candidates worth showing a reviewer, taken round-robin across queries.
 *
 * Round-robin rather than query-by-query so a single prolific query cannot fill
 * the whole sheet: a video with four subjects should have all four represented
 * in what the model sees, or the review can only confirm a choice that was
 * already made for it.
 */
function candidatesForReview(
  queries: readonly string[],
  pools: ReadonlyMap<string, StockImage[]>,
): { image: StockImage; query: string }[] {
  const out: { image: StockImage; query: string }[] = [];
  const seen = new Set<string>();

  for (let rank = 0; out.length < MAX_REVIEW_CANDIDATES; rank++) {
    let addedThisRound = false;

    for (const query of queries) {
      const image = (pools.get(query) ?? [])[rank];
      if (!image || seen.has(keyOf(image))) continue;

      seen.add(keyOf(image));
      out.push({ image, query });
      addedThisRound = true;
      if (out.length >= MAX_REVIEW_CANDIDATES) break;
    }

    if (!addedThisRound) break;
  }

  return out;
}

/**
 * Writes each candidate's thumbnail into one directory for the reviewer to open.
 *
 * Filenames carry the index and a slug of the title, because the model reads
 * them as much as it reads the pictures: "07-hamster-running-wheel.jpg" is a
 * usable handle in a reply, while a uuid is something to mistype. The index
 * keeps them unique when two candidates share a title, which on stock sites is
 * common - "Hippo water" appears four times in one search.
 *
 * The directory is emptied first. It is scratch space shared by every project,
 * and yesterday's thumbnails in today's review would be candidates nobody
 * searched for.
 */
async function writeThumbnails(
  candidates: readonly { image: StockImage; query: string }[],
  directory: string,
): Promise<ReviewCandidate[]> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  const written: ReviewCandidate[] = [];

  for (const [index, { image, query }] of candidates.entries()) {
    const slug =
      image.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 40) || 'untitled';
    const filename = `${String(index + 1).padStart(2, '0')}-${slug}.jpg`;

    try {
      const bytes = await download(image.thumbnailUrl, THUMBNAIL_TIMEOUT_MS);
      await writeFile(path.join(directory, filename), bytes);
    } catch {
      // A thumbnail that will not load is simply not offered. The full image
      // may still be fine, and it stays available to the automatic tiers.
      continue;
    }

    written.push({
      key: `${image.provider}-${image.id}`,
      query,
      title: image.title,
      filename,
    });
  }

  return written;
}
