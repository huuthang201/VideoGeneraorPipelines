#!/usr/bin/env bash
#
# Installs VieNeu-TTS into its own virtualenv.
#
# Separate from .venv because the two have incompatible requirements: edge-tts
# runs on the system Python 3.9, while vieneu needs 3.10+. Keeping them apart
# means installing one cannot break the other, and the Edge fallback stays
# available on a machine where VieNeu will not build.
set -euo pipefail

cd "$(dirname "$0")/.."

VENV_DIR=".venv-vieneu"
PYTHON_BIN="${VIENEU_PYTHON:-}"

# vieneu declares >=3.10 and publishes classifiers up to 3.13. 3.14 is avoided
# because its dependency wheels (onnxruntime, librosa) are not all published yet.
if [ -z "$PYTHON_BIN" ]; then
  for candidate in python3.13 python3.12 python3.11 python3.10; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_BIN="$(command -v "$candidate")"
      break
    fi
  done
fi

if [ -z "$PYTHON_BIN" ]; then
  for candidate in /opt/homebrew/opt/python@3.1{3,2,1,0}/bin/python3.1{3,2,1,0}; do
    [ -x "$candidate" ] && PYTHON_BIN="$candidate" && break
  done
fi

if [ -z "$PYTHON_BIN" ]; then
  echo "No suitable Python found. VieNeu-TTS needs Python 3.10-3.13."
  echo
  echo "  macOS:  brew install python@3.12"
  echo "  Ubuntu: sudo apt install python3.12 python3.12-venv"
  echo
  echo "Then re-run: npm run setup:vieneu"
  exit 1
fi

echo "Using $PYTHON_BIN ($("$PYTHON_BIN" --version))"

if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python3" -m pip install --quiet --upgrade pip
echo "Installing vieneu (this pulls onnxruntime and a few hundred MB of model)..."
"$VENV_DIR/bin/python3" -m pip install --quiet vieneu

echo
"$VENV_DIR/bin/python3" -m pip show vieneu | grep -E '^(Name|Version):'

echo
echo "Downloading the model on first use..."
"$VENV_DIR/bin/python3" scripts/vieneu_tts.py --info 2>&1 | tail -2

cat <<'NOTE'

Done.

  npm run tts:voices   list the built-in Vietnamese voices
  npm run tts:test     synthesise a sample to tmp/test_adam_vi.wav

Voice cloning from assets/voices/adam_vi.wav additionally needs the PyTorch
engine, which the default install deliberately leaves out:

  ./.venv-vieneu/bin/python3 -m pip install 'vieneu[legacy]'

Built-in preset voices work without it.
NOTE
