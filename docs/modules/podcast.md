# Auto Podcast Video Generator

Turns one shared library of uploaded photographs into a 5-10 minute MP4 with
gentle English narration.

## What this repo is

A Node/TypeScript CLI (the "Video Engine") plus a Remotion composition. The
engine is deterministic and contains no AI: given a storyboard it always
produces the same video. Claude's only job is writing the episode.

Nothing here generates imagery or music. Every pixel on screen comes from a
photograph the user uploaded into the **system-wide** backdrop library, which
lives in `$LIBRARY_DIR` (default `runtime/library`), is uploaded once, and is
drawn on by every project. **A project owns no images at all** - it holds a
brief, a storyboard, and its output. There is no per-project upload step, and
adding a backdrop makes it available to every episode at once.

A scene is exactly one backdrop plus one paragraph of narration, and the model's
creative work is writing five to ten minutes of English worth listening to and
deciding which photograph belongs under which part of it.

Three layers, and the boundaries are load-bearing:

| Layer | Does | Never does |
|---|---|---|
| Claude Code | looks at the shared library, writes the English script, picks the backdrop per scene, the camera moves and the style, calls the CLI, moves files to and from Drive | renders, synthesises speech, computes timings, writes JSX, generates images |
| Video Engine | validates, processes images, calls TTS, computes the timeline, renders, validates output | calls Claude, knows Google Drive exists |
| Remotion | timeline to pixels | calls Claude or TTS, decides how long a scene is |

## Commands

```bash
npm run setup:python                     # one-time: venv + edge-tts
npm run tts:voices                       # every English voice the service has
npm run tts:sample                       # render the shortlist into runtime/voice-samples
npx tsx src/cli/index.ts library add-environments <dir>   # import backdrops
npx tsx src/cli/index.ts library list                     # what the library holds
npx tsx src/cli/index.ts library remove-environment 01.jpg
npx tsx src/cli/index.ts prepare <dir>            # create a project (info/brief/storyboard only)
npx tsx src/cli/index.ts suggest-brief <id>       # draft a topic + opening from the library
npx tsx src/cli/index.ts generate-storyboard <id> # script only, no TTS/render; archives a version
npx tsx src/cli/index.ts generate <id>   # full pipeline (calls Claude if no storyboard)
npx tsx src/cli/index.ts render <id>     # re-render only: no Claude, no TTS
npx tsx src/cli/index.ts regenerate-content <id>  # discard storyboard, ask Claude again, then render
npx tsx src/cli/index.ts generate-all    # every project under runtime/jobs
npx tsx src/cli/index.ts validate <mp4>  # check an output file
npx tsx src/cli/index.ts publish-kit <id> # rewrite the YouTube listing, no re-render
npx tsx src/cli/index.ts schedule [--reset now]  # the rolling publication queue
npx tsx src/cli/index.ts youtube-auth    # one-time Google consent (opens a browser)
npx tsx src/cli/index.ts youtube-channel # which channel the stored token uploads to
npx tsx src/cli/index.ts youtube-logout  # forget it, to authorise a different channel
npx tsx src/cli/index.ts youtube-upload <id> [--privacy unlisted] [--thumbnail thumbnail-2.jpg]
npm run typecheck
npm run ui                               # local web UI (server/) - see below
```

Node 22 is required (`.nvmrc`); `sharp` refuses older versions and Remotion is
only validated on LTS. Verify changes by running the pipeline (`generate
--mock-tts --no-publish` is the fast loop - silent audio, real layout) and by
`npm run typecheck`.

The `tests/` directory predates the change from short vertical product videos to
long-form podcasts. It is not wired up - `vitest` is not a dependency and there
is no `test` script - and several files reference APIs that no longer exist.
Treat it as reference material, not as a suite to keep green.

## Local web UI

`npm run ui` starts a small Express server (`server/`, port `UI_PORT` or 4000)
that serves a plain HTML/JS page (`server/public/`, no build step, no framework)
for managing projects by hand instead of through the Drive folder dance. It is a
second front door onto the same `runtime/jobs/<id>` directories and the same CLI
commands above - not a separate backend or database. The shared library has its
own routes (`/api/library`, `/api/library/environments[/:filename]`, which shell
out to the `library ...` commands) and its own screen, reached from the top bar
rather than from inside a project. Every "heavy" action (`library
add-environments`, `suggest-brief`, `generate-storyboard`, `generate`) is a
spawned `tsx src/cli/index.ts ...` child process; the server only reads
`job.json`/`progress.json`/`.lock` directly off disk to report status, and owns
one small file the engine doesn't know about: `meta.json` (the UI's display name
for a project, since `job.json`'s schema is `strictObject`).

