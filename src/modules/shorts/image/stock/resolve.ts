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
import { mustPreserveOriginal } from '../../../../image/credit';

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
 *
 * Raised from twenty when the source allowlist was widened. Twenty was sized
 * against a pool that was returning four or five photographs a query; three
 * queries now return around thirty-six between them, and a cap that throws away
 * a third of them before the only stage with eyes has looked is a cap working
 * against its own purpose. Thirty thumbnails is roughly three megabytes.
 */
const MAX_REVIEW_CANDIDATES = 30;

/**
 * Most scenes in a row one borrowed picture may end up covering. Two is about
 * twenty seconds on a long video; past that a still stops reading as "the same
 * place" and starts reading as a frozen video - worse still for a paper's
 * photograph, which may not move at all.
 */
const MAX_RUN = 2;

/**
 * Most times one picture may appear in a whole video.
 *
 * The second look was told not to pile one picture onto many scenes, and put
 * the same whirlpool at a drain on seven scenes in two minutes anyway - every
 * one of them a sentence about that drain, and the video still looked broken.
 * Three is a cap in code, because prose did not hold.
 */
const MAX_USES = 3;

/** On a second-look sheet: pinned pictures nobody has used yet, at most. */
const REFILL_FRESH_PINNED = 8;
/** On a second-look sheet: unused pictures found for these scenes, at most. */
const REFILL_FRESH_RESEARCHED = 8;
/** On a second-look sheet: pictures already in the video, nearest first, at most. */
const REFILL_ALREADY_PLACED = 10;

/** On a first-look sheet: room kept for pinned pictures, then for researched ones. */
const SHEET_PINNED = 12;
const SHEET_RESEARCHED = 12;

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
  /**
   * Exact sources found for this scene alone - a Commons category or file
   * that shows the very place or thing the sentence names. Searched as given,
   * never widened, and put on this scene's review sheet ahead of stock.
   */
  extraQueries?: readonly string[];
}

export interface ResolvedSceneImage {
  sceneId: string;
  image: ProcessedImage;
  credit: ImageCredit;
}

export interface ResolveInput {
  scenes: readonly SceneImageRequest[];
  provider: StockImageProvider;
  /** The video frame's aspect, so ranking prefers photographs that fit it. */
  frameAspect: number;
  /**
   * Queries whose pictures every review batch is shown, not only the scenes
   * that named them.
   *
   * For photographs of the event itself - a news article's pictures, used with
   * permission. Those are right for *any* scene that is telling the event, and
   * a scene only gets offered what its own query found; left to that rule, the
   * paper's photographs would reach only the scenes that happened to name the
   * article, which is almost none, because the script was written before
   * anybody knew what the article contained.
   */
  pinnedQueries?: readonly string[];
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
    /** The scenes this batch is about. See REVIEW_BATCH_SCENES. */
    sceneIds: readonly string[];
    /** A second look, on a sheet where pictures already in the video may be used again. */
    reuse?: boolean;
  }) => Promise<ReadonlyMap<string, string>>;
  /**
   * What becomes of a scene the review looked at and left empty.
   *
   * `tiers`, the default and what a short does: it takes the first unused
   * candidate from its own query, then its siblings', then the widened ones.
   * On nine scenes that is rarely reached. On a seventeen-minute video it was
   * reached thirty-five times, and it is blind by construction - the pictures
   * it hands out are the ones the review had just looked at and declined, or
   * whatever a widened query dragged in. That put a galaxy in a video about a
   * flooded street, because "whirlpool drain water" widened to "whirlpool".
   *
   * `reuse`: those scenes go back to the review once, on a sheet that also
   * holds the pictures already in the video, and anything still empty after
   * that borrows a neighbouring scene's picture. A correct picture seen twice
   * beats a wrong one seen once. See `candidatesForRefill` and `borrowNearby`.
   */
  blankScenes?: 'tiers' | 'reuse';
  /**
   * Whether the storyboard's own queries are searched at all.
   *
   * False for a video that may show nothing but its event: every picture then
   * comes from `pinnedQueries` (the event's own photographs) or a scene's
   * `extraQueries` (another event that scene names), and a scene nothing
   * fits is given the event photograph used least so far - never stock, and
   * never the generic fallback. The owner's rule for a video about something
   * real was one hundred per cent: a picture of the event the scene is about.
   */
  storyboardQueries?: boolean;
  /** Most scenes one picture may appear on. Defaults to MAX_USES. */
  maxUses?: number;
}

