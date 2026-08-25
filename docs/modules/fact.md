# Auto Fact Shorts Generator

Turns a sentence about a fact into a 30-60 second 9:16 MP4 with Vietnamese
narration — read by a northern Vietnamese man, shot against photographs the
engine finds itself, built to be published to YouTube Shorts on a
fixed schedule.

## What this repo is

A Node/TypeScript CLI (the "Video Engine") plus a Remotion composition. The
engine contains no AI: given a storyboard it fetches, renders and publishes
without asking a model anything. Claude's only job is writing the video.

Nothing here generates imagery or music. **Nobody uploads pictures either.**
The storyboard names two to four English search phrases, and the engine finds
photographs for them on Openverse, downloads them, crops them to the frame and
draws the photographer's name in the corner. `$STOCK_DIR` (default
`runtime/stock`) is a cache of what has been downloaded, shared by every
project - not a library anyone curates. Deleting it costs only the time to
fetch again.

A scene is exactly one backdrop plus one or two spoken sentences, and the
model's creative work is knowing a fact worth thirty seconds of someone's
attention, saying it in Vietnamese that sounds like a person talking, and
describing - in words, before it has seen anything - what that part of it
should be shot against.

Three layers, and the boundaries are load-bearing:

| Layer | Does | Never does |
|---|---|---|
| Claude Code | chooses the fact, writes the Vietnamese script, names the image queries, picks the camera moves and the style, calls the CLI, moves files to and from Drive | renders, synthesises speech, computes timings, writes JSX, downloads or generates images |
| Video Engine | validates, searches for and processes photographs, calls TTS, computes the timeline, renders, validates output, uploads | calls Claude, knows Google Drive exists |
| Remotion | timeline to pixels | calls Claude or TTS, fetches anything, decides how long a scene is |

## Commands

```bash
npm run setup:python                     # one-time: venv + edge-tts
npm run tts:voices                       # every Vietnamese voice the service has
npm run tts:sample                       # render a real script in each, into runtime/voice-samples
npm run tts:pace                         # measure words-per-minute for the configured voice+rate
npx tsx src/cli/index.ts stock-search "deep sea jellyfish"  # what a query would find
npx tsx src/cli/index.ts prepare <dir>            # create a project (info/brief/storyboard only)
npx tsx src/cli/index.ts suggest-brief <id> [--topic "con chuột"]  # ask for a fact
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
npx tsx src/cli/index.ts youtube-upload-all      # every finished video into the hourly queue
npm run typecheck
npm run ui                               # local web UI (server/) - see below
```

Node 22 is required (`.nvmrc`); `sharp` refuses older versions and Remotion is
only validated on LTS. Verify changes by running the pipeline (`generate
--mock-tts --no-publish` is the fast loop - silent audio, real layout, about
fifty seconds end to end) and by `npm run typecheck`.

The `tests/` directory predates both this change and the one before it. It is
not wired up - `vitest` is not a dependency and there is no `test` script - and
several files reference APIs that no longer exist. Treat it as reference
material, not as a suite to keep green.

## What changed when this stopped being a podcast tool

This repo was a 5-10 minute English podcast generator, and before that a
short-form product-video generator. Comments throughout still refer to those,
usually because the reasoning is worth keeping - a constant that had to be
retuned is more informative with the old value beside it. What is *current* is
always the code and this file.

The four changes that touch everything else:

- **Vietnamese, not English.** The narration, the subtitles, the prompt and the
  feedback echoed back to the model on a retry are all Vietnamese.
  `isVietnameseVoice` refuses a non-`vi-` voice before TTS runs.
- **Portrait, not landscape.** `VIDEO_ASPECT` defaults to `portrait`, and a
  Short must be 9:16 or YouTube will not treat it as one.
- **Seconds, not minutes.** `brief.targetSeconds` (15-90), and
  `VIDEO_TARGET_DURATION` in seconds with a default of 45.
- **One subtitle line, not two.** The bilingual English/Vietnamese pair is gone,
  along with `scene.narrationVi` and `CaptionPage.translation`.
