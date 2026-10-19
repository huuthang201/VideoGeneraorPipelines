# Video Generator Pipelines

Three pipelines and four channels in one engine.

| | **Podcast** | **Fact Shorts** | **Não Có Vấn Đề** | **Ủa Thật À? dài** |
|---|---|---|---|---|
| Output | 5-10 minute MP4 | 28-32 second MP4 | 28-32 second MP4 | 15-20 minute MP4 |
| Frame | 1920x1080 | 1080x1920 | 1080x1920 | 1920x1080 |
| Narration | English | Vietnamese | Vietnamese | Vietnamese |
| Subtitles | bilingual English + Vietnamese | one Vietnamese line | one Vietnamese line | one Vietnamese line |
| Voice | Edge TTS (`en-US-AriaNeural`) | VieNeu-TTS, local (`Thanh Bình`) | VieNeu-TTS, local (`Thanh Bình`) | as Fact Shorts |
| Pictures | searched on Openverse at render time, then a second Claude call looks at the candidates and assigns them per scene | as Podcast | as Podcast | as Podcast |
| Writes about | whatever the photographs support | one true thing | why your brain just did that | one subject in depth, funny and detailed, researched on the web |
| Publishes to | its own YouTube channel, once a day | its own YouTube channel, every 6h | its own YouTube channel, every 6h | **the Fact Shorts channel**, once a day |

```bash
npm run podcast  -- generate <project>
npm run fact     -- generate <project>
npm run psych    -- generate <project>
npm run factlong -- generate <project>   # 15-20 min, needs a brief
npm run ui                              # all three, on one page, port 4000
npm run ui:build                        # rebuild the interface after editing ui/
npm run ui:dev                          # Vite dev server with hot reload, port 5173
```

There is no default module. That is deliberate: each keeps separate job
directories, separate caches and **separate YouTube credentials**, so a guessed
module would run the wrong pipeline and upload to the wrong channel.

**Three pipelines, four channels, five modules.** `fact` and `psych` are the
same pipeline - `src/modules/shorts` renders both, and neither owns a line of
image search, pacing, caption or schema code. What each owns is its prompts, its
env defaults and its accent colours. See "A channel is a prompt pack" below
before adding another.

`factlong` is the arrangement's mirror image and the exception worth reading
before you touch the registry: **the same channel as `fact`, a different
machine.** It publishes to Ủa Thật À? with Ủa Thật À?'s credentials, and is
separate because seventeen minutes cannot be written in one Claude call. See "A
channel is not always a module" below.

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
    podcast/        prompts, captions, theme values, env defaults
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

### A channel is not always a module

`factlong` breaks the rule the rest of this section is built on, and how it
breaks it is the useful part.

Everywhere else, a module exists *because* it is a channel: its own
`runtime/<id>/`, its own cache, and above all its own YouTube refresh token,
because **the token is the channel**. `factlong` has the first two and
deliberately not the third. It makes fifteen-to-twenty-minute landscape videos
for the same YouTube channel `fact` makes thirty-second shorts for.

So the axis that separates modules is not "which channel" but "which machine",
and this one is a different machine for a reason no flag could carry:

> A seventeen-minute Vietnamese video is about five and a half thousand
> syllables. Asked for that in one call, a model writes the first three minutes
> properly and then compresses - the later sections arrive as summaries of
> themselves. Nothing measurable fails. The video is simply hollow after minute
> five.

`factlong/storyboard-provider.ts` therefore does what no other module does:
**one research call, then one call per section.** The research call is the only
one with web search, and that is the load-bearing part rather than a saving. A
live disaster's death toll moves daily; ten sections each free to search would
each find a different one, and the video would contradict itself between minute
four and minute eleven without any single call having been wrong. Instead the
outline returns a list of facts, each with a source and the date it was true,
every section writes from that list and is told it may not add to it, and the
list survives into `storyboard.json` as `content.facts` so a person can check
a month later what the video actually claimed.

**A prompt is the third way in, and the only one that names its sources.**
Beside "type a title" and "let Claude choose", `factlong` takes a free-form
prompt: a description of the video plus the pages it should be built from, as
one block of text. `POST /projects` writes it straight into the brief - the whole
prompt as `context`, the links pulled out into `sources` by `extractSources` - and
starts the run, because a prompt is a complete instruction and nobody who has
just written one is waiting to fill in anything else.

Three rules make the sources actually govern the video rather than decorate it:

