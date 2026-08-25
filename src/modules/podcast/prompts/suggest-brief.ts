import type { ProductInfo } from '../../../domain/project';
import type { AvailableAssets } from '../domain/storyboard';

/**
 * A short, single-shot prompt used before the real storyboard prompt: it asks
 * Claude to look at the backdrops and draft a starting topic and opening for the
 * two free-text boxes in the UI, which the user can then edit before generating
 * the actual episode.
 *
 * Deliberately much cheaper than the storyboard call - no script is written
 * here, just a couple of sentences the user is expected to rewrite.
 */
export interface SuggestBriefPromptInput {
  previewDir: string;
  assets: AvailableAssets;
  info: ProductInfo | null;
}

export function buildSuggestBriefPrompt(input: SuggestBriefPromptInput): string {
  return [
    `A gentle English-language podcast is about to be written: one calm narrator`,
    `over still photographs, five to ten minutes long. Your job is only to`,
    `suggest what it could be about.`,
    ``,
    `Read every image in this folder with the Read tool:`,
    `  ${input.previewDir}/environment`,
    ...input.assets.environment.map((f) => `    - ${f}`),
    ``,
    `## Reference material`,
    input.info
      ? '```json\n' + JSON.stringify(input.info, null, 2) + '\n```'
      : '(No info.json.)',
    ``,
    `## What to return`,
    ``,
    `Based on what is actually in the photographs - do not invent facts, prices`,
    `or statistics - suggest:`,
    ``,
    `1. "context": two or three sentences naming a subject these photographs`,
    `   could carry for a whole episode, and the angle to take on it. Be`,
    `   specific enough to write from: "the hour before a city wakes up, told`,
    `   through the people who are already awake" is useful; "nature" is not.`,
    `2. "hook": one or two sentences for how the episode opens - warm, plain,`,
    `   and already inside the subject. Not a rhetorical question, not a trailer`,
    `   line.`,
    ``,
    `Both in English. This is a starting point: the user will read it and may`,
    `rewrite it before anything is generated.`,
    ``,
    `Return ONE JSON object, no explanation, no markdown:`,
    '```json',
    JSON.stringify({ context: 'suggested subject here', hook: 'suggested opening here' }, null, 2),
    '```',
  ].join('\n');
}