export interface ResolveResult {
  images: ResolvedSceneImage[];
  /** How many searches actually hit the network, for the rate-limit budget. */
  searchesPerformed: number;
  /** How many scenes the review pass placed, of those it was offered. */
  reviewed: number;
  /** Queries the search could not answer at all. Empty on a healthy run. */
  failedSearches: string[];
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
  /** Queries the search could not answer at all, for the closing summary. */
  const failedSearches: string[] = [];
  const attempted = new Set<string>();
  /**
   * Stops asking once the search is clearly down.
   *
   * Each unreachable query costs three attempts at forty-five seconds plus
   * backoff - over two minutes - and a long video asks eighteen of them, then
   * widens the ones that came back empty. Measured on a morning when Openverse
   * answered nothing at all: the run spent **fifty minutes** discovering, one
   * query at a time, a fact the third query already knew.
   *
   * So after this many consecutive failures the network is given up on for the
   * rest of the run. Nothing is lost by it - every later query would have
   * failed too - and what is gained is that the cache fallback and the
   * `MINIMUM_IMAGES_NOT_MET` verdict arrive in two minutes instead of an hour.
   * The counter resets on any success, so a service that is merely flapping is
   * not written off.
   */
  const GIVE_UP_AFTER = 3;
  let consecutiveFailures = 0;
  let searchDown = false;