- **The research call reads them before it searches.** A model given three links
  and the ordinary research instructions reads the links, searches, then writes
  whatever story the search turned up. So the sources section sits *above* the
  research rules and says it overrides them, and `WebFetch` is granted only when
  there are pages to fetch - an ordinary run keeps the single tool it always had.
- **Using them is measured, not requested.** The first real run with two
  articles given drew 13 of 28 facts from them - but it cited "Wikipedia, Honey"
  rather than the URL, so a check matching only the address read that as zero.
  `checkOutline` now matches the URL *or* the site's name, and sends back an
  outline under a quarter from the given pages. A quarter is low on purpose: a
  fifteen-minute video needs more than three articles, and the call is meant to
  fill gaps. The gate is for the outline that read the links and ignored them.
- **Their content is data, not instruction.** These are arbitrary pages fetched on
  somebody's say-so. Everything this call returns is facts and queries in JSON, so
  the worst a hostile page can do is plant a false fact, which the two-sources rule
  is already there to catch.
- **A Commons category link is pinned in code.** It is the least ambiguous thing in
  the prompt - "use these pictures" - so `commonsCategoriesFrom` adds it to
  `eventImageQueries` whether or not the model noticed, and ahead of the model's own
  guesses so the cap trims those instead.

`extractSources` lives in `src/domain/brief.ts` rather than in the module, because
the server calls it and the server should not reach into a module's internals. The
brief itself decides whether it takes `sources`: `writePromptBrief` offers the full
shape to `module.parseBrief` and falls back to `{ context }`, so no module id is
named in the route.

**Sharing credentials is declared, not inferred.** `YOUTUBE_TOKEN_FROM=fact` in
`.env.factlong` borrows the token file *and* the OAuth client id and secret,
because a refresh token only works with the client that issued it - sharing the
token while keeping your own client id is a guaranteed `invalid_client`. The
happy side effect is that rotating a leaked secret is one paste in one file.

**What it does not own is most of it.** The photograph search is the shared
`resolveSearchedBackdrops`; the caption pager is the shorts' own file, unchanged,
because one heavy Vietnamese subtitle line is right in both frames; the pace
constant is imported from `shorts/pacing` rather than re-measured, because it is
the same voice at the same speed. What it owns is the provider, the prompts, the
schemas that had to grow (140 scenes, 16 image queries), and a theme pack
derived from the fact channel's with everything that was a decision about *a
phone held close for thirty seconds* overridden.

**Two picture sources, and Commons is also the understudy.** Openverse answers
"a photograph of a mountain river"; a query prefixed `commons:` asks Wikimedia
Commons directly, and exists for the one thing a stock library cannot do -
return a picture of *this* thing. Openverse rebuilds its Commons index on its
own schedule, and that gap is the original reason: a week after the 2026 Nepal
flood, Openverse had nothing and Commons had fourteen files.

The second reason arrived later and is more mundane. **Openverse went down for
two days**, which on a channel publishing every six hours is not an outage you
wait out - so an ordinary query now falls through to Commons when the stock
library is unreachable *or* returns nothing. Only for "could not reach it": a
4xx means this code asked wrongly, and asking somewhere else would hide that.
`RoutedStockProvider` holds both rules, so `resolveSceneImages` still knows
nothing about where pictures come from.

**Commons category names are title-cased and plural, and queries are not.**
`Category:Jellyfish` exists; `Category:lighthouse` does not, while
`Category:Lighthouses` holds thousands. Measured on seven ordinary queries, the
exact-name lookup found three and every miss was a singular; trying the
pluralised title case as well took `lighthouse` from 0 to 6, `honey bee` 0 to 8,
`tropical island` 0 to 12. Only the head noun is pluralised - `Tropical islands`,
not `Tropicals islands`.

**Commons throttles anonymous clients, and it used to look like an empty
category.** The provider returned `null` on any non-200, so "You are making too
many requests" and "this category has no files" were the same answer - which
sends you looking for a better category name for a query that was never asked.
Refusals are raised now, as `RATE_LIMITED`, including the plain-text throttle
Commons serves with a 200 status.

Three things then keep it usable: a two-second floor between requests, a retry
with backoff when the throttle fires anyway, and the per-query tolerance in
`resolveSceneImages` that treats a refused query as an empty one. It is not
perfect - eight consecutive queries came back 5 answered, 3 refused - but the
number to compare it against is what a run got while Openverse was down, which
was zero. Note that measurement was taken from an address that had been
hammering Commons all afternoon, so it is pessimistic rather than typical, and
the constants are "known to be enough" rather than calibrated.