The UI is written in Vietnamese and the episodes it produces are in English.
That is deliberate rather than an oversight: the person operating the tool and
the audience of the videos are different people.

Two engine concepts exist only to support this UI and are otherwise inert:

- **`brief.json`** (`src/domain/brief.ts`) - the project's settings: the
  `{ context, hook }` free text a user types (or asks `suggest-brief` to draft),
  `targetMinutes`, the requested episode length, and `environments`, the
  backdrops this episode may draw on. An absent or empty `environments` means
  the whole library, which is what a new project gets and what the UI stores
  when every tile is selected - so a project does not silently freeze its
  shortlist the day someone uploads a better photograph. The text steers the prompt
  in `src/ai/prompts/generate-storyboard.ts`; `targetMinutes` sets the word
  budget the draft is measured against and overrides `VIDEO_TARGET_DURATION`.
- **Storyboard versions** (`src/pipeline/storyboard-store.ts`) - every
  `generate-storyboard`/`regenerate-content` run archives a timestamped copy
  under `runtime/jobs/<id>/storyboard-versions/`, on top of the single active
  `storyboard.json` the pipeline actually reads. The UI lists these so a
  regeneration is never destructive.

`.lock` (`src/pipeline/lock.ts`) marks a job directory as currently being
processed, purely so the UI (or a person) can tell a job is busy and run several
projects concurrently without two processes racing the same directory.

## The Drive workflow

`01_INPUT` -> `03_OUTPUT` under `$DRIVE_ROOT` (default `./workspace/AI-Shorts`).
A project folder there holds `info.json` / `brief.json` and no images - the
backdrops come from the shared library, which is imported separately with
`library add-environments`. Run these in order for each unprocessed project;
check the exit code after each.

1. List `$DRIVE_ROOT/01_INPUT`. A project with `job.json` at status `DONE` is
   already finished - skip it rather than rebuilding.
2. `prepare $DRIVE_ROOT/01_INPUT/<id>` - creates `runtime/jobs/<id>` and carries
   across info.json, brief.json and any hand-written storyboard.
3. Read the previews in `$LIBRARY_DIR/preview/environment`, **not** the
   originals. They are small on purpose.
4. `generate <id>`. This calls Claude for the storyboard if there is not one
   already, then does everything else itself. Expect it to take a while: writing
   the script, speaking ten minutes of it, and rendering are each minutes rather
   than seconds.
5. On success, copy `runtime/jobs/<id>/output/` to `$DRIVE_ROOT/03_OUTPUT/<id>/`.
   On failure, `$DRIVE_ROOT/99_ERROR/<id>/error.json` already explains why.

Source images are only ever read, and `library add-environments` copies rather
than moves, so a crash cannot cost the user their only copy of a photograph.

## Rules that are enforced in code, not by convention

Reading these before changing anything will save you a confusing afternoon.

**Length is checked, not requested.** A model asked for ten minutes returns two
and stops. `WORDS_PER_MINUTE` turns the requested minutes into a word budget,
the prompt decomposes that budget per scene, and `checkStoryboardStructure`
measures the returned script and rejects it with the shortfall named. That
number is *measured*, and measured on a real script rather than a sentence: a
short sample reads about twenty percent faster than an episode does, because the
pauses between sentences and paragraphs dominate the average. It tracks the
voice *and* the rate in `.env` together, and the voice moves it as much as the
rate does: on the same -20%, en-US-AriaNeural reads 139 wpm and
en-US-AnaNeural 120. Change either and
re-measure, or every episode quietly comes out the wrong length.

**The timeline is the only source of truth for timing.** Claude's
`scene.duration` is a hint and Remotion never sees it.
`src/pipeline/build-timeline.ts` derives every duration from measured audio, and
scenes tile the voice track exactly - total video length equals total audio
length. Do not "improve" this by letting a component compute seconds; that is
how captions drift.

**The narrator is always an English voice.** The service's multilingual voices
from other locales read English perfectly well, with their own colour; they were
auditioned and ruled out, so `isEnglishVoice` refuses a non-`en-` voice before
TTS runs rather than after a whole episode has been spoken in it.

**Narration is mandatory.** A job cannot reach DONE without it. Note that
Remotion writes an AAC track even for a composition with no audio, so the check
is on silence content, not stream presence.

**The frame size comes from configuration on every run, not from the
storyboard.** `VIDEO_ASPECT` decides between 1920x1080 and 1080x1920, and
`runPipeline` overwrites `storyboard.video.{width,height,fps}` from config
before building the timeline. Reading them from the file instead is wrong in a
way that reports success: the run picks up the new setting in its input hash,
spends a full render on it, and produces a video in the old shape. `style` is
left as the model chose it - that one *is* content.

