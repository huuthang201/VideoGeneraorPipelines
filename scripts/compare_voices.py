#!/usr/bin/env python3
"""Auditions every male (or every) preset voice on one sentence.

Run:  npm run tts:compare
      npm run tts:compare -- --all

Writes one file per voice plus a single concatenated file, and prints each
voice's measured median pitch. The pitch number matters more than it sounds:
asked for a deep narration voice, the obvious-looking pick by name and style
description turned out to be one of the *highest* male presets, and only
measuring made that visible.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from vieneu_tts import VieNeuEngine  # noqa: E402

TEXT = (
    "Chiếc bình giữ nhiệt này giữ nóng suốt mười hai tiếng. "
    "Thép không gỉ, nắp chống rò, quăng vô balo thoải mái."
)
OUT_DIR = Path("tmp/voices")


def median_pitch(path: Path) -> float | None:
    """Median f0 in Hz. Lower is deeper; a deep male narration voice is ~95-110."""
    try:
        import warnings

        import librosa
        import numpy as np

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            audio, rate = librosa.load(str(path), sr=16_000)
            f0 = librosa.yin(audio, fmin=60, fmax=300, sr=rate)
        finite = f0[np.isfinite(f0)]
        return float(np.median(finite)) if finite.size else None
    except Exception:
        return None


def main() -> int:
    want_all = "--all" in sys.argv
    engine = VieNeuEngine(None, os.environ.get("TTS_VOICE", "Phạm Tuyên"))

    voices = []
    for label in engine.info()["presetVoices"]:
        name, _, rest = label.partition("—")
        gender = rest.strip().split("·")[0].strip()
        if want_all or gender == "Nam":
            voices.append((name.strip(), rest.strip()))

    if not voices:
        print("No matching preset voices found.")
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Synthesising {len(voices)} voices...\n")

    results = []
    for index, (name, description) in enumerate(voices, 1):
        out = OUT_DIR / f"{index:02d}.wav"
        engine.synthesize(f"Giọng số {index}. {TEXT}", str(out), voice=name)
        results.append((index, name, description, out))
        print(f"  {index}. {name}", flush=True)

    print("\nMeasured pitch, deepest first:\n")
    measured = [(median_pitch(path) or 999, i, name, desc) for i, name, desc, path in results]
    for pitch, index, name, description in sorted(measured):
        shown = f"{pitch:6.1f} Hz" if pitch < 999 else "      ?  "
        print(f"  {index}. {name:12} {shown}  {description}")

    print(f"\n{len(results)} files in {OUT_DIR}/")
    print("Listen:  afplay tmp/voices/01.wav")
    print("\nSet the one you want in .env:  TTS_VOICE=<name>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