**Ask Commons for categories, not for words.** Its full-text search is poor -
`Rasuwagadhi` comes back with map sheets of Pakistan - while its categories are
curated by hand and almost always right. `eventImageQueries` on the outline are
category names, and the `commons:` prefix is attached in code rather than asked
for, because it is a routing detail the model has no way to know is required.

**The supply is a handful, not a library.** A category holds five to seven usable
files, sometimes twenty, so the named-subject queries are for the scenes that
need the real thing and the stock queries still carry the rest. Naming ten
categories does not produce fifty pictures.

**And a lot of what is there cannot be used.** Measured on a lighthouse video:
of six categories the model named, two returned pictures and four returned
nothing - one did not exist, and the other three are geograph.org.uk holdings,
uniformly **CC BY-SA at 640x480**. They fail twice over, on the ShareAlike rule
and on the resolution floor. That is not a bug to fix; it is what the openly
licensed record of historic and remote subjects looks like. Whether to accept
BY-SA is a licensing decision for whoever owns the channel.

**Openly licensed *video* effectively does not exist for ordinary subjects.**
Remotion can play it - `OffthreadVideo` is there - but the supply is not:
`Lighthouses`, `Bradypus`, `Eiffel Tower`, `Honey bees` and `Volcanoes` returned
**zero** video files between them. A CC0 video source with an API key (Pexels,
Pixabay) is the route if b-roll is ever wanted; Commons is not.

**ShareAlike is a channel's decision, and Ủa Thật À? took it.** The rule at
the top of `image/stock/types.ts` is not source-specific: a video built from a
BY-SA picture arguably has to be BY-SA itself, and that is not a decision a
render pipeline makes for a channel. The owner of Ủa Thật À? made it - about
40% of the real photographs of real places on Commons are BY-SA (Đông Ngạc 4
of 9, the 2008 Hà Nội floods 8 of 21) - so `STOCK_SHARE_ALIKE=on` in the `fact`
and `factlong` defaults, and off everywhere else. NonCommercial and
NoDerivatives stay excluded regardless. The setting is part of the search cache
key through the router's name, because a pool searched without ShareAlike is
the wrong pool once a channel allows it.

**Real pictures are looked for scene by scene.** The storyboard's queries are
written before anybody knows what exists, in stock vocabulary, and stock
answers "water pump station" with a pump station in England. The owner's
verdict on a video that was otherwise careful - sixty of ninety-one scenes on
the paper's own photographs - was that the rest were still pictures of
something else. `factlong/image-research.ts` therefore sends each batch of
twelve scenes to a call with WebSearch and WebFetch that names what each
sentence is about, finds that thing on Wikimedia Commons, opens the page to
check it, and returns exact `Category:` or `File:` names. Searched as given -
never widened, never full-text - they reach that scene's review sheet in room
of their own, between the press photographs and stock. The answers are kept in
the project's `image-research.json`, per batch, so a re-render does not
re-research and an edited scene re-researches only its batch.

The web search is the point rather than a convenience: Commons's own search is
poor at names it has not been told - "Yen So Park" returns a category about Al
Gore, "Hanoi University of Mining and Geology" returns two politicians - while
the categories exist under names like `Category:Đông Ngạc`.

Asked only for the exact thing, the first pass found sources for 8 of 91 scenes:
Commons simply has no photograph of one street in Đông Ngạc on one night. So it
may fall back to the same kind of thing *in the same place* - a Hà Nội manhole
for a sentence about Hà Nội's drains. The second pass then offered "Category:2008
Hanoi floods" for twenty-six scenes about the night of 16 September 2026: the
right city, the right kind of water, and a false picture, because the viewer
takes it for this flood. **Where is not enough; when matters too.** Both the
research prompt and the review brief now say that another event's photographs,
however local, belong only to sentences about that event.

**A review sheet gives each kind of picture its own room.** Twenty researched
queries in one round-robin with six press queries gave every query one or two
slots and squeezed a paper's twelve photographs down to one. `candidatesForSheet`
takes up to twelve pinned, then up to twelve researched, then stock, and hands
any unused room to the next group.

