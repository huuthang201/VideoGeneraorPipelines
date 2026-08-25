import type { ProductInfo } from '../../../domain/project';
import type { Brief } from '../domain/brief';
import type { AvailableAssets } from '../domain/storyboard';
import {
  ANIMATIONS,
  SCENE_EFFECTS,
  SCENE_OVERLAYS,
  SCENE_TYPES,
  TRANSITIONS,
} from '../../../domain/scene';
import { MAX_NARRATION_CHARS } from '../domain/scene';
import { MAX_SCENES } from '../domain/storyboard';
import { STYLES } from '../../../domain/config';
import { WORDS_PER_MINUTE } from '../pacing';
import { ENGLISH_VOICES } from '../../../tts/types';

/**
 * The single prompt: one Claude reasoning per episode.
 *
 * Its job is narrow on purpose. The model is not asked for dimensions, frame
 * rate, or durations that matter - those either belong to the system or are
 * derived later from real audio. What it is uniquely good at, and what nothing
 * else in the pipeline can do, is write five to ten minutes of English that is
 * worth listening to and decide which photograph belongs under each part of it.
 *
 * The prompt is written in English even though the people running this tool are
 * not necessarily English speakers. That is not carelessness: the deliverable is
 * an English script, and a prompt in one language asking for prose in another
 * reliably produces prose with the first language's rhythm in it.
 *
 * ## Length is the hard part
 *
 * Everything else here is a preference; length is a requirement the model will
 * quietly miss. Asked for "a ten minute episode" it returns two minutes of
 * excellent writing and stops, because it is optimising for a good answer
 * rather than a long one. Three things push back on that, and all three are
 * needed: a word budget in words rather than minutes, a per-scene word count so
 * the budget is decomposed rather than merely stated, and `checkStoryboardStructure`
 * measuring the result and sending it back with the shortfall named.
 */

export interface PromptInput {
  projectId: string;
  /** Falls back to the project id when nothing better is known yet. */
  workingTitle: string;
  info: ProductInfo | null;
  /** The backdrops the storyboard may use. */
  assets: AvailableAssets;
  /** The shared library's preview root - holds one sub-folder per kind. */
  previewDir: string;
  targetDurationSec: number;
  defaultStyle: string;
  defaultVoice: string;
  /** Optional user-supplied direction (the UI's topic/opening boxes). */
  brief?: Brief | null;
}

/** Words the script needs to run its intended length. See WORDS_PER_MINUTE. */
export function targetWordsFor(targetDurationSec: number): number {
  return Math.round((targetDurationSec / 60) * WORDS_PER_MINUTE);
}

/**
 * How long one scene holds, in seconds, before the picture wants to change.
 *
 * Thirty seconds is the sweet spot for a still photograph with a voice over it:
 * long enough that the changes do not feel like a slideshow, short enough that
 * the eye has not finished with the image before it goes.
 */
const SECONDS_PER_SCENE = 30;