- **Searched photographs, not an uploaded library.** `scene.environment` (a
  filename) became `scene.imageQuery` (a search phrase, in English), the
  storyboard gained `content.imageQueries`, and `src/image/library.ts` and the
  `library` CLI group are gone. See "Where the pictures come from" below.

A storyboard written by the podcast version does not parse against the current
schema - `narrationVi` is an unrecognised key in a `strictObject`, and titles
and narration are now shorter. Old projects under `runtime/jobs` are inert
rather than broken: they render nothing until their storyboard is regenerated.

## Local web UI

`npm run ui` starts a small Express server (`server/`, port `UI_PORT` or 4000)
that serves a plain HTML/JS page (`server/public/`, no build step, no framework)
for managing projects by hand instead of through the Drive folder dance. It is a
second front door onto the same `runtime/jobs/<id>` directories and the same CLI
commands above - not a separate backend or database. There is no library screen
any more: it, its routes and the per-project image picker were all removed when
the pictures stopped being uploaded. Every "heavy"
action (`suggest-brief`, `generate-storyboard`, `generate`) is a spawned
`tsx src/cli/index.ts ...` child process; the server only reads
`job.json`/`progress.json`/`.lock` directly off disk to report status, and owns
one small file the engine doesn't know about: `meta.json` (the UI's display name
for a project, since `job.json`'s schema is `strictObject`).

The UI is written in Vietnamese, and so are the videos. That was not true of the
podcast version, where the operator and the audience were different people; here
they are the same person and the interface matches the output.

Two engine concepts exist only to support this UI and are otherwise inert:

- **`brief.json`** (`src/domain/brief.ts`) - the project's settings: the
  `{ context, hook }` free text a user types (or asks `suggest-brief` to draft),
  and `targetSeconds`, the requested length. The text steers the prompt in
  `src/ai/prompts/generate-storyboard.ts`; `targetSeconds` sets the word budget
  the draft is measured against and overrides `VIDEO_TARGET_DURATION`.
- **Storyboard versions** (`src/pipeline/storyboard-store.ts`) - every
  `generate-storyboard`/`regenerate-content` run archives a timestamped copy
  under `runtime/jobs/<id>/storyboard-versions/`, on top of the single active
  `storyboard.json` the pipeline actually reads. The UI lists these so a
  regeneration is never destructive.

`.lock` (`src/pipeline/lock.ts`) marks a job directory as currently being
processed, purely so the UI (or a person) can tell a job is busy and run several
projects concurrently without two processes racing the same directory.

**The project screen is the pipeline, and nothing else.** It carries the row of
steps, the button that runs them, and the one setting that changes what the
button does. Everything else - the brief, the script, the images, the voice, the
finished video - belongs to a step, and opens in that step's own dialog when the
step is clicked. It used to sit underneath as permanent sections, which meant
the script appeared twice on one screen and you scrolled past four things to
reach the one you had just clicked on.

The brief is the interesting case: it is a *form* rather than a report, and it
still belongs to the "Ý tưởng" step, because that step's output is a context and
a hook whether Claude wrote them or somebody typed them.

## The Drive workflow

`01_INPUT` -> `03_OUTPUT` under `$DRIVE_ROOT` (default `./workspace/AI-Shorts`).
A project folder there holds `info.json` / `brief.json` and no images at all.
Run these in order for each unprocessed project; check the exit code after each.

1. List `$DRIVE_ROOT/01_INPUT`. A project with `job.json` at status `DONE` is
   already finished - skip it rather than rebuilding.
2. `prepare $DRIVE_ROOT/01_INPUT/<id>` - creates `runtime/jobs/<id>` and carries
   across info.json, brief.json and any hand-written storyboard.
3. `generate <id>`. This calls Claude for the storyboard if there is not one
   already, then does everything else itself - including finding the
   photographs. A short takes about a minute and a half all in.
4. On success, copy `runtime/jobs/<id>/output/` to `$DRIVE_ROOT/03_OUTPUT/<id>/`.
   On failure, `$DRIVE_ROOT/99_ERROR/<id>/error.json` already explains why.

