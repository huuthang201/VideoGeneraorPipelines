# Auto Short Video Generator

Turns a folder of product photos into a 1080×1920 MP4 with Vietnamese narration.

See [HUONG-DAN.md](HUONG-DAN.md) for the day-to-day guide (Vietnamese).

## Vietnamese TTS

**Engine:** VieNeu-TTS v3 Turbo — on-device, 48 kHz, no API key, no per-character
billing.

**Voice:** set by `TTS_VOICE`. Either one of 19 built-in Vietnamese presets, or a
voice cloned from a reference clip.

**Reference:** `assets/voices/adam_vi.wav` (see
[assets/voices/README.md](assets/voices/README.md))

### Install

```bash
npm install
npm run setup:vieneu     # Python 3.10-3.13 venv + vieneu + model download
```

VieNeu needs Python 3.10–3.13. The script finds a suitable interpreter, or tells
you how to install one (`brew install python@3.12` on macOS).

### Choosing a voice

```bash
npm run tts:voices
```

Male, Northern, narration-style presets — closest to a deep "Adam" read:

Ranked by measured median pitch — lower is deeper. Worth checking the number
rather than the style label: the deepest-sounding name is not the deepest voice.

| Voice | Pitch | Region | Style |
|---|---|---|---|
| `Đức Trí` | 100 Hz | Southern | storytelling |
| `Phạm Tuyên` | 108 Hz | Northern | natural |
| `Xuân Vĩnh` | 123 Hz | Southern | natural |
| `Thái Sơn` | 128 Hz | Southern | storytelling |
| `Quang Sơn` | 135 Hz | Central | natural |
| `Thanh Bình` | 151 Hz | Northern | storytelling (default) |
| `Minh Triết` | 153 Hz | Southern | news |
| `Minh Đức` | 155 Hz | Northern | news |

```bash
npm run tts:compare     # synthesise every male preset and measure its pitch
```

Set it in `.env`:

```env
TTS_ENGINE=vieneu
TTS_VOICE=Thanh Bình
TTS_REFERENCE_AUDIO=
```

### Cloning a specific voice

Put a clean 3–8 second WAV clip at `assets/voices/adam_vi.wav`, then:

```env
TTS_VOICE=adam_vi
TTS_REFERENCE_AUDIO=assets/voices/adam_vi.wav
```

Cloning needs the PyTorch engine, which the default install leaves out because
it is several gigabytes:

```bash
./.venv-vieneu/bin/python3 -m pip install 'vieneu[legacy]'
```

The reference clip is encoded once, registered with `add_voice` and persisted
with `save_voices`, so later runs load the cached embedding rather than
re-analysing the clip.

If `TTS_REFERENCE_AUDIO` names a file that is not there, the job fails and names
the path. It never silently substitutes another voice — a series of videos that
quietly changes speaker halfway is worse than one that stops.

### Test the voice without rendering

```bash
npm run tts:test        # writes tmp/test_adam_vi.wav
afplay tmp/test_adam_vi.wav
```

### CPU / GPU

CUDA is used when available, CPU otherwise, chosen at startup and logged:

```
[vieneu] loading VieNeu-TTS v3 Turbo on CPU...
[vieneu] model ready in 4.9s, 19 preset voices
```

On Apple Silicon this runs on CPU via ONNX. Model load is roughly 5 seconds
after the first download; synthesis of a 20-second narration takes about 15
seconds.

The model is loaded **once per run** by a long-lived worker process, so a batch
of videos pays the startup cost a single time.

### Subtitle timing

VieNeu returns audio only — unlike the Edge service it replaced, it reports no
word boundaries. Rather than add a forced-alignment model, narration is
synthesised sentence by sentence so every sentence boundary is measured, and
word positions are interpolated within each sentence by syllable weight.

Scene cuts fall on sentence boundaries and stay exact; caption highlighting is
accurate to within a sentence rather than drifting across the whole video.

### Other engines

`TTS_ENGINE` also accepts:

- `edge` — Microsoft Edge TTS. No model download and runs on Python 3.7+, so it
  remains the fallback on a machine where VieNeu will not install. Two
  Vietnamese voices only.
- `mock` — silent audio for offline development. Stamped `devMock: true` in
  `job.json` and never published.

## Running the pipeline

```bash
npm run prepare:project -- workspace/AI-Shorts/01_INPUT/<project>
npm run generate -- <project>
```

Full command reference in [HUONG-DAN.md](HUONG-DAN.md).

## Development

```bash
npm test
npm run typecheck
```
