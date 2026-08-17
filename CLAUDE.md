# Auto Short Video Generator

Turns a folder of product photos into a 1080x1920 MP4 with Vietnamese narration.

## What this repo is

A Node/TypeScript CLI (the "Video Engine") plus a Remotion composition. The
engine is deterministic and contains no AI: given a storyboard it always
produces the same video. Claude's only job is writing the storyboard.

Three layers, and the boundaries are load-bearing:

| Layer | Does | Never does |
|---|---|---|
| Claude Code | looks at photos, writes Vietnamese copy, picks scenes/animations, calls the CLI, moves files to and from Drive | renders, synthesises speech, computes timings, writes JSX |
| Video Engine | validates, processes images, calls TTS, computes the timeline, renders, validates output | calls Claude, knows Google Drive exists |
| Remotion | timeline to pixels | calls Claude or TTS, decides how long a scene is |

## Commands

```bash
npm run setup:python                     # one-time: venv + edge-tts
npx tsx src/cli/index.ts prepare <dir>   # copy in, process images, make AI previews
npx tsx src/cli/index.ts generate <id>   # full pipeline (calls Claude if no storyboard)
npx tsx src/cli/index.ts render <id>     # re-render only: no Claude, no TTS
npx tsx src/cli/index.ts regenerate-content <id>   # discard storyboard, ask Claude again
npx tsx src/cli/index.ts generate-all    # every project under runtime/jobs
npx tsx src/cli/index.ts validate <mp4>  # check an output file
npm test && npm run typecheck
```

Node 22 is required (`.nvmrc`); `sharp` and `chokidar` both refuse older
versions and Remotion is only validated on LTS.

## The Drive workflow

`01_INPUT` -> `03_OUTPUT` under `$DRIVE_ROOT` (default `./workspace/AI-Shorts`).
Run these in order for each unprocessed project; check the exit code after each.

1. List `$DRIVE_ROOT/01_INPUT`. A project with `job.json` at status `DONE` is
   already finished - skip it rather than rebuilding.
2. `prepare $DRIVE_ROOT/01_INPUT/<id>` - copies into `runtime/jobs/<id>`,
   normalises the images, and writes 768px previews.
3. Read the previews in `runtime/jobs/<id>/preview/`, **not** the originals.
   They are small on purpose.
4. `generate <id>`. This calls Claude for the storyboard if there is not one
   already, then does everything else itself.
5. On success, copy `runtime/jobs/<id>/output/` to `$DRIVE_ROOT/03_OUTPUT/<id>/`.
   On failure, `$DRIVE_ROOT/99_ERROR/<id>/error.json` already explains why.

Source images are only ever read. Nothing moves or deletes anything under
`01_INPUT`, so a crash cannot cost the user their only copy of the photos.

## Rules that are enforced in code, not by convention

Reading these before changing anything will save you a confusing afternoon.

**Claude may not invent facts.** Prices, specifications, warranties,
promotions and certifications must come from `info.json`. `src/ai/fact-guard.ts`
checks this mechanically and fails the job rather than trusting the prompt. With
no `info.json`, strict mode forbids every number - including ones spelled out in
words, since narration is written to be read aloud. A price within 15% of the
sourced one is allowed, so "chưa tới 400 nghìn" for a 399,000đ product passes.

**The timeline is the only source of truth for timing.** Claude's
`scene.duration` is a hint and Remotion never sees it. `src/pipeline/build-timeline.ts`
derives every duration from measured audio, and scenes tile the voice track
exactly - total video length equals total audio length. Do not "improve" this by
letting a component compute seconds; that is how captions drift.

**Vietnamese narration is mandatory.** A job cannot reach DONE without it.
Note that Remotion writes an AAC track even for a composition with no audio, so
the check is on silence content, not stream presence.

**Never stretch an image.** `src/remotion/layout/fit.ts` returns explicit pixel
boxes from a single uniform scale. Percentage sizing on an `<img>` reintroduces
the bug immediately.

**CSS percentage padding resolves against width, not height.** At 9:16 that
makes every vertical inset about 56% of what it should be. Safe areas and
caption positions are computed in pixels from `useVideoConfig()` for this reason.

**JavaScript `\b` does not work next to Vietnamese letters.** It is defined over
`[A-Za-z0-9_]` even under `/u`, so `/\d+đ\b/` never matches "399.000đ". The fact
guard uses Unicode lookaround instead. Any new pattern touching Vietnamese text
needs the same treatment.

## Where things live

```
src/domain/      types + zod schemas; scene/animation whitelists
src/ai/          Claude provider, prompt, fact guard
src/tts/         Edge TTS (via scripts/edge_tts_synth.py), mock, alignment
src/image/       Sharp processing, previews, background removal
src/pipeline/    the deterministic pipeline, timeline builder, job state
src/video/       bundling, asset staging, rendering, ffprobe, validation
src/remotion/    the single ShortVideo composition, scenes, themes
runtime/         jobs, cache, logs (gitignored)
```

## Known fragility

Edge TTS is an unofficial Microsoft endpoint and periodically starts rejecting
clients (the `Sec-MS-GEC` token). Because Vietnamese narration is mandatory,
this is the pipeline's single point of failure. Mitigations already in place:
the TTS cache means unchanged text never re-calls it, `--mock-tts` keeps the
whole pipeline runnable offline, and `TTSProvider` is an interface so Azure -
which offers the same `vi-VN-HoaiMyNeural` voice - can be dropped in without
changing the voice.

Anything rendered with `--mock-tts` is silent and gets stamped `devMock: true`
in `job.json`. It is for development only and must not be published.
