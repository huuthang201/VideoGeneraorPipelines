#!/usr/bin/env python3
"""Edge speech synthesis with word-level timings, for the Node pipeline.

Why the streaming API instead of `edge-tts --write-subtitles`
------------------------------------------------------------
The CLI's subtitle output is cue-level: roughly one entry per sentence. This
pipeline needs *word* boundaries for two separate reasons, and neither is
satisfied by sentence cues:

  1. Subtitles highlight the word currently being spoken.
  2. Scene durations are derived by finding which word ends each scene's
     narration, so the timeline lands on real audio positions rather than on
     the model's guess (plan §2.2).

`Communicate.stream()` yields both the audio chunks and WordBoundary events, so
this script writes the mp3 and prints the timings as JSON on stdout in one pass.

Offsets from the service are in 100-nanosecond ticks (the SSML/Azure
convention), converted to milliseconds here so the Node side never has to know
about that unit.

One call carries a whole script - a ten minute podcast episode or a forty
second short. The service accepts an utterance of any length and keeps emitting
boundary events throughout, so nothing needs chunking; a long one just needs a
generous timeout on the Node side. For Vietnamese the boundaries come one per
syllable, which is exactly the granularity the subtitles want.

The Node side always passes --voice explicitly, whichever module is running, so
the defaults below matter only when this is run by hand.

Usage:
    edge_tts_synth.py --text-file in.txt --voice vi-VN-NamMinhNeural \\
        --rate '+8%' --out voice.mp3
    edge_tts_synth.py --list-voices --locale vi-VN
    edge_tts_synth.py --list-voices --locale en-US

Exit codes:
    0  success
    2  bad arguments
    3  synthesis produced no audio
    4  network/service failure (this is the Sec-MS-GEC class of failure)
"""

# The system interpreter here is 3.9, where `str | None` in a signature is
# evaluated at def time and raises. Deferring annotations keeps the modern
# syntax readable without requiring a newer Python than the machine has.
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

TICKS_PER_MS = 10_000


def _fail(code: int, message: str) -> None:
    print(json.dumps({"ok": False, "error": message}), file=sys.stdout)
    sys.exit(code)


async def list_voices(locale: str) -> None:
    """Voices for one locale, or every one in a language when given just "vi"/"en"."""
    import edge_tts

    voices = await edge_tts.list_voices()
    wanted = locale.lower()
    matching = [
        v
        for v in voices
        if v.get("Locale", "").lower() == wanted
        or (len(wanted) == 2 and v.get("Locale", "").lower().startswith(f"{wanted}-"))
    ]
    print(
        json.dumps(
            {
                "ok": True,
                "voices": [
                    {
                        "name": v.get("ShortName"),
                        "gender": v.get("Gender"),
                        "locale": v.get("Locale"),
                    }
                    for v in matching
                ],
            }
        )
    )


async def synthesize(
    text: str,
    voice: str,
    rate: str | None,
    out_path: Path,
    pitch: str | None = None,
    volume: str | None = None,
) -> None:
    import edge_tts

    # Rate is what turns a competent neural read into one that holds a scroller:
    # a few percent above the voice's default is the difference between a
    # newsreader and someone telling you something they just found out.
    kwargs = {}
    if rate:
        kwargs["rate"] = rate
    if pitch:
        kwargs["pitch"] = pitch
    if volume:
        kwargs["volume"] = volume

    # edge-tts 7.x defaults to boundary="SentenceBoundary", which returns a
    # single event for the whole utterance - useless for both caption
    # highlighting and scene alignment. WordBoundary yields one event per word
    # with sub-100ms accuracy.
    communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary", **kwargs)

    words: list[dict] = []
    audio_bytes = 0

    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "wb") as fh:
        async for chunk in communicate.stream():
            kind = chunk.get("type")
            if kind == "audio":
                data = chunk.get("data") or b""
                fh.write(data)
                audio_bytes += len(data)
            elif kind == "WordBoundary":
                offset_ms = chunk["offset"] / TICKS_PER_MS
                duration_ms = chunk["duration"] / TICKS_PER_MS
                words.append(
                    {
                        "text": chunk["text"],
                        "fromMs": round(offset_ms, 2),
                        "toMs": round(offset_ms + duration_ms, 2),
                    }
                )

    if audio_bytes == 0:
        _fail(3, "Edge TTS returned no audio data")

    # The last word boundary is the best in-band estimate of speech end. The
    # container is usually slightly longer; Node measures the real file duration
    # with ffprobe and treats this as a lower bound.
    speech_end_ms = words[-1]["toMs"] if words else 0.0

    print(
        json.dumps(
            {
                "ok": True,
                "audioPath": str(out_path),
                "bytes": audio_bytes,
                "speechEndMs": speech_end_ms,
                "words": words,
            },
            ensure_ascii=False,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Edge TTS with word timings")
    parser.add_argument("--text-file", help="UTF-8 file containing the text to speak")
    parser.add_argument("--voice", default="vi-VN-NamMinhNeural")
    parser.add_argument("--rate", default=None, help="e.g. +8%%")
    parser.add_argument("--pitch", default=None, help="e.g. +0Hz")
    parser.add_argument("--volume", default=None, help="e.g. +0%%")
    parser.add_argument("--out", help="Output mp3 path")
    parser.add_argument("--list-voices", action="store_true")
    parser.add_argument("--locale", default="vi-VN")
    args = parser.parse_args()

    try:
        import edge_tts  # noqa: F401
    except ImportError:
        _fail(2, "edge-tts is not installed in this interpreter. Run: npm run setup:python")

    try:
        if args.list_voices:
            asyncio.run(list_voices(args.locale))
            return

        if not args.text_file or not args.out:
            _fail(2, "--text-file and --out are required unless --list-voices is given")

        text = Path(args.text_file).read_text(encoding="utf-8").strip()
        if not text:
            _fail(2, "Text file is empty; narration is mandatory")

        asyncio.run(
            synthesize(text, args.voice, args.rate, Path(args.out), args.pitch, args.volume)
        )
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - surface everything to Node as JSON
        _fail(4, f"{type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
