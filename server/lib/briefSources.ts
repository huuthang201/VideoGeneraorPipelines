import type { AnyVideoModule } from '../../src/modules';
import { extractSources } from '../../src/domain/brief';

/**
 * Parses a brief the way the person wrote it, with the links in its context
 * pulled out into `sources` for the modules whose brief has that field.
 *
 * One rule for both ways a brief is written - a prompt typed into the create
 * dialog, and an edit in the project's own brief box - because they used to
 * disagree. The create path extracted the links; the edit path sent back only
 * the fields the form knew about, so fixing a typo in the idea silently erased
 * every source, and with them whatever photographs those sources had been
 * permitted to supply.
 *
 * `sources` is always derived, never taken from the request: it is a reading
 * of the context, and a stored list that could drift from the text beside it
 * would mean the research call reads links the person has since deleted.
 *
 * Which modules take the field is asked of the module's own schema rather than
 * named here. The briefs are strict, so a brief without `sources` rejects the
 * first shape and gets the second - and a module that grows the field later
 * picks this up without an edit.
 */
export function parseBriefWithSources(
  module: AnyVideoModule,
  body: Record<string, unknown>,
): unknown {
  const { sources: _derived, ...rest } = body;
  const context = typeof rest.context === 'string' ? rest.context : '';
  const sources = extractSources(context);

  const candidates = sources.length > 0 ? [{ ...rest, sources }, rest] : [rest];

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return module.parseBrief(candidate);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