**A third source, and it takes a person's word: the papers' own photographs.**
A news link pasted into a brief is read for facts and nothing else, because the
pictures on a news page belong to the paper. When the channel owner has asked
the papers and been told yes, they tick a box on *that project's* brief -
`sourceImagesPermitted` - rather than flipping a setting, because the
permission is about particular articles and a setting would quietly extend it
to every link anybody pastes afterwards. Nothing in the code can check the
claim; it is recorded where it was made.

With the box ticked, each article becomes an `article:<url>` query, pinned into
every review batch, and `ArticleImageProvider` lifts the photographs out of the
article body. What it had to learn, each from a real page: markup inside
`<script>` is not on the page (a Tuổi Trẻ popup's screenshot of Google's
settings came through as the thirteenth flood photograph); a linked thumbnail of
another story is not this story's picture; a video report has no body photos,
only its `og:image` still; and in "Ảnh: T.HOÀNG" the dot is an initial, not the
end of the credit, while "Ảnh: PV" names nobody. The six Hà Nội flood articles
gave 31 photographs - Tuổi Trẻ 12, Tiền Phong 13, Thanh Niên 4, one each from
Sức Khỏe & Đời Sống and Nhân Dân, none from the Tiền Phong video page.

The licence field says `permission`, and everything downstream keys off it,
because the permission comes with conditions. **Shown as published**: fitted
whole into the frame *above* the heading and the subtitle, which read off the
plain background below it - no crop, no camera move, no effect or particles,
and no scrim, which is a filter over most of the picture. **Credited on
screen**, top right, larger and on a plate: "Ảnh: Phạm Tuấn · Tuổi Trẻ". And in
the description, one line per article in the form papers use for each other's
pictures, never "CC PERMISSION". The review prompt is told that a paper's logo
in the corner is part of the original rather than a watermark - otherwise the
watermark rule rejects every Tuổi Trẻ and Thanh Niên photograph - and that line
appears only on a sheet that has press photographs, so the shorts' prompt is
unchanged.

**A video with the event's own photographs shows nothing else.** The owner's
rule, after two rounds of "still pictures of something else", was absolute:
*one hundred per cent* of scenes on a picture of the event that scene is about.
So a `factlong` project with permitted articles runs event-only: no stock query
is searched (`storyboardQueries: false`), the research looks only for *other*
events the script names - the 2008 flood it is compared with - and never for
places or "the same kind of thing", and the review brief says the sheet holds
nothing but event photographs and its job is to pick the one closest to the
sentence. A scene nothing fits borrows only within its own event: a scene with
research of its own is about that other event and takes its least-used
picture; every other scene borrows the paper's photographs, then takes the one
used least. Never stock, never the generic fallback - and if the articles gave
no photographs at all, the run stops and says so rather than filling in. Thirty
photographs for ninety scenes means each is seen three or four times
(`EVENT_ONLY_MAX_USES`); more permitted articles are the way to more variety.

Two things that failed quietly before this worked: the brief editor sent back
only the fields it knew, so fixing a typo in the idea erased `sources` (both
save paths now go through `parseBriefWithSources`); and ticking the box and
pressing start answered "already up to date", because the permission lives on
the brief rather than the storyboard - the permitted article list is now part
of `factlong`'s input hash.

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
- **Where pictures come from.** Nowhere any more: every module searches
  Openverse after the script exists, using queries the storyboard itself
  declares. The podcast used to read an uploaded library *before* writing -
  which meant an episode could only be about what somebody had already
  photographed - and that was the single biggest behavioural difference between
  the modules. It is gone, along with `image/library.ts`, the library routes and
  the library UI.
- **Which photograph fits which frame.** `cropCost` ranks against the *video's*
  aspect, not a constant. A 3:2 landscape cropped to 9:16 keeps a third of its
  width; a portrait cropped to 16:9 keeps a third of its height, and letterboxed
  into 16:9 it is a small picture with grey beside it.

  **The parameter has to actually arrive, and for a while it did not.**
  `frameAspect` was added to `ResolveInput`, documented, and then never passed to
  `provider.search` - so every search in the repository was ranked for 9:16
  whatever the video was, and the landscape improvement everyone believed had
  landed was `coverTolerance` alone. Nothing failed: the type was optional, so
  the compiler had no opinion, and the default it fell back to was the old
  behaviour. Measured after threading it: `waterfall` returns 1 landscape
  photograph in 6 for a vertical frame and 5 in 6 for a horizontal one.

  **It is part of the cache key too.** A search result here is already ranked
  and sliced, so the pool built for a short is the wrong pool for an episode
  even though the query is identical - and a shared key hands one to the other
  for a month.
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
- **`resolveTargetSeconds`.** The shorts modules clamp to 52s - not 60 - because
  a script may run over its budget and 60 plus that allowance stops being a
  Short. A safety net rather than a working limit now that both channels ask for
  thirty; the podcast has no such cliff.
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

