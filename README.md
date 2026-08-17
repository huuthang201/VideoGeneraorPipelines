# Auto Short Video Generator

Drop a folder of product photos in, get a 1080x1920 MP4 with Vietnamese
narration and synced captions out.

```
01_INPUT/baseus-ma10/{01.jpg,02.jpg,03.jpg,info.json}
        ↓
03_OUTPUT/baseus-ma10/{video.mp4,thumbnail.jpg,storyboard.json,script.txt,captions.srt,job.json}
```

## Setup

```bash
nvm use            # Node 22 (see .nvmrc)
npm install
npm run setup:python
cp .env.example .env
```

`npm run setup:python` creates a project-local `.venv` with `edge-tts`. It is
kept out of the system interpreter deliberately; nothing else is installed
globally.

## Usage

```bash
npx tsx src/cli/index.ts prepare workspace/AI-Shorts/01_INPUT/baseus-ma10
npx tsx src/cli/index.ts generate baseus-ma10
```

| Command | What it does | Claude calls | TTS calls |
|---|---|---|---|
| `prepare <dir>` | copy in, normalise images, write AI previews | 0 | 0 |
| `generate <id>` | full pipeline | 1 (0 if a storyboard exists) | 1 (0 on cache hit) |
| `render <id>` | re-render from the existing storyboard and voice | 0 | 0 |
| `regenerate-content <id>` | discard the storyboard, ask again | 1 | 1 |
| `generate-all` | every project under `runtime/jobs` | 1 each | 1 each |
| `validate <mp4>` | check an output file | 0 | 0 |

Useful flags: `--force` rebuilds unchanged input, `--mock-tts` runs the whole
pipeline offline with placeholder narration.

Tweaking an animation, a caption style or a theme costs nothing: edit
`storyboard.json` and run `render`. Only `regenerate-content` spends a Claude
call.

## How it fits together

```
photos + info.json
      ↓  Claude (1 call, reads 768px previews)
storyboard.json          ← the AI/non-AI boundary; everything after is deterministic
      ↓  Edge TTS
voice.mp3 + word timings
      ↓  alignment
timeline.json            ← frame-exact, the only thing Remotion sees
      ↓  Remotion + ffmpeg
video.mp4 → validated → output/
```

Claude writes copy and picks scenes. It never renders, never computes a
duration, and never writes JSX - it may only choose from whitelisted scene
types and animations. The engine never calls Claude and does not know Google
Drive exists; it only sees `runtime/jobs/<id>/`.

## Guarantees the code enforces

- **Nothing invented.** Prices, specs, warranties and promotions must come from
  `info.json`, checked mechanically in `src/ai/fact-guard.ts`. With no
  `info.json`, no number may appear at all - including one spelled out in words.
- **Captions track the voice.** Scene durations are derived from measured audio,
  never from the model's guess, and the video always covers the full narration.
- **Vietnamese narration is mandatory.** A job cannot complete without it, and
  the check looks at audio content rather than merely at stream presence.
- **Images are never stretched.** Portrait fills the frame; square and landscape
  sit sharp over a blurred copy of themselves.
- **Re-runs are free.** Unchanged input skips in under a second.

## Configuration

Everything is in `.env` (see `.env.example`): workspace root, voice, video
dimensions, feature flags. `DRIVE_ROOT` defaults to a local `./workspace` folder
and can be pointed at a Google Drive path without any code change.

## Tests

```bash
npm test
npm run typecheck
```

The suite concentrates on the parts where a bug would be invisible in a
finished video: timeline arithmetic, caption alignment, image fitting, and the
fact guard.

## Known fragility

Edge TTS is an unofficial Microsoft endpoint that periodically starts rejecting
clients. Since narration is mandatory, that makes it the single point of
failure. The TTS cache means unchanged text never re-calls it, `--mock-tts`
keeps everything else runnable offline, and `TTSProvider` is an interface -
Azure offers the same `vi-VN-HoaiMyNeural` voice if a paid fallback is needed.
Anything produced with `--mock-tts` is silent and is stamped `devMock: true`.