  /*
   * A search that cannot be reached is treated as a search that found nothing.
   *
   * This is the difference between a bad morning at Openverse costing a video
   * some variety and costing it everything. The machinery below already handles
   * "this query found nothing": the scene falls through to the storyboard's
   * other queries, then to the broadened form, then to the generic fallback -
   * and only if *all* of that comes up empty does `MINIMUM_IMAGES_NOT_MET`
   * stop the run. So the honest failure boundary is per video, not per query.
   *
   * Measured on the morning this was written: twelve requests to Openverse
   * returned eight 502s and four timeouts, zero successes. Retrying harder
   * cannot help with that; carrying on with what the other queries and the
   * cache already hold can.
   *
   * Only transport-shaped failures are swallowed. A 4xx means this code asked
   * wrongly and would ask wrongly again on every query, so it still stops the
   * run rather than quietly producing a video of fallback photographs.
   */
  const searchOnce = async (query: string): Promise<StockImage[]> => {
    attempted.add(query);

    if (searchDown) {
      // Still worth asking the cache: an expired pool is served from disk and
      // costs nothing, and it is the only thing that can rescue this run.
      const cached = await cachedOnly(cacheDir, provider, query, input.frameAspect);
      if (cached.length > 0) return cached;
      failedSearches.push(query);
      return [];
    }

    let result: { images: StockImage[]; fromNetwork: boolean };
    try {
      result = await searchWithCache(provider, cacheDir, query, input.frameAspect, (q, err) =>
        input.onWarn?.(
          `Không gọi được kho ảnh cho "${q}" (${message(err)}). Dùng lại kết quả đã lưu từ ` +
            'lần trước, dù đã quá hạn làm mới.',
        ),
      );
    } catch (err) {
      const transient =
        err instanceof PipelineError &&
        (err.code === ERROR_CODES.STOCK_SEARCH_UNREACHABLE ||
          err.code === ERROR_CODES.RATE_LIMITED);
      if (!transient) throw err;

      failedSearches.push(query);
      // Being told to slow down is not the service being down. Counting it
      // here let three throttled Commons lookups in a row switch off every
      // search left in the run, Openverse included.
      if (err instanceof PipelineError && err.code === ERROR_CODES.STOCK_SEARCH_UNREACHABLE) {
        consecutiveFailures++;
      }

      if (consecutiveFailures >= GIVE_UP_AFTER && !searchDown) {
        searchDown = true;
        input.onWarn?.(
          `${GIVE_UP_AFTER} truy vấn liên tiếp không gọi được kho ảnh - coi như kho ảnh đang ` +
            'chết và thôi gọi mạng cho phần còn lại của video. Những truy vấn sau chỉ dùng ' +
            'kết quả đã lưu. Chạy lại khi kho ảnh hoạt động.',
        );
      } else {
        input.onWarn?.(
          `Bỏ qua truy vấn "${query}": ${message(err)}. Những cảnh dùng nó sẽ mượn ảnh của ` +
            'truy vấn khác.',
        );
      }
      return [];
    }

    consecutiveFailures = 0;
    const { images, fromNetwork } = result;
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
  const searchStoryboard = input.storyboardQueries !== false;
  const maxUses = input.maxUses ?? MAX_USES;
  const queries = searchStoryboard ? [...new Set(scenes.map((s) => s.query))] : [];
  const pinned = [...new Set(input.pinnedQueries ?? [])].filter((q) => !queries.includes(q));
  for (const query of [...queries, ...pinned]) await poolFor(query);
  if (pinned.length > 0) {
    const found = pinned.reduce((n, q) => n + (pools.get(q)?.length ?? 0), 0);
    input.onProgress?.(`${found} ảnh từ ${pinned.length} nguồn được phép, đưa vào mọi nhóm duyệt ảnh`);
  }

  // Found for particular scenes: exact page names, searched as given. Not
  // through `poolFor`, whose widening would turn "Category:Đông Ngạc" into
  // a search for whatever else mentions the words.
  const researched = [...new Set(scenes.flatMap((s) => s.extraQueries ?? []))].filter(
    (q) => !queries.includes(q) && !pinned.includes(q),
  );
  for (const query of researched) {
    if (!pools.has(query)) pools.set(query, await searchOnce(query));
  }
  if (researched.length > 0) {
    const answered = researched.filter((q) => (pools.get(q) ?? []).length > 0);
    const pictures = answered.reduce((n, q) => n + (pools.get(q)?.length ?? 0), 0);
    input.onProgress?.(
      `${answered.length}/${researched.length} nguồn ảnh thật tìm riêng cho từng cảnh có ảnh ` +
        `dùng được (${pictures} ảnh)`,
    );
  }
  /** A batch's own researched sources, in scene order, the empty ones left out. */
  const researchedFor = (batch: readonly SceneImageRequest[]) =>
    [...new Set(batch.flatMap((s) => s.extraQueries ?? []))].filter(
      (q) => (pools.get(q) ?? []).length > 0,
    );

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
  if (searchStoryboard && available < scenes.length) {
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
    /*
     * Reviewed in batches of scenes, each shown only its own subjects.
     *
     * The first version was one call: thirty candidates, gathered round-robin
     * across every query in the video, offered for every scene at once. On a
     * short that is the whole video and it works - nine scenes, three subjects,
     * and the sheet is genuinely the choice. On a seventeen-minute video it
     * placed **nothing at all**: ninety-one scenes cannot be assigned from
     * thirty pictures, and a sheet mixing all sixteen subjects is mostly
     * pictures that are wrong for whichever scene you are looking at.
     *
     * So the unit is a handful of consecutive scenes, and the sheet is drawn
     * from *the queries those scenes asked for* rather than from the whole
     * video. That is what makes each choice a real one: a batch about honey is
     * shown honey, not honey plus the Egyptian tomb from minute eleven.
     *
     * Sequential rather than parallel, and images already taken are withheld
     * from later batches, so two scenes twelve minutes apart cannot land on the
     * same photograph.
     */
    const batches = chunk(scenes, REVIEW_BATCH_SCENES);
    let failures = 0;

    for (const [index, batch] of batches.entries()) {
      const batchQueries = [...new Set(batch.map((scene) => scene.query))].filter((q) =>
        queries.includes(q),
      );
      // Three kinds of picture, each with room of its own on the sheet: the
      // event's photographs, the real ones found for these scenes, and stock.
      // One round-robin across all of them gave every query one or two slots,
      // so twenty researched queries squeezed a paper's twelve photographs
      // down to one.
      const offered = candidatesForSheet(
        [
          { queries: pinned, quota: SHEET_PINNED },
          { queries: researchedFor(batch), quota: SHEET_RESEARCHED },
          { queries: batchQueries, quota: MAX_REVIEW_CANDIDATES },
        ],
        pools,
        used,
      );
      if (offered.length === 0) continue;

      try {
        const directory = path.join(cacheDir, 'review', String(index + 1));
        const candidates = await writeThumbnails(offered, directory);

        const verdict = await input.review({
          directory,
          candidates,
          sceneIds: batch.map((scene) => scene.sceneId),
        });
        const byKey = new Map(offered.map(({ image }) => [keyOf(image), image]));
        let placed = 0;
        let press = 0;

        for (const [sceneId, key] of verdict) {
          const image = byKey.get(key);
          // A key the review invented, or one it used twice, is ignored rather
          // than argued with - the scene simply falls through to the tiers.
          if (!image || used.has(keyOf(image))) continue;
          used.add(keyOf(image));
          chosenByScene.set(sceneId, image);
          reviewed++;
          placed++;
          if (mustPreserveOriginal(image.license)) press++;
        }

        // Per batch, because on a long video this stage runs for half an hour
        // and a single summary at the end is thirty minutes of silence.
        input.onProgress?.(
          `duyệt ảnh nhóm ${index + 1}/${batches.length}: xếp ${placed}/${batch.length} cảnh` +
            (pinned.length > 0 ? `, ${press} ảnh báo` : ''),
        );
      } catch (err) {
        // Losing one batch costs relevance on a handful of scenes, not the
        // video, and not the batches after it.
        failures++;
        input.onWarn?.(
          `Chọn ảnh bằng AI hỏng ở nhóm ${index + 1}/${batches.length}: ` +
            `${message(err)}. Những cảnh đó dùng cách gán tự động.`,
        );
      }
    }

    input.onProgress?.(
      `review placed ${reviewed}/${scenes.length} scene(s) across ${batches.length} batch(es)` +
        `${failures > 0 ? `, ${failures} failed` : ''}`,
    );
  }

  if (input.review && input.blankScenes === 'reuse') {
    const blank = scenes.filter((scene) => !chosenByScene.has(scene.sceneId));
    const position = new Map(scenes.map((scene, i) => [scene.sceneId, i]));
    const batches = chunk(blank, REVIEW_BATCH_SCENES);
    let refilled = 0;
    let reusedTotal = 0;

    for (const [index, batch] of batches.entries()) {
      const batchIds = new Set(batch.map((scene) => scene.sceneId));
      const uses = new Map<string, number>();
      for (const image of chosenByScene.values()) {
        uses.set(keyOf(image), (uses.get(keyOf(image)) ?? 0) + 1);
      }
      const offered = candidatesForRefill({
        maxUses,
        // An event-only sheet holds nothing but the event's photographs, so it
        // may hold all of them: the best one for this sentence may be on a
        // scene ten minutes away.
        placedLimit: searchStoryboard ? REFILL_ALREADY_PLACED : MAX_REVIEW_CANDIDATES,
        uses,
        near: batch.map((scene) => position.get(scene.sceneId) ?? 0),
        scenes,
        chosenByScene,
        pinned,
        researched: researchedFor(batch),
        batchQueries: [...new Set(batch.map((scene) => scene.query))].filter((q) =>
          queries.includes(q),
        ),
        pools,
        used,
      });
      if (offered.length === 0) continue;

      try {
        const directory = path.join(cacheDir, 'review', `lai-${index + 1}`);
        const candidates = await writeThumbnails(offered, directory);

        const verdict = await input.review({
          directory,
          candidates,
          sceneIds: batch.map((scene) => scene.sceneId),
          reuse: true,
        });
        const byKey = new Map(offered.map(({ image }) => [keyOf(image), image]));
        let placed = 0;
        let reused = 0;

        for (const [sceneId, key] of verdict) {
          const image = byKey.get(key);
          if (!image || !batchIds.has(sceneId) || chosenByScene.has(sceneId)) continue;
          // The sheet already leaves out worn pictures, but one batch can hand a
          // fresh one to five of its scenes.
          const count = uses.get(keyOf(image)) ?? 0;
          if (count >= maxUses) continue;
          uses.set(keyOf(image), count + 1);
          if (used.has(keyOf(image))) reused++;
          used.add(keyOf(image));
          chosenByScene.set(sceneId, image);
          placed++;
        }

        refilled += placed;
        reusedTotal += reused;
        input.onProgress?.(
          `vá cảnh trống nhóm ${index + 1}/${batches.length}: xếp ${placed}/${batch.length} cảnh` +
            `, ${reused} ảnh dùng lại`,
        );
      } catch (err) {
        input.onWarn?.(
          `Lượt vá cảnh trống hỏng ở nhóm ${index + 1}/${batches.length}: ` +
            `${message(err)}. Những cảnh đó dùng cách gán tự động.`,
        );
      }
    }

    reviewed += refilled;
    if (blank.length > 0) {
      input.onProgress?.(
        `second look placed ${refilled}/${blank.length} empty scene(s), ${reusedTotal} by reusing ` +
          'a picture already in the video',
      );
    }
  }

  const images: ResolvedSceneImage[] = [];
  /** Scenes that showed a neighbour's picture, and scenes nobody looked at. */
  const borrowed: string[] = [];
  const blind: string[] = [];

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

  /*
   * A picture for a scene the review left empty, taken from the scenes around
   * it rather than from a pool nobody looked at.
   *
   * Every candidate here is a picture the review placed on another scene, so a
   * person-shaped judgement has been made about it once. Pinned photographs of
   * the event come first, then the nearest - the previous scene's picture
   * simply stays up, or the next one's arrives a scene early. No picture
   * may cover more than MAX_RUN scenes in a row, counting the scene after this
   * one: the first attempt only limited how long the previous picture was
   * held, and the scene after the limit went back to the blind tiers - which
   * is how the galaxy came back.
   */
  const fileOf = (image: StockImage) => `${fileKeyOf(image)}.jpg`;
  const borrowNearby = async (
    index: number,
    mode: { pressOnly?: boolean } = {},
  ): Promise<ResolvedSceneImage | null> => {
    const sceneId = scenes[index]!.sceneId;
    const pressOnly = mode.pressOnly ?? false;
    const shown = images.map((entry) => entry.image.filename);
    const runOf = (file: string) => {
      let n = 0;
      for (let k = shown.length - 1; k >= 0 && shown[k] === file; k--) n++;
      return n;
    };
    // How many scenes straight after this one the review already gave `file`:
    // borrowing it here joins that run as well as the one behind.
    const runAhead = (file: string) => {
      let n = 0;
      for (let k = index + 1; k < scenes.length; k++) {
        const picked = chosenByScene.get(scenes[k]!.sceneId);
        if (!picked || fileOf(picked) !== file) break;
        n++;
      }
      return n;
    };
    const fits = (file: string) => runOf(file) + 1 + runAhead(file) <= MAX_RUN;

    // Uses across the whole video: what is already on screen before this
    // scene, and what the review has placed after it.
    const ahead = scenes
      .slice(index + 1)
      .map((s) => chosenByScene.get(s.sceneId))
      .filter((image): image is StockImage => Boolean(image))
      .map(fileOf);
    const worn = (file: string) =>
      shown.filter((f) => f === file).length + ahead.filter((f) => f === file).length >= maxUses;

    const previous = images[images.length - 1];
    const nearby = scenes
      .map((s, j) => ({ j, image: chosenByScene.get(s.sceneId) }))
      .filter((e): e is { j: number; image: StockImage } => Boolean(e.image) && e.j !== index);

    const options: {
      file: string;
      at: number;
      /** A pinned photograph of the event itself, rather than stock. */
      own: boolean;
      take: () => Promise<ResolvedSceneImage | null>;
    }[] = [
      ...(previous
        ? [
            {
              file: previous.image.filename,
              at: index - 1,
              own: Boolean(previous.credit && mustPreserveOriginal(previous.credit.license)),
              take: async () => ({ ...previous, sceneId }),
            },
          ]
        : []),
      ...nearby.map(({ j, image }) => ({
        file: fileOf(image),
        at: j,
        own: mustPreserveOriginal(image.license),
        take: () => materialiseOne(sceneId, image),
      })),
    ];

    /*
     * The event's own photographs before stock, then nearest first, the
     * following scene before the preceding one at equal distance.
     *
     * Nearest alone borrowed whatever stock happened to sit next door - a
     * tractor under a sentence about the student's death, because the scene
     * before it was about farmland. A photograph of the flood itself is never
     * wrong for a sentence in a video about that flood; the stock picture next
     * door was chosen for a different sentence.
     */
    options.sort(
      (a, b) =>
        Number(b.own) - Number(a.own) ||
        Math.abs(a.at - index) - Math.abs(b.at - index) ||
        b.at - a.at,
    );
    // A video that may show only its event borrows only the event's own photographs.
    const allowed = pressOnly ? options.filter((option) => option.own) : options;

    // Pictures not yet worn out first; a worn one only when every neighbour is.
    for (const allowWorn of [false, true]) {
      const tried = new Set<string>();
      for (const option of allowed) {
        if (tried.has(option.file) || !fits(option.file)) continue;
        if (!allowWorn && worn(option.file)) continue;
        tried.add(option.file);
        const got = await option.take();
        if (got) return got;
      }
    }
    return null;
  };

  /*
   * For a video that may show only its event: the event photograph used least
   * so far. Reached only when the review and borrowing both came up empty - a
   * review that failed outright, say - and it is still a picture of the event,
   * which is the one promise such a video makes.
   */
  const pressPictures = pinned.flatMap((q) => pools.get(q) ?? []);
  const unreviewed: string[] = [];
  const leastUsed = async (
    sceneId: string,
    pictures: readonly StockImage[],
  ): Promise<ResolvedSceneImage | null> => {
    const shown = images.map((entry) => entry.image.filename);
    const usesOf = (image: StockImage) => shown.filter((f) => f === fileOf(image)).length;
    const ranked = [...pictures].sort((a, b) => usesOf(a) - usesOf(b));
    for (const image of ranked) {
      const got = await materialiseOne(sceneId, image);
      if (got) return got;
    }
    return null;
  };

  for (const [index, scene] of scenes.entries()) {
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

    /*
     * A video that may show only its event never borrows across events.
     *
     * A scene with sources of its own is about another event - the 2008 flood
     * it is being compared with - and gets that event's least-used picture. Any
     * other scene is about this one and borrows only this event's photographs.
     * Borrowing freely let a sentence about the night of the sixteenth take a
     * 2008 picture from the scene next door, and the other way round.
     */
    if (!resolved && !searchStoryboard) {
      const itsOwnEvent = (scene.extraQueries ?? []).flatMap((q) => pools.get(q) ?? []);
      if (itsOwnEvent.length > 0) {
        resolved = await leastUsed(scene.sceneId, itsOwnEvent);
        if (resolved) unreviewed.push(scene.sceneId);
      } else {
        resolved = chosenByScene.size > 0 ? await borrowNearby(index, { pressOnly: true }) : null;
        if (resolved) borrowed.push(scene.sceneId);
        if (!resolved) {
          resolved = await leastUsed(scene.sceneId, pressPictures);
          if (resolved) unreviewed.push(scene.sceneId);
        }
      }
    }

    // On a long video, an empty scene borrows from its neighbours as long as
    // the review chose anything at all. The tiers below are for a video the
    // review never saw - it is off, or every batch failed.
    if (!resolved && input.blankScenes === 'reuse' && chosenByScene.size > 0) {
      resolved = await borrowNearby(index);
      if (resolved) borrowed.push(scene.sceneId);
    }
    if (!resolved && input.blankScenes === 'reuse' && searchStoryboard) blind.push(scene.sceneId);

    for (const query of scene.extraQueries ?? []) {
      if (resolved) break;
      resolved = await tryPool(scene.sceneId, pools.get(query) ?? []);
    }
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

    // Stock, and only for a video allowed to show it.
    if (!resolved && searchStoryboard) {
      resolved = await tryPool(scene.sceneId, await genericFallback());
    }

    if (!resolved) {
      /*
       * Two different failures, and saying the wrong one costs an afternoon.
       *
       * This message used to blame resolution and licences unconditionally. On
       * the day the picture search was down for everyone, it told a person that
       * every jellyfish photograph on the internet was too small or wrongly
       * licensed - so they went looking at thresholds instead of at the search.
       * Nothing had been rejected, because nothing had been fetched.
       */
      throw new PipelineError(
        ERROR_CODES.MINIMUM_IMAGES_NOT_MET,
        'process-images',
        !searchStoryboard
          ? `Không có ảnh sự kiện nào dùng được cho cảnh "${scene.sceneId}": ` +
            `${pinned.length} bài báo được phép không cho ra ảnh nào. Video này chỉ được dùng ` +
            'ảnh của chính sự kiện, nên không lấy ảnh kho bù vào - kiểm tra lại các link trong ' +
            'phần ý tưởng.'
          : failedSearches.length > 0
          ? `Không có ảnh cho cảnh "${scene.sceneId}", vì không gọi được kho ảnh: ` +
            `${failedSearches.length}/${attempted.size} truy vấn thất bại ` +
            `(${failedSearches.slice(0, 4).join(', ')}). Đây là sự cố của kho ảnh, không phải ` +
            'của kịch bản - thử lại sau, hoặc đặt OPENVERSE_TOKEN trong .env.'
          : `No usable photograph for scene "${scene.sceneId}". Tried every query in this ` +
            `storyboard (${queries.join(', ')}) and the fallback "${input.fallbackQuery}", and ` +
            `every result was rejected: under ${MIN_IMAGE_EDGE}px, carrying a licence this tool ` +
            'will not publish, or failing to download.',
      );
    }

    images.push(resolved);
  }

  /*
   * Said once at the end, not only as a warning per query.
   *
   * A run that quietly degraded is a run whose pictures somebody will wonder
   * about a week later. Naming the queries that never got an answer is what
   * turns "these images look off" into "Openverse was down when this was made".
   */
  if (borrowed.length > 0) {
    input.onProgress?.(
      `${borrowed.length} cảnh không có ảnh riêng hợp nội dung, mượn ảnh của cảnh bên cạnh: ` +
        borrowed.join(', '),
    );
  }
  if (unreviewed.length > 0) {
    input.onWarn?.(
      `${unreviewed.length} cảnh không qua bước duyệt, nhận ảnh sự kiện dùng ít nhất: ` +
        `${unreviewed.join(', ')}. Vẫn là ảnh của sự kiện, nhưng nên xem lại.`,
    );
  }
  if (blind.length > 0) {
    input.onWarn?.(
      `${blind.length} cảnh gán ảnh tự động, không qua bước duyệt: ${blind.join(', ')}. ` +
        'Nên xem lại những cảnh này trước khi đăng.',
    );
  }

  if (failedSearches.length > 0) {
    input.onWarn?.(
      `${failedSearches.length}/${attempted.size} truy vấn không gọi được kho ảnh: ` +
        `${failedSearches.join(', ')}. Video vẫn dựng, nhưng những cảnh đó dùng ảnh của chủ ` +
        'đề khác - chạy lại khi kho ảnh hoạt động sẽ cho hình sát nội dung hơn.',
    );
  }

  return { images, searchesPerformed, reviewed, failedSearches };
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
  frameAspect: number,
  onStale?: (query: string, err: unknown) => void,
): Promise<{ images: StockImage[]; fromNetwork: boolean }> {
  /*
   * The frame's aspect is part of the key, not just of the request.
   *
   * What a search returns here is already *ranked and sliced* - `cropCost` has
   * pushed the photographs that survive this frame to the top and the rest off
   * the end. So a pool built for a 9:16 short is the wrong pool for a 16:9
   * episode even though the query is identical, and a shared key would hand one
   * to the other for a month.
   *
   * Rounded, so floating-point noise between 1920/1080 and 16/9 does not split
   * the cache in two.
   */
  const key = `${provider.name}:${query}:${frameAspect.toFixed(3)}`;
  const cachePath = path.join(cacheDir, 'searches', `${sha1(key)}.json`);

  const cached = await readJson<CachedSearch>(cachePath);
  if (cached && !isExpired(cached.fetchedAt) && cached.results.length > 0) {
    return { images: cached.results, fromNetwork: false };
  }

  let images: StockImage[];
  try {
    images = await provider.search({
      query,
      limit: CANDIDATES_PER_QUERY,
      minEdge: MIN_IMAGE_EDGE,
      frameAspect,
    });
  } catch (err) {
    /*
     * A stale pool is worth more than no pool.
     *
     * Expiry exists so a channel is not pinned to the same dozen photographs
     * for ever - it is a freshness preference, not a correctness rule. When the
     * search cannot be reached at all, a month-old pool of the right pictures
     * beats the alternative, which is this scene borrowing a photograph from a
     * different subject entirely.
     */
    if (cached && cached.results.length > 0) {
      onStale?.(query, err);
      return { images: cached.results, fromNetwork: false };
    }
    throw err;
  }

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

/**
 * How many scenes one review call covers.
 *
 * Twelve. Small enough that the candidate sheet can be about *these* scenes
 * rather than about the whole video, and that the model is choosing among
 * pictures of one or two subjects; large enough that a seventeen-minute video
 * costs eight calls rather than ninety.
 */
const REVIEW_BATCH_SCENES = 12;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The cached pool for a query, fresh or stale, without touching the network. */
async function cachedOnly(
  cacheDir: string,
  provider: StockImageProvider,
  query: string,
  frameAspect: number,
): Promise<StockImage[]> {
  const key = `${provider.name}:${query}:${frameAspect.toFixed(3)}`;
  const cached = await readJson<CachedSearch>(path.join(cacheDir, 'searches', `${sha1(key)}.json`));
  return cached?.results ?? [];
}

/** The readable half of an error, for a warning a person will actually read. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  /** Already spent on an earlier batch, so no two scenes share a photograph. */
  taken: ReadonlySet<string> = new Set(),
): { image: StockImage; query: string }[] {
  const out: { image: StockImage; query: string }[] = [];
  const seen = new Set<string>(taken);

  // Runs until the longest pool is exhausted, not until a rank adds nothing.
  // The old stop - "nothing new at this rank" - fired as soon as every pool's
  // first few pictures had been used by earlier batches, however many unused
  // ones sat behind them: on a sheet of one paper's twelve photographs, the
  // fourth batch of a long video was shown none at all.
  const longest = Math.max(0, ...queries.map((q) => (pools.get(q) ?? []).length));

  for (let rank = 0; rank < longest && out.length < MAX_REVIEW_CANDIDATES; rank++) {
    for (const query of queries) {
      const image = (pools.get(query) ?? [])[rank];
      if (!image || seen.has(keyOf(image))) continue;

      seen.add(keyOf(image));
      out.push({ image, query });
      if (out.length >= MAX_REVIEW_CANDIDATES) break;
    }
  }

  return out;
}

/**
 * A review sheet built from groups of queries, each guaranteed some room.
 *
 * Each group gets up to its quota first, round-robin within itself; whatever
 * room is left then goes to the groups in order. So a batch with no
 * researched pictures hands their room to stock rather than leaving it empty.
 */
function candidatesForSheet(
  groups: readonly { queries: readonly string[]; quota: number }[],
  pools: ReadonlyMap<string, StockImage[]>,
  taken: ReadonlySet<string>,
): { image: StockImage; query: string }[] {
  const out: { image: StockImage; query: string }[] = [];
  const seen = new Set(taken);

  const take = (queries: readonly string[], limit: number) => {
    let left = limit;
    for (const entry of candidatesForReview(queries, pools, seen)) {
      if (out.length >= MAX_REVIEW_CANDIDATES || left <= 0) break;
      seen.add(keyOf(entry.image));
      out.push(entry);
      left--;
    }
  };

  for (const group of groups) take(group.queries, group.quota);
  for (const group of groups) take(group.queries, MAX_REVIEW_CANDIDATES);
  return out;
}

/**
 * The sheet for a second look at scenes the first one left empty.
 *
 * Three kinds of picture, in this order. Pinned ones nobody has used yet,
 * because a person arranged for those. Then the pictures already in the video,
 * nearest scene first, each marked with the scene showing it: the first pass
 * withheld them so that no two scenes would share a picture, and that rule is
 * precisely what left these scenes empty - a section about why the drains
 * failed has nothing new to show, but the flooded street from a minute earlier
 * is exactly right. Then whatever this batch's own queries still hold.
 */
function candidatesForRefill(input: {
  /** Most scenes one picture may appear on. */
  maxUses: number;
  /** Pictures already in the video to offer, at most. */
  placedLimit: number;
  /** Sources found for these scenes in particular. */
  researched: readonly string[];
  /** How many scenes each picture is already on, by key. */
  uses: ReadonlyMap<string, number>;
  /** Positions of the batch's scenes in the video, for "nearest". */
  near: readonly number[];
  scenes: readonly SceneImageRequest[];
  chosenByScene: ReadonlyMap<string, StockImage>;
  pinned: readonly string[];
  batchQueries: readonly string[];
  pools: ReadonlyMap<string, StockImage[]>;
  used: ReadonlySet<string>;
}): { image: StockImage; query: string; usedBy?: string }[] {
  const out: { image: StockImage; query: string; usedBy?: string }[] = [];
  const seen = new Set<string>();

  for (const entry of candidatesForReview(input.pinned, input.pools, input.used).slice(
    0,
    REFILL_FRESH_PINNED,
  )) {
    seen.add(keyOf(entry.image));
    out.push(entry);
  }
  for (const entry of candidatesForReview(
    input.researched,
    input.pools,
    new Set([...input.used, ...seen]),
  ).slice(0, REFILL_FRESH_RESEARCHED)) {
    seen.add(keyOf(entry.image));
    out.push(entry);
  }

  const distance = (i: number) => Math.min(...input.near.map((n) => Math.abs(n - i)));
  const placed = input.scenes
    .map((scene, i) => ({ scene, i, image: input.chosenByScene.get(scene.sceneId) }))
    .filter((entry): entry is { scene: SceneImageRequest; i: number; image: StockImage } =>
      Boolean(entry.image),
    )
    .sort((a, b) => distance(a.i) - distance(b.i));

  // Labelled with the query the picture was *found* by, not the scene's: a
  // press photograph must still read as `article:…` on the sheet, or the review
  // cannot tell it from stock and rejects it for the paper's logo.
  const foundBy = new Map<string, string>();
  for (const [query, pool] of input.pools) {
    for (const image of pool) if (!foundBy.has(keyOf(image))) foundBy.set(keyOf(image), query);
  }

  let taken = 0;
  for (const { scene, image } of placed) {
    if (taken >= input.placedLimit || out.length >= MAX_REVIEW_CANDIDATES) break;
    if (seen.has(keyOf(image)) || (input.uses.get(keyOf(image)) ?? 0) >= input.maxUses) continue;
    seen.add(keyOf(image));
    out.push({ image, query: foundBy.get(keyOf(image)) ?? scene.query, usedBy: scene.sceneId });
    taken++;
  }

  const withheld = new Set([...input.used, ...seen]);
  for (const entry of candidatesForReview(input.batchQueries, input.pools, withheld)) {
    if (out.length >= MAX_REVIEW_CANDIDATES) break;
    out.push(entry);
  }

  return out;
}

/**
 * A thumbnail, from Openverse's proxy or from the picture itself.
 *
 * The proxy is tried first because it is small and free. But it is a proxy: it
 * fetches from the upstream provider on demand, and when that upstream refuses
 * it, Openverse answers **424 Failed Dependency** - which is what it does for
 * *every* Wikimedia image. Twelve of twelve, measured.
 *
 * That failure used to be silent and it was expensive. The candidate was
 * dropped from the review sheet, so a video about reindeer went to the only
 * stage with eyes carrying ten photographs of snow and icebergs and not one
 * reindeer - the review could not pick a relevant picture because it was never
 * shown one. The pictures were fine all along; only the proxy was broken, and
 * the full-size download of the very same image succeeds.
 *
 * So the fallback fetches the original and downscales it here. It costs
 * bandwidth on at most thirty images, once, and it is the difference between a
 * review that chooses and a review that rubber-stamps.
 */
async function thumbnailBytes(image: StockImage): Promise<Buffer> {
  // Always through Sharp, even when the thumbnail came: a news photograph has
  // no thumbnail endpoint, so its "thumbnail" is the two-thousand-pixel
  // original, and thirty of those make a review sheet the reviewer has to wade
  // through rather than look at.
  const shrink = (bytes: Buffer) =>
    sharp(bytes)
      .resize(REVIEW_THUMBNAIL_EDGE, REVIEW_THUMBNAIL_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();

  try {
    return await shrink(await download(image.thumbnailUrl, THUMBNAIL_TIMEOUT_MS));
  } catch {
    return shrink(await download(image.url, THUMBNAIL_TIMEOUT_MS));
  }
}

/** Long edge of a review thumbnail. Big enough to tell a skull from an animal. */
const REVIEW_THUMBNAIL_EDGE = 480;

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
  candidates: readonly { image: StockImage; query: string; usedBy?: string }[],
  directory: string,
): Promise<ReviewCandidate[]> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  const written: ReviewCandidate[] = [];

  for (const [index, { image, query, usedBy }] of candidates.entries()) {
    const slug =
      image.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 40) || 'untitled';
    const filename = `${String(index + 1).padStart(2, '0')}-${slug}.jpg`;

    try {
      const bytes = await thumbnailBytes(image);
      await writeFile(path.join(directory, filename), bytes);
    } catch {
      // A candidate that will not produce a picture at all is simply not
      // offered. It stays available to the automatic tiers.
      continue;
    }

    written.push({
      key: `${image.provider}-${image.id}`,
      query,
      title: image.title,
      filename,
      ...(usedBy ? { usedBy } : {}),
    });
  }

  return written;
}
