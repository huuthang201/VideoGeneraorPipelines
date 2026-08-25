import { makeShortsModule } from '../shorts/module';
import { buildStoryboardPrompt } from './prompts/generate-storyboard';
import { buildSuggestBriefPrompt } from './prompts/suggest-brief';

/**
 * Não Có Vấn Đề: why your brain just did that.
 *
 * The same vertical Vietnamese short as the fact channel, and mechanically it
 * *is* the same - `../shorts` renders both. What makes it a separate module
 * rather than a setting is what a module means here: its own job directory, its
 * own cache, and its own YouTube credentials pointing at its own channel.
 */
export const psychModule = makeShortsModule({
  id: 'psych',
  label: 'Não Có Vấn Đề',
  description: 'Vietnamese psychology shorts, 30-60s, 9:16, photographs searched automatically',
  prompts: { buildStoryboardPrompt, buildSuggestBriefPrompt },
});