**The band comes from configuration, and it is measured in words on purpose.**
`VIDEO_DURATION_MIN` and `VIDEO_DURATION_MAX` were dead keys on the shorts
pipeline - written into both env files, parsed into `AppConfig`, read by
nothing. They are now the length gate: `lengthBandFrom` turns them into ratios
of the word budget, so a channel that wants 28-32 seconds says so in
`.env.<module>` rather than in a constant. Checking words rather than the
rendered file is only defensible because the conversion is accurate - across the
124 finished videos in `runtime/`, word count against timeline duration has a
standard deviation of 2.7% - and the alternative is learning the video is
thirty-six seconds long after ten minutes of rendering. What is left over, the
narrator reading the same words at a slightly different pace, is warned about
after TTS rather than failed: the script has already passed the only gate anyone
can act on.

**Nothing subtracts `tailPaddingSeconds` from a word budget.** It looks like an
omission and is not. Padding is added only on `buildTimeline`'s fallback path;
when the audio was measured - always, on a real run - `tileAcrossAudio` lays the
scenes across the voice track exactly, so a finished video is precisely as long
as its narration. A budget that subtracts padding makes every video a second
short of its target, which is a quarter of a four-second band.

**The first three seconds are a scene with its own budget.** A short opens on
one sentence of about sixteen syllables, and that is enforced rather than
requested: `checkStoryboardStructure` sends back a draft whose opening scene
runs long. Handing the model one flat words-per-scene average was producing a
four-and-a-half second opening, because an average is what it will divide by.
Nothing is laid under it - the shorts channels carry no sound effects, and
`sfxForScene` stays a cartoon-only hook.

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

**A title that answers itself has already been watched.** The listing is
written by the model, but the rule it writes to is the format's rather than the
channel's: the title names the strange thing and stops before the explanation,
and the description carries the answer. A thirty-second video whose title
contains its own payoff is consumed in the feed, and the view it loses is the
one that would have watched to the end. `publishSection` in
`shorts/prompt-parts.ts` holds the rule and takes each channel's examples,
because what counts as "the answer" depends on what the video was going to tell
you. Most of that section is spent separating withholding from clickbait - a
model told to be intriguing reaches straight for "99% KHÔNG BIẾT", which names
nothing at all.

**A description has a hard ceiling and YouTube refuses rather than trims.**
Five thousand characters, answered as 400 `invalidDescription` with nothing
uploaded. It was theoretical for two years: a short shows six photographs and
its credits run to eight hundred characters. A seventeen-minute video shows
ninety-one, and the first one written came to nine thousand - refused after the
research, the narration and the render had all been paid for. `fitDescription`
now writes the credits three ways and uses the fullest that fits, because the
attribution cannot simply be dropped: CC BY asks for the creator, the licence
and the work's URI. The smallest form still names every photographer, and the
credit drawn in the corner of each frame carries the rest.

**A cover is drawn, not grabbed.** On a Short a still is defensible - the feed
plays the video instead of showing a cover. On an ordinary video the cover is
what decides whether anybody clicks, and a frame with a subtitle across it
decides "no". So `renderThumbnail` renders its stills with `captionPages` and
`title` stripped, and `composeThumbnail` draws three to six words over the top.
Two things there were learned the hard way: the type size is **measured** by
rasterising the line and trimming to the ink, because no characters-times-a-ratio
estimate survives a heavy sans plus Vietnamese tone marks - the first attempt
ran the headline off the right edge. And the cover's words are not the title:
the title sits next to the cover, so repeating it spends the one piece of visual
space a video has on words already being read.

**The publishing kit is generated, not written.** Title and description from the
model; chapters from the *timeline* (real frame positions, obeying YouTube's
silent rules - first mark at 0:00, three minimum, ten seconds apart); the music
credit from `assets/music/credits.json`; the photo credits from the timeline.
Both credits are licence conditions, and a model told to remember an attribution
will forget it on the video nobody checks. Chapters are skipped under two
minutes - nobody navigates a Short.