**Layout is derived from the live frame, never from a constant.** Type sizes are
fractions of the frame's short edge (`theme.title.sizeRatio`), safe-area insets
are chosen by orientation (`safeAreaFor`), and `defaultFitFor` compares the
image's aspect to the frame's rather than naming shapes. A value tuned for 9:16
is wrong in 16:9 and vice versa, and the two shapes are both first-class here.

**CSS percentage padding resolves against width, not height.** At 9:16 that
makes every vertical inset about 56% of what it should be. Safe areas and
caption positions are computed in pixels from `useVideoConfig()` for this
reason.

**Never stretch an image.** `src/remotion/layout/fit.ts` returns explicit pixel
boxes from a single uniform scale. Percentage sizing on an `<img>` reintroduces
the bug immediately.

**The layer order in `SceneShell` is load-bearing.** backdrop -> scrim -> scene
title -> captions. The scrim is what keeps light type readable over a bright
sky; putting it over the text instead dims the only thing that had to stay
legible.

**Subtitles are bilingual, and the two lines are not the same kind of thing.**
The English line is word-timed from the TTS boundaries, so the word in the
narrator's mouth is the bright one; the Vietnamese line is the meaning of the
whole page, held for as long as the page is. There is no honest word-level
mapping between the two languages, and `splitTranslation` therefore divides
`scene.narrationVi` across a scene's pages by *proportion*, preferring sentence
boundaries. It is set smaller and dimmer deliberately: two lines competing at
equal weight is what makes a bilingual subtitle unreadable.

**Motion overlays are deterministic.** `MotionOverlay` seeds its particles from
an integer hash of the scene, never `Math.random()`, because the engine's whole
promise is that the same storyboard renders the same video. The layer sits above
the scrim (dust behind 40% black is invisible) and below the type (nothing may
drift across a word being read).

**A trailing space in .env does not survive.** `YOUTUBE_TITLE_PREFIX=[Eng + Vietsub] `
loses its space to dotenv, and every title comes out `[Eng + Vietsub]Title`. The
separator is therefore appended in `loadConfig` rather than trusted to the file,
which also means nobody has to know to quote the value.

**The publishing kit is generated, not written.** `src/pipeline/publish-kit.ts`
turns a finished render into `output/youtube.md` and `output/youtube.json`:
title and description from the model, chapters from the *timeline* (real frame
positions, in YouTube's own format, obeying its silent rules - first mark at
0:00, three minimum, ten seconds apart, or it ignores the list entirely), and
the music credit from `assets/music/credits.json`. The credit is machine-made
on purpose: it is a licence condition, and a model told to remember an
attribution will forget it on the episode nobody checks. Three cover frames are
rendered rather than one, because the opening title card is the obvious pick and
often not the best one.

**A stale schedule marker is caught up, never followed.** `src/publish/schedule.ts`
hands out publication slots spaced `SCHEDULE_INTERVAL_HOURS` apart. A marker
three days in the past means nobody has published for three days - not that
nine uploads are due at once - so it resets to now before the interval is
added. The slot is taken *before* the upload starts, so two uploads launched
together cannot claim the same one; a failed upload therefore costs a gap rather
than a collision. Reading the queue (`peekSlot`, `/api/schedule`) never consumes
a slot, or merely opening a project screen would push every later episode back.

**Uploads are serialised; renders are not.** Rendering is CPU-bound and the
machine can be trusted to schedule several. Uploading is bandwidth-bound and
cannot: fifteen episodes launched together are 1.8 GB competing for one uplink,
where every request crawls towards its timeout and a failure part-way through
wastes what was already sent. `runUpload` chains them through one promise, and
reports the caller's position so the UI can say "queued" rather than "started".

**Scheduling is offered in two places and must mean the same thing in both.**
An episode can be scheduled when it is uploaded by hand (the privacy control in
the publishing panel) or automatically after a render (the choice in the video
panel). They share one queue and one displayed time - `state.slot`, fetched
once - because two renderers asking the server separately is how they end up
naming times a minute apart and looking broken. Scheduling and an explicit
privacy are mutually exclusive at the route: YouTube requires a scheduled video
to be uploaded private, so sending both is asking for two different things.

**Uploading is never a side effect of rendering.** The CLI's `generate` does not
publish, whatever `meta.json` says: someone running it in a terminal must not
discover afterwards that a video went out. The chaining lives in the UI's own
runner, which is the layer where a person clicked a button that said so.

**Nothing names the target channel, so the engine records it.** `videos.insert`
uploads to whichever channel the credentials belong to - chosen once on Google's
consent screen and invisible from then on. On an account with a personal channel
and two brand channels, uploading to the wrong one is easy and is discovered on
the channel. So `authorize` asks `channels.list?mine=true` immediately after
consent and stores the answer beside the refresh token, the CLI and the UI both
name it, and switching means `youtube-logout` then `youtube-auth`.

