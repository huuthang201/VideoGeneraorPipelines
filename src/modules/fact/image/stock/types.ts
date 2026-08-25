/**
 * Where the pictures come from.
 *
 * Nothing in this repository draws or generates an image. Every frame is a
 * photograph somebody else took, found by searching a stock library at render
 * time - which is the whole reason this interface exists rather than a single
 * hard-coded fetch. The rules a source has to satisfy are narrow enough that
 * swapping one in is a real decision:
 *
 * 1. **The licence must allow commercial use and modification.** These videos
 *    are cropped, scaled, panned over and published to a monetised channel.
 *    NonCommercial and NoDerivatives licences are not usable here, and neither
 *    is a Google image search - the fact that a picture is reachable says
 *    nothing about whether it may be republished.
 * 2. **ShareAlike is excluded too**, which is a subtler point. CC BY-SA asks
 *    derivative works to carry the same licence; a video built partly from a
 *    BY-SA photograph arguably has to be BY-SA itself, and that is not a
 *    decision a rendering pipeline should make on a channel's behalf.
 * 3. **The picture has to be big.** A backdrop is cropped to fill a 1080x1920
 *    frame and then pushed in another twenty percent by the camera move, so
 *    anything under about 1600px on its short edge is visibly soft by the end
 *    of the scene.
 * 4. **The provider has to say who took it.** The credit is drawn in the corner
 *    of every scene, so a source that cannot name a creator cannot be used.
 */

/** One usable photograph, as returned by a search. */
export interface StockImage {
  /** Provider-stable id. The cache is keyed on `${provider}-${id}`. */
  id: string;
  provider: string;
  /** Direct URL of the full-size file. */
  url: string;
  /** Small JPEG served by the provider, used only for the review pass. */
  thumbnailUrl: string;
  width: number;
  height: number;
  title: string;
  /**
   * The result's tags, joined - the other half of what it says about itself.
   *
   * Kept as one string rather than an array because everything downstream does
   * substring matching on it, and because it is written into the search cache
   * where an array of forty tags is mostly punctuation.
   */
  words: string;
  /** The provider's own classification: "photograph", "illustration", or null. */
  category: string | null;
  /** Whether that classification says photograph. Used only for ranking. */
  isPhotograph: boolean;
  /** Who took it. Shown on screen and listed in the publishing kit. */
  creator: string;
  /** The page the photograph lives on, for the written credit. */
  sourceUrl: string;
  /** Short licence code, e.g. "cc0", "by", "pdm". */
  license: string;
  licenseUrl: string;
}

export type { ImageCredit } from '../../../../image/credit';
export { creditLine, requiresAttribution } from '../../../../image/credit';

import type { ImageCredit } from '../../../../image/credit';

/**
 * The credit for a search result.
 *
 * `ImageCredit` itself lives in `src/image/credit.ts`, one level up: it is
 * written into the timeline, which is shared by both modules, so it cannot live
 * inside the fact module's image source.
 */
export function creditOf(image: StockImage): ImageCredit {
  return {
    creator: image.creator,
    provider: image.provider,
    license: image.license,
    licenseUrl: image.licenseUrl,
    sourceUrl: image.sourceUrl,
  };
}

/**
 * One candidate offered to the model for review, as a file it can open.
 *
 * The thumbnail rather than the full image, and that is what makes a review
 * pass affordable: Openverse serves a 20-50KB JPEG per result from its own
 * endpoint, and those requests carry no rate-limit headers and do not move the
 * search counter - measured, not assumed. The full file is downloaded only for
 * the handful actually chosen.
 */
export interface ReviewCandidate {
  /** `${provider}-${id}` - what the review returns to identify its choice. */
  key: string;
  /** The query this candidate came back from, for the model's context. */
  query: string;
  title: string;
  /** Filename inside the review directory, e.g. "03-hamster-face.jpg". */
  filename: string;
}

export interface StockSearchOptions {
  query: string;
  /** How many candidates to return. More than the video needs, so scenes differ. */
  limit: number;
  /** Shortest acceptable edge, in pixels. See rule 3 above. */
  minEdge: number;
}

export interface StockImageProvider {
  readonly name: string;
  search(options: StockSearchOptions): Promise<StockImage[]>;
}
