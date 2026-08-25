/**
 * Ascii kebab-case ids from display names, including Vietnamese ones.
 *
 * Used for both project ids and character ids, which is why it lives here
 * rather than in the server: a character folder created from the CLI must get
 * exactly the same id as one created from the web UI, or the two front doors
 * would quietly produce different directories for the same name.
 */
export function slugify(name: string, fallback = 'muc'): string {
  const base = name
    .trim()
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics left behind by NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return base || fallback;
}

/** Same charset slugify() produces - used to reject unsafe ids in URLs and paths. */
export function isValidSlug(id: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id);
}