**The picture search is a free public API that regularly falls over, so the
pipeline is built to survive it rather than to depend on it.** Three layers, and
each was added after the one above it turned out not to be enough.

*Retry, and retry the right things.* Openverse goes cold - three back-to-back
requests for one query measured 36.1s, 0.11s, 0.11s - so the timeout is 45s and
the search retries three times with backoff. The first version of that retry was
nearly useless: it covered thrown fetch errors but not a **502**, which arrives
as a perfectly good response and went straight out as fatal. On a morning when
the service was genuinely degraded, twelve requests returned eight 502s and four
timeouts, zero successes, and every run died on its first query. 5xx is retried
now; 4xx is not, because the request itself is wrong and asking again wrongly is
just slower.

*A stale pool beats no pool.* The search cache expires after a month so a
channel is not pinned to the same dozen photographs for ever - a freshness
preference, not a correctness rule. When the search cannot be reached, an
expired pool of the right pictures is served rather than discarded.

*A query that cannot be answered is treated as a query that found nothing.* This
is the one that matters, because no amount of retrying helps when the service is
down. The machinery already handles an empty result - the scene falls through to
the storyboard's other queries, then to the broadened form, then to the generic
fallback - so the honest failure boundary is **per video, not per query**, and
`MINIMUM_IMAGES_NOT_MET` still stops a run where nothing at all was found.
Verified against a provider failing exactly one of three queries: 4 of 4 scenes
still got a photograph, the query was named in a warning, and the summary said
which. Only transport-shaped failures are swallowed; a 4xx would repeat on every
query and still stops the run rather than quietly shipping a video of fallback
photographs.

The failures carry their own codes so a caller can tell them apart:
`STOCK_SEARCH_UNREACHABLE` is worth retrying in seconds, `RATE_LIMITED` is not -
anonymous access allows twenty searches a minute and two hundred a day, so that
remedy is measured in minutes or in tomorrow. Neither is `PROJECT_NOT_FOUND`,
which is what both used to report and what sent a person looking for a project
sitting right there.

**The review looks at a batch of scenes, not at the whole video.** One call
shown thirty candidates gathered across every query is the right shape for a
nine-scene short and useless for a ninety-scene one - it placed *nothing*, because
thirty pictures cannot cover ninety scenes and a sheet mixing sixteen subjects is
mostly wrong for whichever scene you are looking at. `REVIEW_BATCH_SCENES` is
twelve, and each batch is shown only the candidates from the queries **its own
scenes asked for**. Measured on forty scenes across four subjects: each batch saw
two subjects rather than four. A batch that fails costs relevance on a handful of
scenes and does not stop the ones after it.

A batch gets seven minutes, and that number is measured rather than hoped. The
model opens every thumbnail with its own tool call, so thirty pictures and
twelve scenes of narration take two and a half to three minutes when nothing is
wrong - and the three-minute ceiling this used to have was the median. On one
seventeen-minute video four of eight batches timed out, and the one that failed
twice was the first: the opening scenes went to the automatic assignment, which
never offers pinned photographs, so the hook lost the event's real pictures.

**A scene the review leaves empty is not handed a picture nobody chose - on a
long video.** The review is told that an empty scene is better than a wrong one,
and it takes that seriously: on the Hà Nội flood video it left 35 of 91 empty.
The automatic tiers then filled them blind, with exactly the candidates it had
just declined and whatever the widened queries dragged in - a galaxy, because
"whirlpool drain water" widens to "whirlpool"; a hoverfly; three stadiums; a man
in a suit. So `factlong` sets `blankScenes: 'reuse'`. The empty scenes go back to
the review once, on a sheet of the pinned pictures nobody has used, then the
pictures *already in the video* nearest first and marked with the scene showing
them, then what their own queries still hold - because the one-picture-per-scene
rule is precisely what left them empty, and the flooded street from a minute
earlier is right for a sentence about why the drains failed. Whatever is still
empty borrows a picture the review placed elsewhere - the event's own
photographs first, then the nearest, which is the previous scene's or the next
one's a scene early - and no picture may cover more than two scenes in a row.
Nearest-first alone borrowed a tractor from a scene about farmland for the
sentence about the student's death. The first
version held the previous picture for two scenes and sent the third back to the
blind tiers, and the galaxy came straight back; the tiers now run only for a
video the review never saw at all. A review reply with no JSON throws rather
than returning an empty verdict, because empty means "looked, nothing fits".
Reuse needs a ceiling as well as a floor: told in prose not to pile one picture
onto many scenes, the second look put the same whirlpool at a drain on seven
scenes in two minutes. `MAX_USES` is three per video, enforced on the sheet, on
the verdict and on borrowing, because the prose did not hold.
Shorts keep `tiers` - nine scenes rarely reach it, and a repeated picture in
thirty seconds looks like a bug.