There is nothing to upload at any point, and no image in a project folder is
ever read - `prepare` warns about any it finds rather than silently ignoring
them.

## Rules that are enforced in code, not by convention

Reading these before changing anything will save you a confusing afternoon.

**Sixty seconds is a cliff, not a preference.** Past it YouTube stops serving
the upload in the Shorts feed, so a video that overruns is not a long short -
it is an ordinary video nobody is shown. `WORDS_PER_MINUTE` turns the requested
seconds into a word budget, the prompt decomposes that budget per scene, and
`checkStoryboardStructure` measures the returned script and rejects it *in both
directions* - the overrun tolerance is 1.15, far tighter than the long-form
version's 1.6, because here overrunning is the expensive failure rather than a
preference.

**The narration is one continuous explanation, and the scenes are cuts inside
it.** This is the rule that most shapes how a finished video sounds. The voice
pauses noticeably at a full stop and barely at a comma, so a script written as
one short sentence per scene comes out as ten separate statements with a silence
between each - the audio track is continuous, but it *sounds* chopped, and no
setting fixes that because the problem is punctuation. The prompt therefore asks
for linked clauses ("nên", "vì", "mà", "rồi") and explicitly permits a sentence
to run across a scene boundary: the picture changes while the narrator keeps
talking, which is what ordinary film editing does. `buildTimeline` never needed
scenes to align with sentences - it aligns them to measured word timings - so
nothing downstream cares.

**`WORDS_PER_MINUTE` is measured, and punctuation moves it more than the rate
does.** A "word" here is a whitespace token, which in Vietnamese is a syllable.
The same voice at the same rate reads a chopped script (ten full stops) at 207
wpm and a flowing one (five) at 251 - a 21% swing that has nothing to do with
`TTS_RATE`. So this constant tracks the voice, the rate, *and* the style the
prompt asks for; when the prompt changed from statements to explanation, the
constant had to move with it or every video would have come out a third short.
Pitch is the exception and can be retuned freely: the service shifts it without
resampling, so duration is unaffected. `npm run tts:pace <script.txt>` does the
measurement, on a real script rather than a passage of prose.

**The timeline is the only source of truth for timing.** Claude's
`scene.duration` is a hint and Remotion never sees it.
`src/pipeline/build-timeline.ts` derives every duration from measured audio, and
scenes tile the voice track exactly - total video length equals total audio
length. Do not "improve" this by letting a component compute seconds; that is
how captions drift.

**The narrator runs locally, on VieNeu-TTS.** `TTS_ENGINE` defaults to `vieneu`
(`src/tts/vieneu.provider.ts` + `scripts/vieneu_synth.py`), which is a model on
disk rather than a service: nineteen named voices across northern, central and
southern accents, no network once it is downloaded, and no dependence on the
unofficial endpoint Edge TTS reaches. The names do not tell you the accent -
Thanh Bình is northern and Thái Sơn is southern, both described only as
storytelling voices - so `npm run tts:voices` prints the labels and
`npm run tts:sample` renders them.

`EdgeTTSProvider` is kept, not deleted. It needs no model download and it is the
only engine that reports *real* per-word boundaries, which makes it the fallback
worth having; but its Vietnamese locale holds exactly two voices, both northern,
and `isVietnameseVoice` still guards it - a multilingual voice from another
locale will read Vietnamese text and come out as a foreigner reading
phonetically.

**VieNeu reports no word timings, so they are reconstructed.** Captions and
scene cuts are both built on those timings, and the engine returns only a
waveform. `scripts/vieneu_synth.py` therefore synthesises **one sentence at a
time** and rejoins them with the same 0.18s gap VieNeu uses internally, so
every sentence's duration is measured rather than guessed and the audio is what
a single call would have produced anyway. Words inside a sentence are laid
across its span by syllable weight. That is the right way round: a caption page
breaks at a sentence or a pause, which is now exact, and a word highlight being
a few tens of milliseconds out inside a page is invisible.

