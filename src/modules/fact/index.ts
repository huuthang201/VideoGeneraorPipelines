import { makeShortsModule } from '../shorts/module';
import { buildStoryboardPrompt } from './prompts/generate-storyboard';
import { buildSuggestBriefPrompt } from './prompts/suggest-brief';

/**
 * Fact Shorts: one true thing, told in forty-five seconds.
 *
 * Everything mechanical lives in `../shorts` and is shared with every other
 * vertical Vietnamese channel in this repo. What is left here is the only thing
 * that makes this channel itself - how it asks for a script.
 */
export const factModule = makeShortsModule({
  id: 'fact',
  label: 'Fact Shorts',
  description: 'Vietnamese fact shorts, 30-60s, 9:16, photographs searched automatically',
  prompts: { buildStoryboardPrompt, buildSuggestBriefPrompt },
});
