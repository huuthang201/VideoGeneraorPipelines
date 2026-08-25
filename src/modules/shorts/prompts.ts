import type { ProductInfo } from '../../domain/project';
import type { Brief } from './domain/brief';

/**
 * The seam between the machinery and the channel.
 *
 * Everything else under `shorts/` is the same for every channel built on it:
 * how a photograph is searched for and ranked, how Vietnamese syllables become
 * a word budget, how a caption is laid out, what a scene is allowed to contain.
 * None of that knows or cares what the video is about.
 *
 * What a channel owns is the writing. A fact channel and a psychology channel
 * ask for different subject matter, in a different voice, with different
 * examples and a different call to subscribe - and that is *all* they differ
 * by. Naming that difference as three functions is what stopped the second
 * channel from being a copy of the first: a copy would have carried thirteen
 * identical files that then drift, and the next Openverse fix would have had
 * to be made twice.
 *
 * The prompts themselves are written in Vietnamese even though the code around
 * them is English. Not inconsistency: the deliverable is Vietnamese prose, and
 * a prompt in one language asking for prose in another reliably produces prose
 * with the first language's rhythm in it - immediately audible in a language
 * with tones and particles.
 */

export interface StoryboardPromptInput {
  projectId: string;
  /** Falls back to the project id when nothing better is known yet. */
  workingTitle: string;
  info: ProductInfo | null;
  targetDurationSec: number;
  defaultStyle: string;
  defaultVoice: string;
  /** Channel name for the closing call to subscribe. Empty means no call. */
  channelName: string;
  /** Optional user-supplied direction (the UI's topic/opening boxes). */
  brief?: Brief | null;
}

export interface SuggestBriefPromptInput {
  /** What the project is called - the only thing anyone types before asking. */
  topic: string;
  info: ProductInfo | null;
  /** Titles this channel has already used, so a suggestion is not a repeat. */
  alreadyCovered: readonly string[];
}

export interface ShortsPrompts {
  /** The single call that writes a script. */
  buildStoryboardPrompt(input: StoryboardPromptInput): string;

  /** The cheap call that drafts a starting topic for an empty project. */
  buildSuggestBriefPrompt(input: SuggestBriefPromptInput): string;
}
