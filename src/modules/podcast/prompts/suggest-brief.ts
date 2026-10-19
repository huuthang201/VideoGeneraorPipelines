import type { ProductInfo } from '../../../domain/project';

/**
 * A short, single-shot prompt that fills the two text boxes before anything is
 * generated.
 *
 * It used to work by *looking* at the uploaded library and proposing a subject
 * the photographs could carry - the library was what an episode could be about.
 * There is no library now, so the job has inverted: the subject is chosen
 * first, in whatever direction the project's name points, and the pictures are
 * searched for afterwards. That is a better order for this format anyway - an
 * episode is about an idea, and the backdrop is what it is shot against.
 */

export interface SuggestBriefPromptInput {
  /** The project's name - the only thing anyone types before asking. */
  topic: string;
  info: ProductInfo | null;
  /** Episodes this channel has already made, so a suggestion is not a repeat. */
  alreadyCovered: readonly string[];
}

/** How many past titles to show. Enough to avoid repeats, short enough to read. */
const MAX_COVERED = 30;

export function buildSuggestBriefPrompt(input: SuggestBriefPromptInput): string {
  const covered = input.alreadyCovered.slice(-MAX_COVERED);

  return [
    `A slow, spoken English podcast episode is about to be written: five to ten`,
    `minutes, one voice, no guests, shot against still photographs. Your job is`,
    `only to suggest what it should be about.`,
    ``,
    `## The project is called: "${input.topic}"`,
    ``,
    `That is the only clue to what somebody wanted, so follow it:`,
    ``,
    `- If the name points at a **subject** - a place, an hour of the day, a`,
    `  feeling, a small ritual - propose an episode about exactly that.`,
    `- If it points at a **broad area**, choose one specific angle inside it.`,
    `- If it means **nothing** (like "Project 2", "test", a string of letters),`,
    `  ignore it completely and choose a good subject as you normally would.`,
    ``,
    `## What makes a good episode here`,
    ``,
    `- Something that rewards being *listened to* rather than watched. This is`,
    `  played while people cook, commute or fall asleep.`,
    `- Concrete rather than abstract. "The hour before a city wakes up" is an`,
    `  episode; "loneliness in modern life" is an essay title.`,
    `- Something that can be **photographed**. The engine will search an open`,
    `  stock archive for the backdrops, so an episode rooted in places, weather,`,
    `  objects and streets will find pictures; one rooted purely in an idea will`,
    `  not.`,
    `- No advice, no listicles, no self-improvement. This channel notices things.`,
    ``,
    covered.length > 0
      ? [
          `## Episodes this channel has already made`,
          ``,
          `Do not repeat one of these, or a near-variant of it:`,
          ``,
          ...covered.map((title) => `  - ${title}`),
        ].join('\n')
      : `(No episodes yet, so every subject is still open.)`,
    ``,
    `## Reference material`,
    input.info
      ? '```json\n' + JSON.stringify(input.info, null, 2) + '\n```'
      : '(No info.json.)',
    ``,
    `## What to return`,
    ``,
    `1. "context": two or three sentences naming the specific subject of the`,
    `   episode and the angle it takes. Concrete enough to write from`,
    `   immediately: "the hour between four and six in the morning in a city,`,
    `   and the people already out in it" is usable; "about mornings" is not.`,
    `2. "hook": the opening line, in the voice of the episode. It begins with a`,
    `   greeting - this show always does - and then goes straight into the`,
    `   subject. No throat-clearing, no rhetorical question.`,
    ``,
    `Both in English. This is only a starting point: somebody will read it and`,
    `may edit it before the script is generated.`,
    ``,
    `Return ONE JSON object and nothing else - no explanation, no markdown fence:`,
    '```json',
    JSON.stringify(
      {
        context: 'the specific subject of the episode, and the angle it takes',
        hook: 'the greeting and the first line about the subject',
      },
      null,
      2,
    ),
    '```',
  ].join('\n');
}
