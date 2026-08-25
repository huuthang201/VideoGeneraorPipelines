# Video Generator Pipelines

Two pipelines and three channels in one engine.

| | **Podcast** | **Fact Shorts** | **Não Có Vấn Đề** |
|---|---|---|---|
| Output | 5-10 minute MP4 | 30-60 second MP4 | 30-60 second MP4 |
| Frame | 1920x1080 | 1080x1920 | 1080x1920 |
| Narration | English | Vietnamese | Vietnamese |
| Subtitles | bilingual English + Vietnamese | one Vietnamese line | one Vietnamese line |
| Voice | Edge TTS (`en-US-AriaNeural`) | VieNeu-TTS, local (`Thanh Bình`) | VieNeu-TTS, local (`Thanh Bình`) |
| Pictures | a shared library the user uploads | searched on Openverse at render time, then a second Claude call looks at the candidates and assigns them per scene | as Fact Shorts |
| Writes about | whatever the photographs support | one true thing | why your brain just did that |
| Publishes to | its own YouTube channel, every 8h | its own YouTube channel, every 2h | its own YouTube channel, every 2h |

```bash
npm run podcast -- generate <project>
npm run fact    -- generate <project>
npm run psych   -- generate <project>
npm run ui                              # all three, on one page, port 4000
npm run ui:build                        # rebuild the interface after editing ui/
npm run ui:dev                          # Vite dev server with hot reload, port 5173
```

There is no default module. That is deliberate: each keeps separate job
directories, separate caches and **separate YouTube credentials**, so a guessed
module would run the wrong pipeline and upload to the wrong channel.

**Two pipelines, three channels.** `fact` and `psych` are the same pipeline -
`src/modules/shorts` renders both, and neither owns a line of image search,
pacing, caption or schema code. What each owns is its prompts, its env defaults
and its accent colours. See "A channel is a prompt pack" below before adding a
fourth.

## What this repo is

A Node/TypeScript CLI (the "Video Engine") plus a Remotion composition. The
engine is deterministic and contains no AI: given a storyboard it always
produces the same video. Claude's only job is writing the script.

Three layers, and the boundaries are load-bearing:

| Layer | Does | Never does |
|---|---|---|
| Claude Code | writes the script, picks the backdrop or names the image query, picks the camera moves and the style, calls the CLI | renders, synthesises speech, computes timings, writes JSX |
| Video Engine | validates, resolves images, calls TTS, computes the timeline, renders, validates output, uploads | calls Claude, knows Google Drive exists |
| Remotion | timeline to pixels | calls Claude or TTS, fetches anything, decides how long a scene is |

## How the two modules share one engine

Roughly two thirds of the code is shared. `src/modules/contract.ts` is the seam,
and it states the rule this merge was built on:

> **If the two differed only in a number or in prose, it is shared and the
> number is a parameter. If they differed in behaviour, the module owns it.**

Collapsing a behavioural difference into a flag is how two pipelines quietly
turn into one mediocre one.

```
src/
  domain/       shared types + zod bases; the scene vocabulary
  ai/           Claude transport (claude-runner), the fact-guard machinery
  tts/          Edge, VieNeu, mock, alignment, SRT
  image/        credit types; Sharp helpers
  pipeline/     the deterministic pipeline, timeline builder, job state
  video/        bundling, staging, rendering, ffprobe/ffmpeg, validation
  remotion/     one composition, shared components, two theme packs
  publish/      YouTube upload and the rolling schedule
  modules/
    contract.ts     what a module must provide
    index.ts        the registry
    podcast/        prompts, library, captions, theme values, env defaults
    shorts/         everything `fact` and `psych` share: Openverse search and
                    review, Vietnamese pacing, captions, scene/storyboard
                    schemas, the module factory, and the machine-describing
                    half of the prompt (`prompt-parts.ts`)
    fact/           prompts + env defaults. Four files, and that is all a
                    channel is
    psych/          prompts + env defaults
server/         one Express app serving both, routes scoped /api/<module>/…
ui/             the web interface: React + Tailwind + shadcn, built by Vite
runtime/<module>/   jobs, caches, logs, schedule, YouTube token (gitignored)
```

`server/public/` is **build output**, not source - `npm run ui:build` writes it
and it is gitignored. Editing it directly is editing something the next build
deletes.

## One button runs everything

`POST /api/<module>/projects/<id>/pipeline/start` runs the whole chain:

```
Ý tưởng → Kịch bản → Ảnh → Giọng đọc → Dựng video → Kiểm tra → Đăng YouTube
```

`runAuto` in `server/lib/pipelineRunner.ts` sequences it, and adds no capability
- every step was already available separately. Two rules shape it:

**A missing brief is drafted, never overwritten.** Pressing start on an empty
project asks Claude for a topic; pressing it on one somebody has written into
uses what they wrote. It passes the project's *display name* rather than its id,
because the id is a slug and "Tại sao mèo kêu grừ grừ" reaches Claude as
"tai-sao-meo-keu-gru-gru" with the tones gone.

**Uploading still obeys the project's own setting.** `meta.autoPublish` is where
a person chose `none` / `now` / `schedule`, and it **defaults to `schedule`** -
so a project nobody has configured *will* publish at the end of a run. That
default predates this button; the button only makes it easier to reach. Worth
knowing before testing on a real project.

### The row of boxes

`server/lib/runState.ts` is the single definition of the steps and which one is
lit. It exists because the answer comes from two places that do not know about
each other: the middle of a run is inside `runPipeline` and reports itself
through `job.json`'s status, while the two ends are driven by the server. One
cursor, everything before it done, everything after pending.

`skipped` means "this run is deliberately not doing this step", and only while
it runs. Once a run is over the boxes describe *what exists* - a project with a
brief shows that box done, whether it was typed months ago or ninety seconds
ago. Getting that backwards was the first bug here: a run that had just written
a brief redrew it as "not done" the moment it finished.

Labels are not on the server. They are per module - the podcast picks a
photograph out of a library, the fact short searches for one - and they are
interface copy; they live in `ui/src/components/pipeline/PipelineFlow.tsx`.

### A channel is a prompt pack

Adding "Não Có Vấn Đề" is what forced this distinction, and it is worth reading
before adding a fourth channel.

`fact` and `psych` differ **only in prose**. Same frame, same voice, same pace,
same Openverse search, same caption layout, same schema. By the rule above that
makes them one module with a parameter - except for the one thing a module
actually is here: its own `runtime/<id>/`, its own cache, and its own YouTube
refresh token. Two channels cannot share a token, because the token *is* the
channel.

So the split is not module-versus-parameter, it is **machine versus channel**:

| Lives in `shorts/` | Lives in `<channel>/` |
|---|---|
| Openverse search, ranking, download, the review pass | the storyboard prompt |
| Vietnamese pacing and the word budget | the suggest-brief prompt |
| captions, scene and storyboard schemas | env defaults (paths, channel name) |
| `makeShortsModule`, the retry loop, the three gates | accent colours |
| the half of the prompt describing *the system* | the half describing *the subject* |