**Speed is a time stretch applied after synthesis, not a rate.** `TTS_SPEED`
runs the finished track through ffmpeg's `atempo` (`src/video/ffmpeg.ts`), which
changes duration without moving pitch - a resample would turn the narrator into
a chipmunk. It lives outside the engines because they disagree: Edge takes a
rate during synthesis, VieNeu takes none at all. The word timings are divided by
the same factor, which is safe precisely because `atempo` is linear.

**Non-verbal cues are the only sound effects.** VieNeu speaks `[cười]`,
`[thở dài]` and `[hắng giọng]` as reactions rather than reading them out, and
the prompt asks for one per video. They are stripped from the word timings in
Python, so they never reach a subtitle. There is no separate effects track: an
SFX library would need its own licensing and its own timing, and a laugh in the
right place does more for a fact short than a whoosh ever would.

**Narration is mandatory.** A job cannot reach DONE without it. Note that
Remotion writes an AAC track even for a composition with no audio, so the check
is on silence content, not stream presence.

**The frame size comes from configuration on every run, not from the
storyboard.** `VIDEO_ASPECT` decides between 1080x1920 and 1920x1080, and
`runPipeline` overwrites `storyboard.video.{width,height,fps}` from config
before building the timeline. Reading them from the file instead is wrong in a
way that reports success: the run picks up the new setting in its input hash,
spends a full render on it, and produces a video in the old shape - which for a
Short means an upload YouTube will not serve as a Short. `style` is left as the
model chose it - that one *is* content.

**Layout is derived from the live frame, never from a constant.** Type sizes are
fractions of the frame's short edge (`theme.title.sizeRatio`), safe-area insets
are chosen by orientation (`safeAreaFor`), and `defaultFitFor` compares the
image's aspect to the frame's rather than naming shapes. A value tuned for 9:16
is wrong in 16:9 and vice versa, and although portrait is now the default shape,
both remain first-class.

**A backdrop is cropped to fill, not letterboxed.** `COVER_TOLERANCE` in
`remotion/layout/fit.ts` is 4, not the 1.35 that made sense when the image was a
product that could not be cropped. At 1.35 an ordinary 16:9 photograph in a
vertical frame went to the blurred-pad treatment, and since most photographs are
landscape, *every scene of every video* came out as a band of picture with
blurred grey above and below it. These are backdrops; losing two thirds of the
width costs nothing and full-bleed is what the format looks like. The search
side helps too: `COMFORTABLE_ASPECT` ranks 4:3-and-squarer results first, so a
pool with any vertical photographs in it uses those before it crops a wide one.

**CSS percentage padding resolves against width, not height.** At 9:16 that
makes every vertical inset about 56% of what it should be. Safe areas and
caption positions are computed in pixels from `useVideoConfig()` for this
reason.

**Never stretch an image.** `src/remotion/layout/fit.ts` returns explicit pixel
boxes from a single uniform scale. Percentage sizing on an `<img>` reintroduces
the bug immediately.

**The layer order in `SceneShell` is load-bearing.** backdrop -> scrim -> motion
overlay -> scene title -> captions. The scrim is what keeps light type readable
over a bright sky; putting it over the text instead dims the only thing that had
to stay legible. It reaches to 80% of the frame height rather than 62%, because
the subtitle now sits a fifth of the way up and wraps to two large lines.

**The project name is what `suggest-brief` is steered by.** It is the only
thing a person types before pressing the button, so it is the only signal of
what they wanted. The UI passes `--topic` with the *display* name, because the
id is a slug and "con chuột" is stored as "con-chuot" with the tones gone; from
a terminal the un-slugged id is used instead, which reads well enough. The
prompt treats it as a hint rather than a constraint - a project called "Dự án 2"
carries no subject, and insisting on one would produce a fact about the number
two, so the model is told to ignore a name that means nothing.

**The closing line asks for the subscription, and the channel name comes from
configuration.** `CHANNEL_NAME` is branding rather than content, so it is passed
into the prompt the way `YOUTUBE_TITLE_PREFIX` is passed into the publishing
kit: the model writes the best closing line it can and the channel decides whose
name goes in it. Empty means no call to subscribe at all. The prompt carries
three *varied* examples rather than one, which is not decoration - with a single
example the model reproduced it verbatim in every video.

