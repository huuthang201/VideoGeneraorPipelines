import { z } from 'zod';
import { MAX_SOURCES, baseBriefFields, extractSources } from '../../../domain/brief';

export { MAX_SOURCES, extractSources } from '../../../domain/brief';


export const BriefSchema = z.strictObject({
  ...baseBriefFields(),
  /**
   * Target length in seconds, overriding VIDEO_TARGET_DURATION for this video.
   *
   * The floor is five minutes: below that this is the wrong module and the
   * shorts pipeline should have it. The ceiling is forty, past which one Claude
   * call per section stops being enough structure and the research pass would
   * need splitting too.
   */
  targetSeconds: z.number().min(300).max(2400).optional(),
  /**
   * Pages the person writing the brief wants the video built from.
   *
   * The difference from ordinary research is who chose them. The outline call
   * searches the web on its own either way; these it must *read*, first, and
   * treat as the primary basis - because somebody who pastes three articles
   * into a prompt is saying "this is the story", and a model that goes off and
   * finds a different one has ignored the only instruction that mattered.
   *
   * Extracted from the prompt text by `extractSources` rather than typed into
   * a separate box, because the person thinks of them as part of one prompt -
   * "a video about X, based on these" - and splitting that across two fields
   * is how the second one gets left empty.
   */
  sources: z.array(z.string().url()).max(MAX_SOURCES).optional(),
  /**
   * The channel owner's statement that the papers behind `sources` have allowed
   * their photographs to be used in this video.
   *
   * A claim this code cannot check, recorded where it was made - on the one
   * project it applies to - rather than as a setting that would quietly extend
   * it to every article anybody pastes afterwards. When it is set, the
   * photographs inside those articles become picture sources, shown whole and
   * credited on screen; when it is not, the articles are read for facts only.
   */
  sourceImagesPermitted: z.boolean().optional(),
});

export type Brief = z.infer<typeof BriefSchema>;

/** The requested length in seconds, or null to fall back to configuration. */
export function targetSecondsOf(brief: Brief | null): number | null {
  return brief?.targetSeconds ?? null;
}

/**
 * Wikimedia Commons categories named among the sources.
 *
 * The one kind of source whose meaning is certain without reading it. A
 * category URL is somebody saying "use *these* pictures", so it goes straight
 * into the image queries in code, rather than being handed to the model to
 * notice - a model will usually notice, and "usually" is the wrong guarantee
 * for the one thing the person pointed at directly.
 */
export function commonsCategoriesFrom(sources: readonly string[]): string[] {
  const names: string[] = [];

  for (const source of sources) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      continue;
    }
    if (!url.hostname.endsWith('commons.wikimedia.org')) continue;

    // Both /wiki/Category:Name and ?title=Category:Name, the two forms Commons
    // links take in the wild.
    const raw =
      url.pathname.match(/\/wiki\/Category:(.+)$/u)?.[1] ??
      url.searchParams.get('title')?.match(/^Category:(.+)$/u)?.[1];
    if (!raw) continue;

    const name = decodeURIComponent(raw).replace(/_/gu, ' ').trim();
    if (name) names.push(name);
  }

  return [...new Set(names)];
}

/**
 * Whether a source can supply pictures, as opposed to only facts.
 *
 * Only Wikimedia Commons categories, and that narrowness is the point rather
 * than a gap. Every other link somebody pastes - a news article, above all - is
 * read for what it *says*. The photographs on a news page belong to the paper:
 * Tuổi Trẻ states that it "giữ bản quyền nội dung trên website này", Thanh Niên
 * that "bản quyền thuộc về Báo Thanh Niên", and republishing them on a
 * monetised channel is exactly what earns a copyright strike. So a news link is
 * a text source by construction, and saying so up front - in the log and in the
 * interface - is what stops somebody expecting its pictures.
 */
export function isImageSource(url: string): boolean {
  return commonsCategoriesFrom([url]).length > 0;
}

/**
 * The articles whose photographs this video may use: none unless the owner has
 * said the papers allowed it, and never a Commons category, which is an open
 * picture source already.
 *
 * Read from `sources`, or from the context when a brief predates that field -
 * the links are in the prose either way. One function because two places ask:
 * the image search, and the input hash that decides whether ticking the box is
 * a reason to render again.
 */
export function permittedArticlesOf(brief: Brief | null): string[] {
  if (!brief?.sourceImagesPermitted) return [];
  const sources = brief.sources?.length ? brief.sources : extractSources(brief.context ?? '');
  return sources.filter((url) => !isImageSource(url));
}