That last row is the one people get wrong. A prompt has editorial paragraphs
("what counts as true on this channel") and mechanical ones ("Openverse indexes
objects, not actions; adding a third word drops the result count off a cliff").
The mechanical ones are measured behaviour of Openverse, VieNeu-TTS and
`StoryboardDraftSchema`, they have no opinion about subject matter, and they
live in `shorts/prompt-parts.ts`. Written out per channel, a lesson learned the
expensive way - "rodent teeth" returns museum skulls - gets fixed in one prompt
and stays wrong in the other.

A new channel is therefore four files: two prompts, `env-defaults.ts`, and an
`index.ts` that calls `makeShortsModule`. Plus its id in `MODULE_IDS`, which the
compiler then chases into every `Record<ModuleId, …>` in the repo - the registry,
the env defaults, the theme packs, the base hashtags. Follow the type errors and
you cannot miss one.

**Verify a channel refactor by diffing the prompt.** After moving the shared
parts out, dump `buildStoryboardPrompt` for a fixed input from a worktree at the
previous commit and from the working tree, and diff. The fact channel's prompt
came out byte-identical, which is the only evidence that a 535-line prompt
survived being cut into pieces.

### What each module owns, and why

Reading this before changing anything will save you a confusing afternoon.
Every item is a place where the two genuinely disagree.

- **The prompt and the feedback language.** The podcast writes English, the fact
  short Vietnamese - including the structural violations echoed back on a retry.
  Mixing the two in one conversation is how a model starts answering in the
  wrong one.
- **The fact-guard patterns.** They are regexes over a language. English regexes
  in a Vietnamese script would silently pass every promotional claim.
- **Where pictures come from, and *when*.** The podcast reads the library
  *before* writing, because the model has to see the photographs to choose one.
  The fact module searches *after*, because the queries live inside the
  storyboard.
- **Caption layout.** Two components, not one with conditionals - see
  `CaptionRenderer`. One is a bilingual pair with a plate behind it; the other
  is a single heavy line with no plate, because a rectangle appearing every
  second and a half is the most distracting thing in a vertical frame.
- **`captionBlockLines`.** How much room the title reserves above the subtitle.
  The podcast reserves more than four lines (English wraps to two, plus the
  Vietnamese line, plus the plate's padding); the fact module reserves two.
  Under-reserving is not cosmetic: the title lands on top of the subtitle, only
  on the busiest sentences, so it survives review and ships.
- **`coverTolerance`.** 1.35 for the podcast, 4.0 for the fact module. At 1.35 an
  ordinary 16:9 photograph in a 9:16 frame becomes a band across the middle with
  blurred grey around it - which was every scene of every short. At 4.0 a
  podcast would hard-crop an off-ratio photograph the interface promised to
  letterbox.
- **`pacing.wordsPerMinute`.** 139 (English words) against 318 (Vietnamese
  syllables). Not comparable, both measured, and both drive the word budget
  *and* the mock TTS - so a shared number makes every mock render of one module
  come out at half or double its real length.
- **`ttsTimeoutMs`.** One call carries the whole script. Two minutes suits forty
  seconds of speech and fails every ten-minute episode.
- **`outputDurationGuard`.** A runaway ceiling, not a length preference. An hour
  for the podcast, five minutes for the short.
- **`resolveTargetSeconds`.** The fact module clamps to 52s - not 60 - because
  a script is accepted up to 15% over its budget and 60 + that allowance stops
  being a Short. The podcast has no such cliff.
- **Env defaults.** `src/modules/<name>/env-defaults.ts`, layered under `.env`
  and `.env.<module>`. Without them a key missing from `.env.podcast` would fall
  through to the fact module's answer and hand a podcast a Vietnamese narrator
  in a vertical frame, with nothing failing.

### Configuration layering

`.env` → `.env.<module>` → the real environment, each winning over the last,
with the module's own defaults underneath all three. **Nothing writes to
`process.env`** - the web UI serves both modules from one process, and
`dotenv.config({ override: true })` would leak one module's credentials into the
other. `src/config/env.ts` parses into a plain object instead.

`loadConfig(module)` is the only entry point, and `runtime/<module>/` is where
everything mutable lives.

## Rules that are enforced in code, not by convention

These hold for both modules.

**The timeline is the only source of truth for timing.** Claude's
`scene.duration` is a hint and Remotion never sees it.
`src/pipeline/build-timeline.ts` derives every duration from measured audio, and
scenes tile the voice track exactly. Do not "improve" this by letting a
component compute seconds; that is how captions drift.

**Length is checked, not requested.** A model asked for ten minutes returns two
and stops. `WORDS_PER_MINUTE` turns the target into a word budget, the prompt
decomposes it per scene, and `checkStoryboardStructure` measures the returned
script and rejects it with the shortfall named.

**Narration is mandatory.** A job cannot reach DONE without it. Remotion writes
an AAC track even for a silent composition, so the check is on silence content,
not stream presence.

**The frame size comes from configuration on every run, not from the
storyboard.** `runPipeline` overwrites `storyboard.video.{width,height,fps}`
before building the timeline. Reading them from the file is wrong in a way that
reports success. `style` is left as the model chose it - that one *is* content.

**Layout is derived from the live frame, never from a constant.** Type sizes are
fractions of the frame's short edge, safe-area insets are chosen by orientation,
and `defaultFitFor` compares aspects rather than naming shapes.

**CSS percentage padding resolves against width, not height.** At 9:16 that
makes every vertical inset about 56% of what it should be. Safe areas and
caption positions are computed in pixels from `useVideoConfig()`.

**Never stretch an image.** `src/remotion/layout/fit.ts` returns explicit pixel
boxes from a single uniform scale.

**The layer order in `SceneShell` is load-bearing.** backdrop → scrim → motion
overlay → photo credit → title → captions. The scrim keeps light type readable
over a bright sky; the credit sits above it so it stays legible and below the
text so it never covers a word being read.

**Motion overlays are deterministic.** `MotionOverlay` seeds its particles from
an integer hash of the scene, never `Math.random()`.

**Nothing may hold a `delayRender()` open for the life of the page.** The
timeout is measured from when the page opened, so a handle Remotion still
believes is open kills any render longer than `timeoutInMilliseconds`. A
module-level `delayRender` around the font load failed a seven-minute episode
twice at `not cleared after 298000ms`. Fonts do not need it.

**A `.lock` is only believed while its process is alive.** `readLock` checks the
pid with signal 0 and sweeps the file when nobody owns it.

**A trailing space in .env does not survive.** dotenv strips it, so
`YOUTUBE_TITLE_PREFIX` gets its separator appended in `loadConfig`.

**The publishing kit is generated, not written.** Title and description from the
model; chapters from the *timeline* (real frame positions, obeying YouTube's
silent rules - first mark at 0:00, three minimum, ten seconds apart); the music
credit from `assets/music/credits.json`; the photo credits from the timeline.
Both credits are licence conditions, and a model told to remember an attribution
will forget it on the video nobody checks. Chapters are skipped under two
minutes - nobody navigates a Short.

**A stale schedule marker is caught up, never followed.** A marker three days
in the past means nobody has published for three days, not that nine uploads are
due at once. The slot is taken *before* the upload starts.

**Uploads are serialised; renders are not.** Rendering is CPU-bound and the
machine can schedule several. Uploading is bandwidth-bound and cannot. The
queue is shared across *both* modules, because the constraint is one uplink.

**Uploading is never a side effect of rendering.** The CLI's `generate` does not
publish. The chaining lives in the UI's runner, where a person clicked a button
that said so.

**Nothing names the target channel, so the engine records it.** `videos.insert`
uploads to whichever channel the credentials belong to. `authorize` asks
`channels.list?mine=true` right after consent and stores the answer beside the
refresh token.

**The YouTube upload cannot publish publicly, and that is Google's rule.**
Google forces uploads from an unaudited API project to `private`. The code
reports what YouTube actually set rather than what it requested.

**Music is a folder, not a setting.** Drop a track in `assets/music/` and the
next render has a bed. `MUSIC_FILE` picks a specific one, and naming a file that
is not there fails the run rather than rendering a silent video.

**The vocabulary is short on purpose.** Two transitions, eight camera moves, one
effect - and short for a *different reason* in each module. In a podcast a jolt
would wake someone falling asleep; in a short, every scene is already a cut
every few seconds and effects on top make the subtitles unreadable. A value in
the whitelist is a value the model will eventually reach for.

**The fact guard only applies when there is an info.json.** A script is prose,
and rejecting every figure in prose rejects correct writing on almost every
line. A project that ships an info.json is declaring that it makes checkable
claims and that these are the only ones it may make. The guard reports
`applied: false` rather than standing down silently.

## Verifying a change

There is no test suite, and `tests/` is stale reference material - `vitest` is
not a dependency and there is no `test` script. Verify by running the real
thing:

```bash
npm run typecheck
npm run podcast -- generate <project> --mock-tts --no-publish --force
npm run fact    -- generate <project> --mock-tts --no-publish --force
```

`--mock-tts` is the fast loop: silent audio, real layout, paced from the
module's own measured words-per-minute so the length is what the real thing
would be. Anything rendered with it is stamped `devMock: true` and must not be
published.

**Check both modules.** Most of this codebase is now shared, so a change that
looks local is often not - the merge itself introduced four regressions of
exactly that kind (the caption reservation, the cover tolerance, the mock pace
and the TTS timeout), each of which typechecked cleanly and only showed up in a
rendered frame or a failed run.

## Known fragility

Edge TTS is an unofficial Microsoft endpoint and periodically starts rejecting
clients. For the podcast it is the only engine, so it is that module's single
point of failure; the fact module defaults to VieNeu running locally and keeps
Edge as a fallback. Mitigations: the TTS cache means unchanged text never
re-calls it, `--mock-tts` keeps the pipeline runnable offline, and `TTSProvider`
is an interface so Azure can be dropped in without changing how anything sounds.

## Deeper reading

Each module's original engineering notes are kept whole under `docs/modules/`:
[podcast](docs/modules/podcast.md), [fact](docs/modules/fact.md), and the
Vietnamese operator guides beside them. They predate the merge, so where they
describe layout or configuration the current code wins - but the *reasoning*
behind every tuned constant is there and is worth reading before changing one.