**The YouTube upload cannot publish publicly, and that is Google's rule.**
`src/publish/youtube.ts` uploads with a resumable session and sets the title,
description, tags and category from `output/youtube.json` - but Google forces
uploads from an API project that has not passed its compliance audit to
`private`, whatever `status.privacyStatus` asks for. The code reports what
YouTube actually set rather than what it requested, because the alternative is
someone believing an episode went public when it did not. Setting a cover image
is a separate call needing a phone-verified channel, so its failure is reported
and never throws - a finished hundred-megabyte upload must not be reported as a
failure because of the picture on it.

**Music is a folder, not a setting.** Drop a track in `assets/music/` and the
next render has a bed; empty the folder and it does not. `MUSIC_FILE` picks a
specific one, and naming a file that is not there fails the run rather than
rendering a silent episode nobody asked for. The ducking in
`remotion/audio/ducking.ts` reads the caption timings, so the music drops under
speech and comes back in the gaps without anyone authoring an envelope.

**The vocabulary is short on purpose.** Two transitions, eight camera moves, one
effect. Every one of them is slow. The short-form engine this grew out of also
had shake, flash, zoom-punch and slide-in text - all of which are impacts, and
an impact in a video someone is falling asleep to is a defect. They were removed
from the whitelists rather than left unused: a value the model can choose is a
value it will eventually choose.

**Nothing may hold a `delayRender()` open for the life of the page.** The
timeout is measured from when the *page* opened, not from when the handle was
created, so a handle Remotion still believes is open kills any render that runs
longer than `timeoutInMilliseconds` - whatever the page is actually doing. A
module-level `delayRender` around the font load did exactly that: it failed a
seven-minute episode twice and an eight-minute one three times at
`not cleared after 298000ms`, while instrumentation showed every page clearing
its handle within milliseconds of opening. Fonts do not need it -
`@remotion/renderer` awaits `document.fonts.ready` before capturing *every*
frame - so `src/remotion/fonts.ts` registers an ordinary `@font-face` and holds
no handle at all. The face is embedded as a `data:` URI by the webpack rule in
`src/video/bundler.ts` (mirrored in `remotion.config.ts`), and only weight 400
is loaded, because that is the only weight any theme uses.

**A `.lock` is only believed while its process is alive.** `readLock` checks the
pid with signal 0 and sweeps the file when nobody owns it. A run that is killed
never removes its own lock, and a lock nobody owns used to pin a project on
"đang tạo video" in the UI permanently, with no button that would clear it.

**Sharp runs at import, not at render.** `library add-environments` normalises
and writes previews once; a render only reads what is on disk (`readLibrary`).
Reprocessing per run would make every video slower as the shared library grows,
for no gain. Everything is encoded as JPEG, and PNG sources are flattened first
so a transparent input does not come out with black holes in it.

**The fact guard only applies when there is an info.json.** That is a deliberate
narrowing (`src/ai/fact-guard.ts` explains it at length). A podcast script is
prose - "it was nineteen sixty-nine", "give it about ten minutes" - and
rejecting every figure in prose rejects correct writing on almost every line. A
project that ships an info.json is declaring that this episode makes checkable
claims and that these are the only ones it may make; a project without one is
telling a story. The guard reports `applied: false` rather than standing down
silently.

## Where things live

```
src/domain/      types + zod schemas; scene/animation/effect whitelists
src/ai/          Claude provider, prompts, fact guard
src/tts/         Edge TTS (via scripts/edge_tts_synth.py), mock, alignment
src/image/       Sharp processing, previews, the shared library
src/pipeline/    the deterministic pipeline, timeline builder, job state
src/video/       bundling, asset staging, rendering, ffprobe, validation
src/remotion/    the single ShortVideo composition, scenes, layers, effects, themes
server/          local web UI: Express routes + plain HTML/JS (no build step)
runtime/         library (shared backdrops), jobs, cache, logs (gitignored)
```

## Known fragility

Edge TTS is an unofficial Microsoft endpoint and periodically starts rejecting
clients (the `Sec-MS-GEC` token). Because narration is mandatory, this is the
pipeline's single point of failure, and one call now carries a whole ten-minute
episode. Mitigations already in place: the TTS cache means unchanged text never
re-calls it, `--mock-tts` keeps the whole pipeline runnable offline, and
`TTSProvider` is an interface so Azure - which offers the same neural voices
under a supported API - can be dropped in without changing how anything sounds.

Anything rendered with `--mock-tts` is silent and gets stamped `devMock: true`
in `job.json`. It is for development only and must not be published.