**The subtitle sits high, and it is the video.** `theme.caption.bottomRatio` is
0.2 - much higher than a subtitle usually sits - because the Shorts player draws
the channel name, title and description over the bottom of the frame, and
anything under those is unreadable on the only platform this renders for. The
type is large and bold for a related reason: a Short is played muted more often
than not, and on a muted play the subtitle is the whole video. There is no plate
behind it; a rectangle appearing and disappearing every second and a half is the
most distracting thing that could be in the frame.

**Caption pages break where the voice breaks.** A page ends at a full stop or at
any gap over 260ms, which is what makes the line change exactly where the
speaker breathes. `MAX_WORDS_PER_PAGE` is a backstop for a clause with no pause
in it, and when it fires the cut is made at the last comma rather than at the
twelfth word - "mà vi" / "khuẩn thì cần nước" is a subtitle that says nothing on
either line.

**Motion is sized to the scene, and the scene is now five seconds.** The theme
amplitudes are roughly three times the long-form ones: eight percent of push-in
across thirty seconds is invisible across five, and an invisible camera move on
a still photograph in a vertical feed reads as a video that has frozen.
`MotionOverlay` still seeds its particles from an integer hash of the scene,
never `Math.random()`, because the engine's whole promise is that the same
storyboard renders the same video.

**A trailing space in .env does not survive.** dotenv strips it, so
`YOUTUBE_TITLE_PREFIX=[Fact] ` loses its space and every title comes out
`[Fact]Title`. The separator is therefore appended in `loadConfig` rather than
trusted to the file, which also means nobody has to know to quote the value.
The prefix defaults to empty here: a Short's title is shown in a cramped
two-line overlay, and every character a prefix spends is one the hook loses.

**The publishing kit is generated, not written.** `src/pipeline/publish-kit.ts`
turns a finished render into `output/youtube.md` and `output/youtube.json`:
title and description from the model, the `#shorts` hashtag line from the tags,
and the music credit from `assets/music/credits.json`. Both of the generated
parts are machine-made for the same reason: they have to be on every single
video, and a model told to remember an attribution will forget it on the one
nobody checks. Chapters are *not* generated below `MIN_CHAPTERABLE_SECONDS`
(120): a 45-second video could technically carry three ten-second chapters, and
it would eat the only three lines of description anyone reads. Three cover
frames are rendered rather than one - the cover matters less for a Short, since
the feed plays the video itself, but it is what the channel's Shorts tab shows.

**A stale schedule marker is caught up, never followed.** `src/publish/schedule.ts`
hands out publication slots spaced `SCHEDULE_INTERVAL_HOURS` apart - two hours
by default, twelve videos a day. A marker three days in
the past means nobody has published for three days, not that thirty-six uploads
are due at once, so it resets to now before the interval is added. At this interval it
matters far more than it did at eight-hourly: a laptop closed over a weekend
accumulates a large backlog of notional slots. The slot is taken
*before* the upload starts, so two uploads launched together cannot claim the
same one; a failed upload therefore costs a gap rather than a collision. Reading
the queue (`peekSlot`, `/api/schedule`) never consumes a slot, or merely opening
a project screen would push every later video back.

**Uploads are serialised; renders are not.** Rendering is CPU-bound and the
machine can be trusted to schedule several. Uploading is bandwidth-bound and
cannot: a day of shorts launched together is several hundred megabytes competing
for one uplink, where every request crawls towards its timeout and a failure
part-way through wastes what was already sent. `runUpload` chains them through
one promise and reports the caller's position so the UI can say "queued";
`youtube-upload-all` does the same thing from the CLI, oldest render first, and
skips anything whose `output/youtube-upload.json` says it is already up.

**Scheduling is offered in three places and must mean the same thing in all
three.** A video can be scheduled when it is uploaded by hand (the privacy
control in the publishing panel), automatically after a render (the choice in
the video panel), or in bulk (`youtube-upload-all`). They share one queue and
one displayed time - `state.slot`, fetched once - because two renderers asking
the server separately is how they end up naming times a minute apart and looking
broken. Scheduling and an explicit privacy are mutually exclusive at the route:
YouTube requires a scheduled video to be uploaded private, so sending both is
asking for two different things.

