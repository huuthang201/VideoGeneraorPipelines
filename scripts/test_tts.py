#!/usr/bin/env python3
"""Synthesises one Vietnamese sentence and checks the result is usable.

Run:  npm run tts:test
      ./.venv-vieneu/bin/python3 scripts/test_tts.py

Exists so the voice can be auditioned without rendering a video, which takes a
Claude call and a minute of encoding to hear two seconds of speech.
"""

from __future__ import annotations

import os
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from vieneu_tts import VieNeuEngine  # noqa: E402

SAMPLE_TEXT = (
    "Đây là một sản phẩm đang được rất nhiều người quan tâm. "
    "Thiết kế đẹp, hiệu năng tốt và mức giá cực kỳ hấp dẫn."
)
OUT_PATH = Path("tmp/test_adam_vi.wav")


def main() -> int:
    voice = os.environ.get("TTS_VOICE", "adam_vi")
    reference = os.environ.get("TTS_REFERENCE_AUDIO") or None

    if reference and not Path(reference).is_file():
        print(f"Reference voice not found:\n  {reference}\n")
        print("Either place the clip there, or unset TTS_REFERENCE_AUDIO to use")
        print("a built-in preset voice. Run with --list to see the presets.")
        return 1

    print(f"voice     : {voice}")
    print(f"reference : {reference or '(built-in preset)'}")
    print("loading model, this takes a moment on first run...")

    engine = VieNeuEngine(reference, voice)
    info = engine.info()
    print(f"engine    : {info['engine']}")
    print(f"device    : {info['device']}")

    if "--list" in sys.argv:
        print("\npreset voices:")
        for name in info["presetVoices"]:
            print(f"  - {name}")
        return 0

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    result = engine.synthesize(SAMPLE_TEXT, str(OUT_PATH))

    print(f"\nwrote     : {result['audioPath']}")
    print(f"duration  : {result['durationSec']:.2f}s")
    print(f"rate      : {result['sampleRate']} Hz")
    print(f"sentences : {len(result['chunks'])}")

    problems = []

    if not OUT_PATH.is_file():
        problems.append("file was not written")
    elif OUT_PATH.stat().st_size < 1000:
        problems.append(f"file is only {OUT_PATH.stat().st_size} bytes")

    if result["durationSec"] <= 0:
        problems.append("duration is zero")

    if OUT_PATH.is_file():
        with wave.open(str(OUT_PATH)) as wav:
            if wav.getframerate() != result["sampleRate"]:
                problems.append(f"sample rate is {wav.getframerate()}, expected {result['sampleRate']}")
            if wav.getnchannels() != 1:
                problems.append(f"{wav.getnchannels()} channels, expected mono")

            # A file of the right length full of zeroes still plays as nothing,
            # and that is the failure a duration check alone would wave through.
            frames = wav.readframes(wav.getnframes())
            peak = max(frames) if frames else 0
            if peak <= 1:
                problems.append("audio is silent")

    if problems:
        print("\nFAILED:")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    print("\nOK - listen with:  afplay", OUT_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