export function buildStoryboardPrompt(input: PromptInput): string {
  const targetWords = targetWordsFor(input.targetDurationSec);
  const minutes = Math.round(input.targetDurationSec / 60);
  const sceneCount = Math.min(
    MAX_SCENES,
    Math.max(4, Math.round(input.targetDurationSec / SECONDS_PER_SCENE)),
  );
  const wordsPerScene = Math.round(targetWords / sceneCount);
  const backdrops = input.assets.environment;

  return [
    `You are writing one episode of a gentle English-language podcast, delivered`,
    `as a video: a single narrator's voice over still photographs that change as`,
    `the subject does.`,
    ``,
    `The listener is usually doing something else - cooking, commuting, falling`,
    `asleep, studying quietly. Nothing about this episode should demand their`,
    `full attention, and nothing should startle them.`,
    ``,
    `## The single hardest requirement: length`,
    ``,
    `This episode must run about ${minutes} minutes, which is **about ${targetWords} words**`,
    `of spoken script in total. That is much longer than a first draft usually`,
    `comes out. Write the whole thing.`,
    ``,
    `Plan for ${sceneCount} scenes of roughly ${wordsPerScene} words each. Count as you go. A`,
    `draft that comes back at half this length will be rejected and you will be`,
    `asked to write it again, so it is cheaper to write it fully the first time.`,
    ``,
    `Length must come from substance, never from padding: more examples, more`,
    `detail, a second angle on the same idea, a small digression that pays off.`,
    `Never from restating what you have already said, and never from filler`,
    `("as I mentioned", "as we discussed earlier", "so, yeah").`,
    ``,
    `## What this episode is about`,
    ``,
    input.brief?.context
      ? [
          `THIS IS THE MOST IMPORTANT INSTRUCTION ABOUT CONTENT. The episode is`,
          `about exactly this, and you may not substitute a topic you find easier:`,
          ``,
          `"${input.brief.context}"`,
          ``,
          `If the available photographs do not match it perfectly, choose the`,
          `closest ones and write about the subject anyway. The pictures illustrate`,
          `the episode; they do not decide it.`,
        ].join('\n')
      : [
          `The user has not named a topic, so choose one yourself from what the`,
          `photographs suggest: a place, a slow craft, a natural phenomenon, a`,
          `small piece of history, an everyday object with an interesting past.`,
          `Pick something you can genuinely sustain for ${minutes} minutes.`,
        ].join('\n'),
    ``,
    `## How it should open`,
    ``,
    input.brief?.hook
      ? [
          `The first scene must carry this idea. Rewrite it in the episode's own`,
          `voice rather than quoting it, but keep its meaning:`,
          ``,
          `"${input.brief.hook}"`,
        ].join('\n')
      : [
          `Open the way a good podcast opens: one warm, ordinary sentence of`,
          `welcome, then straight into the subject. No dramatic questions, no`,
          `"have you ever wondered", no trailer voice.`,
        ].join('\n'),
    ``,
    `Whatever the opening idea, the **first words of the episode are a greeting**.`,
    `Not a throat-clear, not a title card read aloud, not a wind-up - a greeting,`,
    `then straight on. "Hello, and welcome back." "Good evening." "Hi - come in,`,
    `sit down." One short sentence, then the subject.`,
    ``,
    `## The photographs`,
    ``,
    `The backdrop library is shared by every project - it is not a set of`,
    `pictures taken for this episode. Choose the ones that suit what you are`,
    `saying; you do not have to use all of them.`,
    ``,
    `Read every image in this folder with the Read tool before you write:`,
    `  ${input.previewDir}/environment`,
    ``,
    `Available backdrops (use these exact filenames in "environment"):`,
    ...(backdrops.length > 0 ? backdrops.map((f) => `  - ${f}`) : ['  (none)']),
    ``,
    `Change the picture as the subject changes, and let a picture come back later`,
    `if the episode returns to that idea. What you must not do is hold one`,
    `photograph across the whole episode - at this length that reads as a broken`,
    `video rather than as a stylistic choice.`,
    ``,
    `## Reference material`,
    ``,
    input.info
      ? [
          '```json',
          JSON.stringify(input.info, null, 2),
          '```',
          ``,
          `This file is the whitelist for anything checkable. You may rephrase what`,
          `is in it. You may not state a figure, a price, a warranty, a promotion or`,
          `a certification that is not in it - a mechanical check rejects those, and`,
          `it does not read your intentions. If a fact is not in the file, leave it`,
          `out entirely.`,
        ].join('\n')
      : [
          `(No info.json - this episode makes no checkable claims about a product.)`,
          ``,
          `Write from general knowledge, and stay on the side of what you are sure`,
          `of. Do not invent precise statistics, dates, studies or quotations to`,
          `sound authoritative; a calm episode is allowed to say "roughly", "most`,
          `of the time", or simply to describe rather than to measure.`,
        ].join('\n'),
    ``,
    `## Voice and tone - the part that decides whether anyone stays`,
    ``,
    `The narrator is a young woman with a soft, warm, unhurried voice. Write for`,
    `that delivery:`,
    ``,
    `- Second person, present tense, plain words. "You can hear it before you`,
    `  see it" beats "one is able to perceive it aurally in advance".`,
    `- Short sentences next to longer ones. A paragraph of uniform sentence`,
    `  length flattens out completely when it is read aloud.`,
    `- Concrete detail over abstraction. Name the thing: the sound, the colour,`,
    `  the smell, the specific hour of the morning.`,
    `- Calm, not sleepy. Interested in the subject, never excited about it.`,
    `- No hype, no marketing, no calls to action, no "smash that like button".`,
    `- No jokes that need a laugh. A quiet, dry observation is welcome.`,
    ``,
    `### Write for a voice that has to perform it`,
    ``,
    `The narration is read by a synthetic voice, and such a voice has exactly one`,
    `source of expression: your punctuation. It has no idea what the sentence`,
    `means. Everything it does with pitch and pause, you put there.`,
    ``,
    `- A dash or an ellipsis buys a real pause. Use them where a person would`,
    `  hesitate: "It rained all night - or most of it, anyway."`,
    `- A question mark lifts the line. Ask the listener something now and then,`,
    `  even rhetorically, and the read stops being flat.`,
    `- A one-word sentence lands. "Then it stopped. Completely."`,
    `- Commas are breath. A sentence with none is read in one long push;`,
    `  a sentence with three is read like someone thinking.`,
    `- Vary sentence length hard - five words next to twenty-five. Uniform`,
    `  length is the single biggest cause of a delivery that sounds robotic,`,
    `  and no voice setting can rescue it.`,
    `- Do NOT write stage directions, emphasis markers, capitals or SSML tags to`,
    `  get expression. They are read aloud as text. Punctuation is the only tool.`,
    ``,
    `Because every word is spoken aloud by a text-to-speech voice:`,
    ``,
    `- Write plain sentences with ordinary punctuation. No markdown, no emoji,`,
    `  no ALL CAPS, no bracketed stage directions like [pause] or (music).`,
    `- Do not write sound effects or music cues. There is no music track.`,
    `- Prefer words to symbols: "and" not "&", "percent" not "%".`,
    `- Spell out anything that would be read wrong: "twenty twenty-four" rather`,
    `  than "2024" when it is a year being spoken.`,
    `- English only. No other language appears anywhere in the output.`,
    ``,
    `## Building the scenes`,
    ``,
    `Each scene is one backdrop plus one paragraph of narration, and you decide:`,
    ``,
    `1. "narration" - the paragraph that gets read aloud. Around ${wordsPerScene} words,`,
    `   at most ${MAX_NARRATION_CHARS} characters. It must end on a complete thought: the`,
    `   picture changes here, so a sentence cut in half lands badly.`,
    ``,
    `2. "narrationVi" - the same paragraph in Vietnamese, for the subtitle line`,
    `   underneath the English one. Translate the *meaning*, the way a person`,
    `   would say it in Vietnamese - not word by word, and not stiffly formal.`,
    `   It is read at speed under a voice that is already talking, so keep it`,
    `   plain. Every scene needs one.`,
    `   Translate **sentence for sentence**: the same number of sentences, in the`,
    `   same order, so that each Vietnamese sentence sits under the English one`,
    `   it belongs to. Merging two English sentences into one Vietnamese sentence`,
    `   is what puts the wrong line under the wrong picture.`,
    ``,
    `3. "environment" - the backdrop filename this part is spoken over.`,
    ``,
    `4. "title" - a few words on screen naming this part of the episode, at most`,
    `   60 characters. It is a chapter heading, not a summary, and not a repeat`,
    `   of the first sentence. Leave it as an empty string when a scene is a`,
    `   continuation and does not need one - a title on every scene turns the`,
    `   video into a presentation.`,
    ``,
    `5. "animation" - the camera move over the still photograph:`,
    `   ${ANIMATIONS.join(' | ')}`,
    `   All of them are slow. Choose one that suits the picture: pan across a`,
    `   wide landscape, push in on something with a clear subject, pull out to`,
    `   let a scene open up, "drift" when nothing in particular is called for.`,
    `   Vary them - the same move on every scene is hypnotic in the wrong way.`,
    ``,
    `6. "transition" - ${TRANSITIONS.join(' | ')}. Use "fade" almost everywhere.`,
    `   "cut" is for a deliberate change of subject.`,
    ``,
    `7. "effect" - ${SCENE_EFFECTS.join(' | ')}. "vignette" quietly darkens the`,
    `   corners; it suits a reflective or night-time beat. Most scenes are "none".`,
    ``,
    `8. "overlay" - moving elements drawn over the still photograph:`,
    `   ${SCENE_OVERLAYS.join(' | ')}`,
    `   · "dust" - fine specks drifting up. Works over almost anything, and is`,
    `     the safe choice when a scene simply needs to feel alive.`,
    `   · "bokeh" - soft out-of-focus lights rising. Night, streets, interiors.`,
    `   · "rain" - fine falling streaks. Only when it is actually raining in the`,
    `     scene you are describing.`,
    `   · "light-sweep" - one slow band of light crossing the frame. Sunrise,`,
    `     windows, anything about light changing.`,
    `   Pick per scene, and leave some on "none": if every scene has something`,
    `   moving over it, none of them feel like they do.`,
    ``,
    `9. "duration" - your rough estimate in seconds. Advisory only: the real`,
    `   length is measured from the synthesised audio, so do not try to be exact.`,
    ``,
    `## Shape of the episode`,
    ``,
    `- The first scene is type "intro": welcome, then what this episode is about.`,
    `- The middle scenes are type "segment". Give the episode a spine - a`,
    `  question it works through, a story it tells in order, or a handful of`,
    `  facets examined one at a time - rather than a list of loosely related`,
    `  paragraphs.`,
    `- The last scene is type "outro": draw the thread together in a sentence or`,
    `  two, then a soft sign-off. Thank the listener plainly. Do not beg for`,
    `  subscriptions.`,
    ``,
    `## Valid values`,
    ``,
    `- type: ${SCENE_TYPES.join(' | ')}`,
    `- environment: ${backdrops.join(' | ') || '(none)'}`,
    `- animation: ${ANIMATIONS.join(' | ')}`,
    `- transition: ${TRANSITIONS.join(' | ')}`,
    `- effect: ${SCENE_EFFECTS.join(' | ')}`,
    `- overlay: ${SCENE_OVERLAYS.join(' | ')}`,
    `- style: ${STYLES.join(' | ')} (suggested: ${input.defaultStyle})`,
    `  · calm  - light, airy, low contrast; daytime and outdoors`,
    `  · warm  - amber and soft; stories, memory, evening`,
    `  · night - dark and quiet; sleep, space, rain`,
    `- voice: one of`,
    ...Object.values(ENGLISH_VOICES).map((v) => `    ${v}`),
    `  (suggested: ${input.defaultVoice} - all are female; pick the one that fits`,
    `  the subject. Speed and pitch are a system setting, not yours: leave "rate"`,
    `  and "pitch" out entirely.)`,
    ``,
    `Only these values. Do not invent new ones, and use only the filenames listed`,
    `above.`,
    ``,
    `## The YouTube listing`,
    ``,
    `The episode is published as a video, so write its listing too - in a`,
    `"publish" object with "title", "description" and "tags".`,
    ``,
    `- **title**: at most 100 characters, and the first 60 are what people`,
    `  actually see. Say what the episode *is*, in the register of the episode`,
    `  itself: "The hour before a city wakes up" belongs here, "You WON'T`,
    `  BELIEVE what happens at 4am" does not. No all-caps, no emoji.`,
    `- **description**: two or three short paragraphs. The first two lines are`,
    `  the only ones shown before "...more", so put the subject there rather`,
    `  than a greeting. Then what the listener can expect, and who it suits`,
    `  (falling asleep to, studying, a commute). Do NOT write a chapter list or`,
    `  a music credit - the system generates both from the finished video, with`,
    `  timings it measures and an attribution it is legally obliged to get right.`,
    `- **tags**: five to twelve, lower case, the words someone would actually`,
    `  search. Mix broad ("calm podcast", "sleep story") with specific to this`,
    `  episode ("hanoi", "rain sounds").`,
    ``,
    `## Output format`,
    ``,
    `Return ONE JSON object and nothing else - no explanation, no markdown fence`,
    `around it, no commentary before or after.`,
    ``,
    '```json',
    JSON.stringify(
      {
        version: '1.0',
        project: { id: input.projectId, episodeTitle: 'The title of this episode' },
        video: { style: input.defaultStyle },
        voice: { voice: input.defaultVoice },
        content: {
          summary: 'One or two sentences describing the episode, for show notes.',
          narration: '',
        },
        publish: {
          title: 'The hour before a city wakes up',
          description:
            'A slow walk through the streets between four and six in the morning, ' +
            'and the people who are already out in them.\n\n' +
            'Made to be listened to rather than watched - while you cook, commute, ' +
            'or fall asleep.',
          tags: ['calm podcast', 'sleep story', 'ambient', 'city at night'],
        },
        scenes: [
          {
            id: 'scene-01',
            type: 'intro',
            environment: backdrops[0] ?? 'backdrop-01.jpg',
            title: 'A quiet morning',
            narration:
              'Hello, and welcome back. The paragraph that gets read aloud - written, ' +
              'punctuated and paced the way it should be spoken.',
            narrationVi:
              'Câu tiếng Việt mang đúng ý của đoạn trên, viết như người Việt nói.',
            duration: 30,
            animation: 'drift',
            transition: 'fade',
            effect: 'none',
            overlay: 'dust',
          },
        ],
      },
      null,
      2,
    ),
    '```',
    ``,
    `Every scene needs both "narration" and "narrationVi".`,
    `Leave "content.narration" as an empty string - the system joins the scene`,
    `paragraphs itself. Working title so far: "${input.workingTitle}"; replace it`,
    `with a real episode title.`,
  ].join('\n');
}

/** Appended verbatim on a retry so the model sees exactly what was wrong. */
export function buildRetryPrompt(originalPrompt: string, problems: string): string {
  return [
    originalPrompt,
    ``,
    `---`,
    ``,
    `## Your previous attempt was rejected`,
    ``,
    problems,
    ``,
    `Return the corrected JSON. Still only JSON, nothing else.`,
  ].join('\n');
}