**Uploading is never a side effect of rendering.** The CLI's `generate` does not
publish, whatever `meta.json` says: someone running it in a terminal must not
discover afterwards that a video went out. The chaining lives in the UI's own
runner, which is the layer where a person clicked a button that said so, and in
`youtube-upload-all`, which is a command whose entire name is what it does.

**A token in a "Testing" project dies after seven days, silently.** Google
issues short-lived refresh tokens to an OAuth consent screen that has not been
published, and nothing announces the expiry - the first sign is an upload being
refused, which on an unattended hourly channel is a day of nothing going out.
`tokenAgeDays` is checked before every upload and by `youtube-channel`, and
warns from day five so there are two days to act. It cannot know whether the
rule applies, because the API does not expose the publishing status, so the
message says "if" rather than guessing. Publishing the app removes the expiry
entirely, but Google requires a public HTTPS home page and privacy policy to
allow it - `docs/` holds both, ready to host. Note the asymmetry that confuses
people: the *redirect URI* may be `http://localhost:4180`, because a loopback
redirect is explicitly allowed for a desktop client; the *home page* may not,
because Google fetches it.

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
someone believing a video went public when it did not. Setting a cover image is
a separate call needing a phone-verified channel, so its failure is reported and
never throws.

**Nothing tells YouTube a video is a Short, so the length is defended in three
places.** There is no API field for it - the platform decides from the 9:16
frame and the sub-sixty-second length, and `#shorts` in the description is a
discovery aid rather than the mechanism. Crossing `SHORTS_MAX_SECONDS` is
therefore *silent*: the upload succeeds, the video appears on the channel, and
it is simply never served in the Shorts feed. Worse, it is unfixable after the
fact - a video YouTube has classified as ordinary does not become a Short by
being shortened later, it has to be deleted and re-uploaded.

So: the requested length is **clamped** before the prompt sees it
(`clampToShorts`), because a script is accepted up to `OVERRUN_TOLERANCE` over
its budget and sixty seconds plus that allowance is sixty-nine; the render
**warns** when the finished file crosses the ceiling, rather than failing, since
the video is still perfectly good and the Claude call is already spent; and the
upload **refuses** it, before taking a schedule slot, unless `--allow-long` says
the operator meant it. A landscape render is exempt at every step - it was never
going to be a Short and nobody uploading one thinks it is.

**Music is a folder, not a setting.** Drop a track in `assets/music/` and the
next render has a bed; empty the folder and it does not. `MUSIC_FILE` picks a
specific one, and naming a file that is not there fails the run rather than
rendering a silent video nobody asked for. The ducking in
`remotion/audio/ducking.ts` reads the caption timings, so the music drops under
speech and comes back in the gaps without anyone authoring an envelope.

**The vocabulary is short on purpose.** Two transitions, eight camera moves, one
effect, four overlays. The list is the same one the podcast version used, but
the reason has changed: there, a jolt would wake someone falling asleep; here,
the video already cuts every four or five seconds, and adding shake, flash and
punch on top of that pace produces something nobody can read the subtitles of.
They were removed from the whitelists rather than left unused: a value the model
can choose is a value it will eventually choose.

**Nothing may hold a `delayRender()` open for the life of the page.** The
timeout is measured from when the *page* opened, not from when the handle was
created, so a handle Remotion still believes is open kills any render that runs
longer than `timeoutInMilliseconds` - whatever the page is actually doing. A
module-level `delayRender` around the font load did exactly that on the
long-form videos. Fonts do not need it - `@remotion/renderer` awaits
`document.fonts.ready` before capturing *every* frame - so `src/remotion/fonts.ts`
registers an ordinary `@font-face` and holds no handle at all. The face is
embedded as a `data:` URI by the webpack rule in `src/video/bundler.ts`
(mirrored in `remotion.config.ts`), and only weight 400 is loaded, because that
is the only weight any theme uses.

