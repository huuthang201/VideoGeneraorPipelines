/**
 * Photograph attribution.
 *
 * Shared rather than living beside the stock search, because it outlives it:
 * the credit is written into the timeline and into `youtube.json`, and
 * `publish-kit` rebuilds a listing from those long after the search result that
 * produced it has been forgotten. The timeline builder is shared by both
 * modules and therefore cannot import from one module's image source.
 *
 * Only the fact module produces credits today - it publishes photographs it
 * found under an open licence, and naming the creator is a licence condition
 * rather than a courtesy. The podcast module shows photographs its owner
 * uploaded, so its scenes carry `credit: null` and nothing is drawn.
 */
export interface ImageCredit {
  creator: string;
  provider: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
}

/**
 * The one line drawn in the corner of the frame.
 *
 * Kept short deliberately - it shares the frame with a subtitle that is doing
 * the actual work, and a full attribution string ("Photo by X, licensed under
 * Creative Commons Attribution 4.0 International") would be a second caption.
 * The complete form, with URLs, goes in the video description instead, which is
 * where a licence audit would look for it anyway.
 */
export function creditLine(credit: ImageCredit): string {
  const licence = credit.license.toLowerCase() === 'pdm' ? 'public domain' : credit.license;
  // Public-domain collections often record no photographer at all. "Unknown ·
  // CC0" in the corner of a frame reads as a bug; naming the collection the
  // picture came from is both true and useful, and CC0 requires no attribution
  // either way.
  const who = isUnknown(credit.creator) ? credit.provider : credit.creator;
  return `${who} · ${licence.toUpperCase()}`;
}

/** Whether a licence obliges the creator to be named wherever the work appears. */
export function requiresAttribution(license: string): boolean {
  const code = license.toLowerCase();
  return code !== 'cc0' && code !== 'pdm';
}

function isUnknown(creator: string): boolean {
  const value = creator.trim().toLowerCase();
  return value === '' || value === 'unknown' || value === 'unidentified';
}
