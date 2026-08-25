#!/usr/bin/env python3
"""Vietnamese speech synthesis through VieNeu-TTS, for the Node pipeline.

VieNeu runs locally: the model is downloaded once from Hugging Face and then
inference is CPU-only ONNX, about five times faster than real time on this
machine. That buys three things Edge TTS could not offer - nineteen named
voices instead of two, southern and central accents instead of northern only,
and no dependence on an unofficial endpoint that periodically starts refusing
clients.

What it costs is **word timings**. Edge reports a boundary event per spoken
word; VieNeu returns a waveform and nothing else. The captions and the scene
cuts are both built on those timings, so this script reconstructs them:

  1. The script is split into sentences, and each is synthesised on its own.
  2. They are joined back with the same 0.18s sentence gap VieNeu itself uses
     internally, so the audio is what a single call would have produced.
  3. Every sentence's *measured* duration is therefore known, and the words
     inside it are laid across that span weighted by syllable length.

So sentence boundaries are exact and word positions within a sentence are
estimated. That is the right way round: a caption page breaks at a sentence or
a pause, which is now accurate, and the word highlight inside a page can be a
few tens of milliseconds out without anybody noticing.

Non-verbal cues - [cười], [thở dài], [hắng giọng] - are spoken by the model but
are not words, so they are dropped from the timings and never reach a subtitle.

Speed is NOT applied here. Node stretches the audio afterwards with ffmpeg and
scales these timings to match, because ffmpeg's atempo handles speech far
better than a phase vocoder does, and Node already owns the media tooling.

Usage:
    vieneu_synth.py --text-file in.txt --voice "Thái Sơn" --out voice.wav
    vieneu_synth.py --list-voices

Exit codes:
    0  success
    2  bad arguments, or vieneu is not installed
    3  synthesis produced no audio
    4  model load or inference failure
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Sentence end, keeping the punctuation with the sentence it closes. Vietnamese
# uses the same marks as English here, so this needs no locale knowledge.
SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+")

# The model's non-verbal cues. Spoken, but not words - see the note above.
CUE = re.compile(r"\[[^\]]{1,24}\]")

# Silence between two sentences, in seconds. This is VieNeu's own
# V3_GAP_SILENCE["sentence"], repeated here rather than imported so that a
# change upstream is a change we notice rather than one that silently moves
# every caption in every video.
SENTENCE_GAP_SECONDS = 0.18

# A word's share of its sentence is a constant plus its length: every syllable
# carries onset and release regardless of how many letters spell it, so pure
# character-count weighting makes long words too long and short ones too short.
BASE_WEIGHT = 2.5

# Fraction of a word's slot left as a gap, so the caption highlight steps from
# word to word rather than sliding continuously.
INTER_WORD_GAP = 0.1


def _fail(code: int, message: str) -> None:
    print(json.dumps({"ok": False, "error": message}), file=sys.stdout)
    sys.exit(code)


def list_voices() -> None:
    from vieneu import Vieneu

    engine = Vieneu()
    print(
        json.dumps(
            {
                "ok": True,
                "voices": [
                    {"name": voice_id, "label": label}
                    for label, voice_id in engine.list_preset_voices()
                ],
            },
            ensure_ascii=False,
        )
    )


def word_timings(sentence: str, start_ms: float, end_ms: float) -> list[dict]:
    """Lay a sentence's words across the span it was measured to occupy."""
    tokens = [t for t in CUE.sub(" ", sentence).split() if t]
    span = end_ms - start_ms
    if not tokens or span <= 0:
        return []

    weights = [BASE_WEIGHT + len(re.sub(r"[^\w]", "", t, flags=re.UNICODE)) for t in tokens]
    total = sum(weights) or 1.0

    out: list[dict] = []
    cursor = start_ms
    for token, weight in zip(tokens, weights):
        slot = (weight / total) * span
        out.append(
            {
                "text": token,
                "fromMs": round(cursor, 2),
                "toMs": round(cursor + slot * (1 - INTER_WORD_GAP), 2),
            }
        )
        cursor += slot
    return out


def synthesize(text: str, voice: str | None, out_path: Path) -> None:
    import numpy as np
    import soundfile as sf
    from vieneu import Vieneu

    sentences = [s.strip() for s in SENTENCE_SPLIT.split(text.strip()) if s.strip()]
    if not sentences:
        _fail(2, "Text file is empty; narration is mandatory")

    engine = Vieneu()
    sample_rate = engine.sample_rate

    chunks: list = []
    words: list[dict] = []
    cursor_ms = 0.0

    for index, sentence in enumerate(sentences):
        # One call per sentence. VieNeu still chunks internally when a sentence
        # is longer than its character ceiling, so nothing is lost by doing the
        # sentence-level split out here.
        wav = engine.infer(sentence, voice=voice) if voice else engine.infer(sentence)
        if wav is None or len(wav) == 0:
            _fail(3, f"VieNeu returned no audio for sentence {index + 1}")

        duration_ms = (len(wav) / sample_rate) * 1000.0
        words.extend(word_timings(sentence, cursor_ms, cursor_ms + duration_ms))

        chunks.append(wav)
        cursor_ms += duration_ms
        if index < len(sentences) - 1:
            cursor_ms += SENTENCE_GAP_SECONDS * 1000.0

    gap = np.zeros(int(sample_rate * SENTENCE_GAP_SECONDS), dtype=chunks[0].dtype)
    joined = chunks[0]
    for chunk in chunks[1:]:
        joined = np.concatenate([joined, gap, chunk])

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), joined, sample_rate)

    print(
        json.dumps(
            {
                "ok": True,
                "audioPath": str(out_path),
                "bytes": out_path.stat().st_size,
                "sampleRate": sample_rate,
                "durationMs": round((len(joined) / sample_rate) * 1000.0, 2),
                "speechEndMs": round(cursor_ms, 2),
                "sentences": len(sentences),
                "words": words,
            },
            ensure_ascii=False,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="VieNeu-TTS with reconstructed word timings")
    parser.add_argument("--text-file", help="UTF-8 file containing the text to speak")
    parser.add_argument("--voice", default=None, help='preset name, e.g. "Thái Sơn"')
    parser.add_argument("--out", help="Output wav path")
    parser.add_argument("--list-voices", action="store_true")
    args = parser.parse_args()

    try:
        import vieneu  # noqa: F401
    except ImportError:
        _fail(2, "vieneu is not installed in this interpreter. Run: npm run setup:vieneu")

    try:
        if args.list_voices:
            list_voices()
            return

        if not args.text_file or not args.out:
            _fail(2, "--text-file and --out are required unless --list-voices is given")

        text = Path(args.text_file).read_text(encoding="utf-8").strip()
        if not text:
            _fail(2, "Text file is empty; narration is mandatory")

        synthesize(text, args.voice, Path(args.out))
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - surface everything to Node as JSON
        _fail(4, f"{type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