**A `.lock` is only believed while its process is alive.** `readLock` checks the
pid with signal 0 and sweeps the file when nobody owns it. A run that is killed
never removes its own lock, and a lock nobody owns used to pin a project on
"đang tạo video" in the UI permanently, with no button that would clear it.

**Where the pictures come from, and the four rules a source has to satisfy.**
`src/image/stock/` searches Openverse, the openly-licensed image search run by
WordPress. It was chosen over Pexels, Unsplash and Pixabay for one reason that
outweighed image quality: it needs no API key, and a tool whose whole purpose is
removing a manual step should not open with a signup. The rules, all enforced in
`openverse.provider.ts`, are: the licence must allow commercial use *and*
modification; ShareAlike is excluded as well, because a video built from a BY-SA
photograph arguably has to be BY-SA itself and that is not a pipeline's decision
to make; the picture must be at least `MIN_IMAGE_EDGE` (1600px) on its short
edge, because a backdrop is cropped to fill and then pushed in another twenty
percent; and the provider must name a creator, because the credit is drawn on
every frame. `license=cc0,pdm,by` is that policy expressed as a query parameter
and must not be widened casually.

**The rate limit is why a storyboard names image queries rather than images.**
Anonymous Openverse allows 20 searches a minute and **200 a day**. One search
per scene would be nine a video and would blow the budget before noon; two to
four per video (`MIN_IMAGE_QUERIES`/`MAX_IMAGE_QUERIES`) is about a hundred a
day for an hourly channel. Each search returns a pool of twelve candidates and
each scene takes its own from that pool, so scenes sharing a query still show
different photographs. There is a second anonymous limit worth knowing because
it lies about itself: `page_size` may not exceed 20, and asking for more returns
**401**, which reads as a credentials problem on a client that deliberately has
no credentials.

**Relevance is defended in four places, because no single one is enough.** The
first videos cut from a photograph of a hippo to an eighteenth-century engraving
of one, and from a rodent to a computer mouse. Each has a different cause and a
different fix:

1. **`STOCK_SOURCES`** keeps the search inside providers that hold photographs.
   Wikimedia is 88 of Openverse's ~100 million images and most of what it holds
   for a natural-history subject is museum digitisation, so an unrestricted
   search for "rodent teeth" returns a dire wolf skull. This is the single most
   effective control here.
2. **`isArtwork`** catches the reproductions that survive that - rawpixel hosts
   both modern stock and digitised plates, and the plates give themselves away
   in their title (`<div class='fn'>`, "Top left, rat; top right") or in their
   tags ("engravings", "art", "cartoon"). Tags are the more reliable half: a
   photograph is tagged with concrete nouns, a plate with its medium.
3. **`relevance`** ranks what is left by how much of the query the picture's own
   title and tags account for. This replaced a sort on aspect ratio alone, which
   was exactly backwards - a badly cropped hippo is still a hippo, a
   well-framed impala is not.
4. **The prompt** writes queries that can succeed at all: a subject noun plus at
   most one disambiguating word. Every extra word collapses the result count
   ("hamster" 16, "mouse rodent" 6, "rat gnawing wood" 0), and a query that
   finds nothing is precisely when a scene has to borrow a picture of something
   else. English homonyms get their own warning, because "white mouse" returns
   computer mice.

**A thin query is widened, but its results rank behind the video's other
queries.** `resolveSceneImages` tries four tiers: the scene's own pool, then a
sibling query's, then its own broadened pool, then the generic fallback. The
order is the argument - a mouse from a sibling query beats a dog from "pet",
which is what the previous ordering produced when it appended widened results to
the same pool.

**A second Claude call looks at the photographs, because nothing before it
can.** Every stage above reasons about *words* - the query, the title, the tags
- and a picture tagged "mouse" is a picture tagged "mouse" whether it shows a
field mouse or a computer accessory. That is exactly how a search for "white
mouse" filled four scenes of a rodent video with office desks, and how "rodent
teeth" returned a dire wolf skull: in words, both were precisely what was asked
for.

`review-images.ts` downloads the candidates' **thumbnails** - 20-50KB each,
served from Openverse's own endpoint, and measured to carry no rate-limit
headers and to leave the search counter untouched - hands them to the model with
the script beside them, and takes back a `sceneId -> filename` mapping. It is
matched on filename rather than on the internal key, because the filename is
what the model was shown and can copy without inventing.

