# Voices

Nothing needs to go in this folder.

The narrator is a hosted Edge neural voice, chosen by name in `.env`:

```
TTS_VOICE=en-US-AvaNeural
```

There is no model to download and no reference clip to record. This directory is
kept because `assets/music/` and `assets/sfx/` sit beside it and the three are
referenced together in the docs; if a future engine needs a local voice file,
here is where it goes.

## Choosing a voice

Names are not descriptions. Render the shortlist and listen to it:

```bash
npm run tts:sample      # writes runtime/voice-samples/*.mp3
npm run tts:voices      # every English voice the service offers
```

The shortlist comes from the service's own personality tags:

| Voice | Tag |
|---|---|
| `en-US-AriaNeural` | News, Novel (the default) |
| `en-US-MichelleNeural` | News, Novel — warmer than Aria |
| `en-US-EmmaMultilingualNeural` | Cheerful, Clear, Conversational |
| `en-US-AvaMultilingualNeural` | Expressive, Caring, Pleasant |
| `en-GB-LibbyNeural` | youngest-sounding British adult voice |
| `en-US-AnaNeural` | Cartoon, Cute — a child voice that blurs over a long read |

There is no expression control beyond the voice: this endpoint ignores SSML
styles (`mstts:express-as`), so how lively the read is comes from which voice
you pick, plus `TTS_RATE`, `TTS_PITCH` and `TTS_VOLUME`. Changing either changes how many
words fit in an episode — see `WORDS_PER_MINUTE` in `src/domain/config.ts`.
