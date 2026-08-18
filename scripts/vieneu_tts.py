#!/usr/bin/env python3
"""VieNeu-TTS v3 Turbo worker for the Node pipeline.

Runs as a long-lived process speaking newline-delimited JSON on stdin/stdout.
That shape is deliberate: VieNeu loads a neural model and its voice embeddings
at startup, which is far too expensive to repeat per sentence - or per video in
a batch. Node keeps one worker alive and streams requests through it, so the
model is paid for once per run however many videos follow.

Protocol
--------
Requests (one JSON object per line on stdin):
    {"op": "info"}
    {"op": "synthesize", "id": "...", "text": "...", "voice": "...",
     "out": "/abs/path/voice.wav"}

Responses (one JSON object per line on stdout):
    {"ok": true,  "op": "info", ...}
    {"ok": true,  "id": "...", "audioPath": "...", "durationSec": 12.34,
     "sampleRate": 48000, "chunks": [{"text": "...", "fromMs": 0, "toMs": 1200}]}
    {"ok": false, "id": "...", "error": "...", "code": "..."}

Anything the library prints goes to stderr, so stdout stays a clean protocol
channel.

Why chunks come back
--------------------
VieNeu returns audio only - no word boundaries, unlike the Edge service it
replaces. The pipeline needs timings for caption highlighting and for placing
scene cuts on real speech. Synthesising sentence by sentence gives an exact
measured duration per sentence, and Node interpolates word positions inside
each one. That keeps subtitle timing without adding a forced-alignment model.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

SAMPLE_RATE = 48_000  # v3 Turbo native; never resampled here

# Silence inserted between sentences. Long enough to read as a natural breath,
# short enough that a five-sentence narration does not drag.
SENTENCE_GAP_MS = 180


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(message: str) -> None:
    sys.stderr.write(f"[vieneu] {message}\n")
    sys.stderr.flush()


# --------------------------------------------------------------------------
# Text normalisation
# --------------------------------------------------------------------------

_CURRENCY_WORDS = {
    "đ": "đồng",
    "vnđ": "đồng",
    "vnd": "đồng",
    "₫": "đồng",
}


def normalize_vietnamese(text: str) -> str:
    """Tidies text for speech without changing what it says.

    Kept conservative on purpose: the narration has already passed a fact guard
    that checks every number against the product data, so rewriting figures here
    could turn approved copy into a claim nobody checked. Only forms that are
    unreadable aloud are touched.
    """
    if not text:
        return ""

    out = text.replace("\r\n", "\n").replace("\r", "\n")

    # A URL read character by character is unbearable; the domain carries the
    # meaning and the rest is noise in a spoken script.
    out = re.sub(
        r"https?://(?:www\.)?([^\s/]+)\S*",
        lambda m: m.group(1).replace(".", " chấm "),
        out,
    )

    # Currency suffix -> spoken word. "399.000đ" becomes "399.000 đồng" and the
    # engine's own number handling reads the digits.
    for symbol, word in _CURRENCY_WORDS.items():
        out = re.sub(
            rf"(\d)\s*{re.escape(symbol)}(?![\w])",
            rf"\1 {word}",
            out,
            flags=re.IGNORECASE,
        )

    # "20%" -> "20 phần trăm"
    out = re.sub(r"(\d)\s*%", r"\1 phần trăm", out)

    # Symbols with no natural reading.
    out = out.replace("&", " và ").replace("+", " cộng ")

    # Collapse whitespace, but keep sentence punctuation for the chunker.
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\n{2,}", "\n", out)
    out = re.sub(r" *\n *", " ", out)

    return out.strip()


_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")
# A sentence beyond this is split further at clause boundaries; very long inputs
# degrade prosody and raise the cost of a retry if synthesis fails.
MAX_CHUNK_CHARS = 220


def split_sentences(text: str) -> list[str]:
    """Splits narration into synthesis chunks, never mid-word."""
    rough = [s.strip() for s in _SENTENCE_END.split(text) if s.strip()]

    chunks: list[str] = []
    for sentence in rough:
        if len(sentence) <= MAX_CHUNK_CHARS:
            chunks.append(sentence)
            continue

        # Prefer clause punctuation, then fall back to word boundaries so a
        # split can never land inside a word.
        parts = re.split(r"(?<=[,;:])\s+", sentence)
        buffer = ""
        for part in parts:
            candidate = f"{buffer} {part}".strip()
            if len(candidate) <= MAX_CHUNK_CHARS:
                buffer = candidate
                continue
            if buffer:
                chunks.append(buffer)
            if len(part) <= MAX_CHUNK_CHARS:
                buffer = part
            else:
                words = part.split()
                buffer = ""
                for word in words:
                    trial = f"{buffer} {word}".strip()
                    if len(trial) > MAX_CHUNK_CHARS and buffer:
                        chunks.append(buffer)
                        buffer = word
                    else:
                        buffer = trial
        if buffer:
            chunks.append(buffer)

    return chunks or ([text.strip()] if text.strip() else [])


# --------------------------------------------------------------------------
# Engine
# --------------------------------------------------------------------------


class VieNeuEngine:
    """Owns the model and the registered voices for the life of the process."""

    def __init__(self, reference_audio: str | None, voice_name: str) -> None:
        import numpy as np  # noqa: F401 - imported early so failures surface here
        from vieneu import Vieneu

        started = time.time()
        self.voice_name = voice_name
        self.device = self._detect_device()

        _log(f"loading VieNeu-TTS v3 Turbo on {self.device}...")
        self.vieneu = Vieneu()
        self.presets = {label: vid for label, vid in self.vieneu.list_preset_voices()}
        _log(f"model ready in {time.time() - started:.1f}s, {len(self.presets)} preset voices")

        self.reference_audio = reference_audio
        self.voice_ready = False
        if reference_audio:
            self._register_reference(reference_audio, voice_name)

    @staticmethod
    def _detect_device() -> str:
        """CUDA when it is genuinely usable, CPU otherwise - never a crash."""
        try:
            import torch  # type: ignore

            if torch.cuda.is_available():
                return "CUDA"
        except Exception:
            pass
        return "CPU"

    def _register_reference(self, reference_audio: str, voice_name: str) -> None:
        """Encodes the reference clip once and persists it.

        add_voice does the expensive analysis; save_voices writes it to VieNeu's
        own store so later processes skip that work entirely. Re-encoding per
        sentence - or per video - would dominate the runtime.
        """
        path = Path(reference_audio)
        if not path.is_file():
            raise FileNotFoundError(
                f"Vietnamese reference voice not found:\n  {path}\n"
                "Place a 3-8 second clean WAV clip there, or set TTS_VOICE to a "
                "built-in preset voice."
            )

        if voice_name in self.presets or voice_name in self.presets.values():
            _log(f"'{voice_name}' is a built-in preset; ignoring the reference clip")
            self.voice_ready = True
            return

        try:
            _log(f"registering voice '{voice_name}' from {path.name}...")
            started = time.time()
            self.vieneu.add_voice(voice_name, str(path))
            self.vieneu.save_voices()
            self.voice_ready = True
            _log(f"voice registered and cached in {time.time() - started:.1f}s")
        except Exception as exc:
            # Cloning needs the PyTorch engine; the light ONNX install cannot do
            # it. Say so precisely rather than falling back to another voice,
            # which would silently change how every video sounds.
            raise RuntimeError(
                f"Could not register '{voice_name}' from {path}: {type(exc).__name__}: {exc}\n"
                "Voice cloning requires the PyTorch engine: pip install 'vieneu[legacy]'.\n"
                "Alternatively set TTS_VOICE to one of the built-in preset voices, "
                "which work on the CPU-only install."
            ) from exc

    def info(self) -> dict:
        return {
            "engine": "VieNeu-TTS v3 Turbo",
            "voice": self.voice_name,
            "device": self.device,
            "sampleRate": SAMPLE_RATE,
            "referenceAudio": self.reference_audio,
            "voiceReady": self.voice_ready,
            "presetVoices": sorted(self.presets.keys()),
        }

    def synthesize(self, text: str, out_path: str, voice: str | None = None) -> dict:
        import numpy as np
        import soundfile as sf

        normalized = normalize_vietnamese(text)
        if not normalized:
            raise ValueError("Refusing to synthesize empty text")

        target_voice = voice or self.voice_name
        chunks = split_sentences(normalized)

        segments: list[Any] = []
        timings: list[dict] = []
        cursor_samples = 0
        gap = np.zeros(int(SAMPLE_RATE * SENTENCE_GAP_MS / 1000), dtype=np.float32)

        for index, chunk in enumerate(chunks):
            audio = self.vieneu.infer(chunk, voice=target_voice)
            audio = np.asarray(audio, dtype=np.float32).reshape(-1)

            if audio.size == 0:
                raise RuntimeError(f"VieNeu returned no audio for chunk {index + 1}: {chunk!r}")

            from_ms = cursor_samples / SAMPLE_RATE * 1000
            to_ms = (cursor_samples + audio.size) / SAMPLE_RATE * 1000
            timings.append({"text": chunk, "fromMs": round(from_ms, 2), "toMs": round(to_ms, 2)})

            segments.append(audio)
            cursor_samples += audio.size

            if index < len(chunks) - 1:
                segments.append(gap)
                cursor_samples += gap.size

        combined = np.concatenate(segments) if segments else np.zeros(0, dtype=np.float32)

        # Normalise peak rather than per-chunk gain: consecutive sentences keep
        # their relative loudness, so the delivery does not pulse between them.
        peak = float(np.max(np.abs(combined))) if combined.size else 0.0
        if peak > 0:
            combined = combined * (0.95 / peak)

        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(out), combined, SAMPLE_RATE, subtype="PCM_16")

        duration = combined.size / SAMPLE_RATE
        if duration <= 0:
            raise RuntimeError("Synthesis produced a zero-length file")

        return {
            "audioPath": str(out),
            "durationSec": round(duration, 4),
            "sampleRate": SAMPLE_RATE,
            "chunks": timings,
            "normalizedText": normalized,
        }


# --------------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------------


def serve(engine: VieNeuEngine) -> None:
    _emit({"ok": True, "op": "ready", **engine.info()})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            _emit({"ok": False, "code": "BAD_REQUEST", "error": str(exc)})
            continue

        op = request.get("op")
        request_id = request.get("id")

        try:
            if op == "info":
                _emit({"ok": True, "id": request_id, "op": "info", **engine.info()})
            elif op == "synthesize":
                result = engine.synthesize(
                    request["text"], request["out"], request.get("voice")
                )
                _emit({"ok": True, "id": request_id, **result})
            elif op == "shutdown":
                _emit({"ok": True, "id": request_id, "op": "shutdown"})
                return
            else:
                _emit({"ok": False, "id": request_id, "code": "UNKNOWN_OP", "error": f"op={op!r}"})
        except Exception as exc:  # noqa: BLE001 - every failure is reported, not raised
            _emit(
                {
                    "ok": False,
                    "id": request_id,
                    "code": type(exc).__name__,
                    "error": str(exc),
                }
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="VieNeu-TTS v3 Turbo worker")
    parser.add_argument("--serve", action="store_true", help="JSON-lines worker on stdin/stdout")
    parser.add_argument("--info", action="store_true", help="print engine info and exit")
    parser.add_argument("--text", help="one-shot synthesis")
    parser.add_argument("--out", help="output wav path for --text")
    parser.add_argument("--voice", default=os.environ.get("TTS_VOICE", "adam_vi"))
    parser.add_argument("--reference", default=os.environ.get("TTS_REFERENCE_AUDIO"))
    args = parser.parse_args()

    try:
        engine = VieNeuEngine(args.reference, args.voice)
    except Exception as exc:  # noqa: BLE001
        _emit({"ok": False, "code": type(exc).__name__, "error": str(exc)})
        sys.exit(3)

    if args.info:
        _emit({"ok": True, **engine.info()})
        return

    if args.text:
        if not args.out:
            _emit({"ok": False, "code": "BAD_ARGS", "error": "--out is required with --text"})
            sys.exit(2)
        try:
            _emit({"ok": True, **engine.synthesize(args.text, args.out)})
        except Exception as exc:  # noqa: BLE001
            _emit({"ok": False, "code": type(exc).__name__, "error": str(exc)})
            sys.exit(4)
        return

    serve(engine)


if __name__ == "__main__":
    main()
