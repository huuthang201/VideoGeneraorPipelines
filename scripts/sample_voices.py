#!/usr/bin/env python3
"""Renders one sentence in each candidate narrator voice, so the choice can be
made by ear.

A voice name tells you almost nothing. "en-US-AvaNeural" and "en-GB-MaisieNeural"
are both described as female and young, and they sound nothing alike over ten
minutes of narration. This writes a short clip for each so they can be played
back to back and one of them put in TTS_VOICE.

The sentence matters as much as the voice: it is written to expose exactly what
goes wrong in a slow read - a long clause that has to hold its shape, a comma the
voice has to actually pause on, and an ordinary word ("something") whose vowel is
where a synthetic voice usually gives itself away.

Usage:
    npm run tts:sample                 # the shortlist, into runtime/voice-samples
    npm run tts:sample -- --all-en     # every English voice the service offers
    npm run tts:voices                 # just list them, no audio

Exit codes:
    0  success (including "some voices failed" - the rest are still written)
    2  edge-tts is not installed
    4  the service could not be reached at all
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# The shortlist, kept in step with ENGLISH_VOICES in src/tts/types.ts. Duplicated
# rather than imported because this is a standalone Python script and a build
# step to share six strings would cost more than it saves - but if one list
# changes, change the other.
SHORTLIST = [
    ("en-US-AriaNeural", "News, Novel - the default"),
    ("en-US-MichelleNeural", "News, Novel - a shade warmer than Aria"),
    ("en-US-EmmaMultilingualNeural", "Cheerful, Clear, Conversational"),
    ("en-US-AvaMultilingualNeural", "Expressive, Caring, Pleasant"),
    ("en-US-EmmaNeural", "single-language build of EmmaMultilingual"),
    ("en-US-AvaNeural", "single-language build of AvaMultilingual"),
    ("en-US-JennyNeural", "Friendly, Considerate, Comfort"),
    ("en-GB-LibbyNeural", "youngest-sounding British adult voice"),
    ("en-GB-SoniaNeural", "clear British; lift the pitch to make it younger"),
    ("en-IE-EmilyNeural", "Irish, young and lilting"),
    ("en-SG-LunaNeural", "Singapore English, light and young"),
    ("en-US-AnaNeural", "Cute (cartoon) - a real child voice; blurs over a long read"),
]

# Two halves, because a voice can fail either test on its own.
#
# The first half is prose with the intonation traps in it: a question, a
# mid-sentence turn, and a falling ending. A flat voice and a lively one read a
# plain declarative sentence almost identically; they part company here.
#
# The second half is a diction test - consonant clusters, final consonants,
# numbers and a four-item list. That half exists because the first default this
# tool shipped with was the service's child voice, and it was rejected on
# listening: charming for a sentence, and by a paragraph the words had stopped
# being distinguishable.
SAMPLE_TEXT = (
    "So, where were we? Ah, right. The rain. "
    "It started sometime after midnight, and by the time anyone was awake to "
    "notice, it had already changed the whole street: the smell of it, the "
    "sound of the tires, the way the light came through the window. "
    "Isn't that strange? Something enormous happens, and nobody sees it begin. "
    "Now, a quick check: twelve, thirty, forty-five. Strictly speaking, the "
    "eighth street lamp still flickers, and the shopkeeper's list said bread, "
    "salt, matches, string. Did you catch all of that? "
    "Good. Get comfortable. We have a little while yet."
)

DEFAULT_RATE = "-20%"
DEFAULT_VOLUME = "-15%"
DEFAULT_PITCH = "+18Hz"


async def english_voices() -> list[tuple[str, str]]:
    import edge_tts

    voices = await edge_tts.list_voices()
    return sorted(
        (v["ShortName"], f"{v.get('Gender', '?')}, {v.get('Locale', '?')}")
        for v in voices
        if v.get("Locale", "").lower().startswith("en-")
    )


async def render(voice: str, text: str, out_path: Path, rate: str, pitch: str, volume: str) -> bool:
    import edge_tts

    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    written = 0
    try:
        with open(out_path, "wb") as fh:
            async for chunk in communicate.stream():
                if chunk.get("type") == "audio":
                    data = chunk.get("data") or b""
                    fh.write(data)
                    written += len(data)
    except Exception as exc:  # noqa: BLE001 - one bad voice must not stop the rest
        print(f"  {voice}: FAILED ({type(exc).__name__}: {exc})")
        out_path.unlink(missing_ok=True)
        return False

    if written == 0:
        print(f"  {voice}: FAILED (no audio returned)")
        out_path.unlink(missing_ok=True)
        return False

    print(f"  {voice}: {out_path} ({written // 1024} KB)")
    return True


async def main_async(args: argparse.Namespace) -> int:
    if args.list:
        for name, detail in await english_voices():
            print(f"{name:<28} {detail}")
        return 0

    if args.all_en:
        # english_voices() already filters to en-* locales: the narrator has to
        # be English, so a multilingual voice from another locale is not a
        # candidate here however well it reads the language.
        candidates = [(name, detail) for name, detail in await english_voices()]
    else:
        candidates = SHORTLIST

    out_dir = Path(args.out_dir)
    print(f"Writing {len(candidates)} sample(s) to {out_dir}")
    print(f"rate={args.rate} pitch={args.pitch} volume={args.volume}\n")

    ok = 0
    for name, detail in candidates:
        print(f"{name} - {detail}")
        if await render(name, args.text, out_dir / f"{name}.mp3", args.rate, args.pitch, args.volume):
            ok += 1

    print(f"\n{ok}/{len(candidates)} rendered.")
    if ok:
        print(f"Play them, pick one, then set TTS_VOICE in .env.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Render narrator voice samples")
    parser.add_argument("--list", action="store_true", help="list English voices only")
    parser.add_argument("--all-en", action="store_true", help="sample every English voice")
    parser.add_argument("--out-dir", default="runtime/voice-samples")
    parser.add_argument("--text", default=SAMPLE_TEXT)
    parser.add_argument("--rate", default=DEFAULT_RATE)
    parser.add_argument("--pitch", default=DEFAULT_PITCH)
    parser.add_argument("--volume", default=DEFAULT_VOLUME)
    args = parser.parse_args()

    try:
        import edge_tts  # noqa: F401
    except ImportError:
        print("edge-tts is not installed in this interpreter. Run: npm run setup:python")
        sys.exit(2)

    try:
        sys.exit(asyncio.run(main_async(args)))
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"Could not reach Edge TTS: {type(exc).__name__}: {exc}")
        sys.exit(4)


if __name__ == "__main__":
    main()
