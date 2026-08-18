# Voice references

Put a reference clip here to clone a voice:

```
assets/voices/adam_vi.wav
```

Requirements:

- **3–8 seconds** of clean speech, one speaker, no music or background noise
- **WAV**, mono preferred
- The speaker should sound the way you want every video to sound: male, deep,
  firm, clearly articulated, narration pace

The internal voice name is `adam_vi`, set by `TTS_VOICE` in `.env`.

## Cloning needs the PyTorch engine

VieNeu's documentation is explicit: *"Cloning & denoising require PyTorch
engine; built-in voices work everywhere."* The default install is ONNX-only and
cannot clone. To use a reference clip:

```bash
./.venv-vieneu/bin/python3 -m pip install 'vieneu[legacy]'
```

That pulls in torch, transformers and neucodec — several gigabytes.

## Or use a built-in voice instead

VieNeu ships 19 preset Vietnamese voices that work on the light install with no
reference clip at all. List them:

```bash
npm run tts:voices
```

Then set the name you want in `.env` and leave the reference empty:

```
TTS_VOICE=<preset name>
TTS_REFERENCE_AUDIO=
```

The pipeline never silently substitutes a voice: if `TTS_REFERENCE_AUDIO` names
a file that is not there, the job fails with that path in the error.