It is advisory in every direction. A scene the review skips, a filename it makes
up, a candidate it names twice, a call that times out: each falls through to the
automatic tiers exactly as before. Losing the review costs relevance; depending
on it would cost the job, after a script, a search and a round of downloads have
already been paid for. `IMAGE_REVIEW=off` turns it off for a Claude call and
about a minute per video.

Note what it is deliberately *not* offered: the widened pools. A widened pool
exists precisely because its query failed, so putting a photograph of a dog in
front of the model invites the mistake the pass exists to prevent.

**Everything downloaded is cached, and a failed candidate is never fatal.**
`runtime/stock/` holds the search results and the processed JPEGs, keyed by
query and by image id, so a re-render costs no searches and no downloads.
Choosing and downloading are interleaved rather than done in two passes: a link
rots or a server refuses often enough that a two-pass version failed jobs which
had already paid for a Claude call and a round of speech. A candidate that fails
is skipped, marked used so the next scene does not retry it, and the next one is
tried. Sources are also capped at `MAX_SOURCE_EDGE` (8000px) - Openverse indexes
observatory and museum scans, and a 16823x16823 Hubble mosaic came back for
"ocean deep blue" weighing 162MB.

**The photo credit on screen is a licence condition, not decoration.**
`ImageCredit` draws "photographer · CC0" in the top right of every scene, which
is the only region of a vertical frame a viewer never has to read: the bottom
fifth is the Shorts overlay, the band above it is the subtitle, the lower right
is the button column, the top left is where a scene title goes. The publishing
kit repeats it in writing, but lists only the CC BY images - a CC0 photograph
imposes no obligation, and nine lines of URLs would push everything worth
reading below the fold.

**The fact guard does not check whether facts are true.** That is worth being
clear about in a repository whose videos are called facts. `src/ai/fact-guard.ts`
checks whether a *commercial* claim was invented - this price, this warranty,
this certification, or none - and it only runs when the project ships an
info.json. A fact script is full of correct figures ("khoảng ba nghìn năm") that
no info.json will ever list, so applying it everywhere would reject correct
writing on almost every line, and a guard that fires constantly on good output
is a guard people turn off. Truthfulness in a fact video is fought for in the
prompt, at length, and by whoever reads the script before it is published. The
guard reports `applied: false` rather than standing down silently.

## Where things live

```
src/domain/      types + zod schemas; scene/animation/effect whitelists
src/ai/          Claude provider, prompts (Vietnamese), fact guard
src/tts/         Edge TTS (via scripts/edge_tts_synth.py), mock, alignment
src/image/       stock/ = image search, download, Sharp normalisation, credits
src/pipeline/    the deterministic pipeline, timeline builder, job state
src/publish/     YouTube upload, the hourly publication queue
src/video/       bundling, asset staging, rendering, ffprobe, validation
src/remotion/    the single ShortVideo composition, scenes, layers, effects, themes
server/          local web UI: Express routes + plain HTML/JS (no build step)
scripts/         edge-tts bridge, voice sampler, the words-per-minute measurement
runtime/         stock (downloaded photographs), jobs, cache, logs (gitignored)
```

## Known fragility

Edge TTS is an unofficial Microsoft endpoint and periodically starts rejecting
clients (the `Sec-MS-GEC` token). Because narration is mandatory, this is the
pipeline's single point of failure. Mitigations already in place: the TTS cache
means unchanged text never re-calls it, `--mock-tts` keeps the whole pipeline
runnable offline, and `TTSProvider` is an interface so Azure - which offers the
same neural voices under a supported API - can be dropped in without changing
how anything sounds. At a video an hour the exposure is different from the
long-form version's: a call carries forty-five seconds rather than ten minutes,
but there are twenty-four of them a day.

Anything rendered with `--mock-tts` is silent and gets stamped `devMock: true`
in `job.json`. It is for development only and must not be published -
`youtube-upload-all` skips it for exactly that reason.