**Right word, wrong place.** With the blind tiers gone, the weakest pictures
left in the Hà Nội video were ones the review had *chosen*: a snowed-in brick
pump house in England for Hà Nội's Yên Sở pumping station, an English tidal-zone
sign, a road closure in a desert. Each is on the query and off the place, and a
Vietnamese viewer sees it before the subtitle ends. Two causes, both prose in
`factlong/backdrops.ts`: the review was never told that place matters, and it
*was* told to keep the press photographs for event scenes and use "illustrative"
stock for explanation - so it reached for stock even when the stock was
foreign. The brief now says a picture must be of the place the sentence names,
and that the event's own photographs also serve the scenes explaining that
event's context.

**A stranger's face under a sentence about a real person is a claim, not
filler.** The same run put a woman praying at a temple under "the mother came to
take her son home", and a young man beside a scooter near the scenes about the
missing student. A viewer takes them for the mother and the student, and they
are not. The brief now forbids a recognisable stranger in or near sentences
about the real people in the story; the scene, the crowd, the rescuers and
people too far away to recognise are fine.

**The review's verdicts are remembered, keyed on the exact prompt.** The engine
promises that one storyboard renders one video, and this call broke it: every
`--force` asked again, spent half an hour on a long video, and came back with
different pictures. The key is the whole prompt - sheet, sentences, rules - so
changing any of them asks afresh, and `runtime/<module>/stock/review-verdicts/`
is the thing to delete to force a new look.

**A search that is down is given up on after three tries, not after eighteen.**
Each unreachable query costs three attempts at forty-five seconds plus backoff,
so a long video asking eighteen of them spends **fifty minutes** discovering, one
query at a time, what the third query already knew. `GIVE_UP_AFTER` stops the
network for the rest of the run and falls through to the cache; the counter
resets on any success, so a service that is merely flapping is not written off.
Measured with a provider that never answers: three calls instead of sixteen, and
the run reaches its verdict immediately rather than in an hour.

**A thumbnail that will not load is a picture nobody reviews.** Openverse's
thumbnail endpoint proxies the upstream provider, and for Wikimedia it answers
424 on every image - measured, twelve of twelve. Those candidates were dropped
silently, so a video about reindeer reached the only stage with eyes carrying
ten photographs of snow and no reindeer. `writeThumbnails` now falls back to
downloading the original and downscaling it. The effect is not subtle: the
review went from placing 3 of 9 scenes to 8 of 9.

**A thin candidate pool is itself a relevance problem.** With four photographs
for nine scenes the review has nothing to choose from and must take what it is
given, so `STOCK_SOURCES` being narrow reads as "the pictures do not match the
script". Widening it is the fix, not the cause - and the note that once
justified excluding Wikimedia no longer describes what Openverse returns.

**A subject is spent the moment a script exists for it.** `runtime/<module>/
de-tai.json` is the ledger of everything a channel has covered, written when
the storyboard is accepted rather than when the video goes up - a failed render
still used the idea. It exists because the old "do not repeat" list was read
out of the project folders, and *deleting a project deleted its topic* while
the video stayed on YouTube. `de-tai.md` beside it is a rendering for people
and is never parsed back. Every storyboard provider ends its retry loop with
`findSimilarTopic`, which compares content words after folding tones - the
threshold was calibrated against the real back catalogue, where it found two
live Fact videos about an octopus having three hearts.

**Deleting projects in bulk is a route, not a loop in the interface.** The
answer is per-project: one that is mid-render is locked and must be left alone,
and a loop on the client turns that into one refused request among nine silent
successes - so the person sees a success toast and finds the project still
there. `POST /projects/bulk-delete` returns what it deleted and what it skipped
with a reason, and the interface names the skipped ones rather than counting
them, because the reason is almost always "still rendering".

Two things it deliberately does not do, and the confirmation says both: it does
not touch `de-tai.json`, because the ledger outliving its project is the whole
point of that file; and it cannot unpublish anything, so a project whose video
is already on YouTube loses its local files and keeps its upload.

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
