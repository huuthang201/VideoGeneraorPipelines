#!/usr/bin/env bash
#
# Creates the Python environment for VieNeu-TTS, the local narrator.
#
# A second venv rather than adding to the edge-tts one, because the two have
# nothing in common: edge-tts is a websocket client with no dependencies worth
# the name, while VieNeu pulls in onnxruntime, numpy, scipy, librosa and a few
# hundred megabytes of model weights. Keeping them apart means an installation
# problem in one cannot take the other down - and `--mock-tts` and the Edge
# fallback both stay available while this one is being fixed.
#
# The model itself is downloaded on first use from Hugging Face and cached under
# ~/.cache/huggingface, so this script only installs the code.
set -euo pipefail

cd "$(dirname "$0")/.."

VENV_DIR=".venv-vieneu"

if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtualenv at $VENV_DIR"
  # 3.10+ is required: the package uses match statements and modern typing.
  python3 -m venv "$VENV_DIR"
fi

echo "Upgrading pip"
"$VENV_DIR/bin/python3" -m pip install --quiet --upgrade pip

echo "Installing vieneu (CPU / ONNX build)"
"$VENV_DIR/bin/python3" -m pip install --quiet 'vieneu>=3.2.7'

echo
echo "Installed:"
"$VENV_DIR/bin/python3" -m pip show vieneu | grep -E '^(Name|Version):'

echo
echo "Loading the model and listing voices (first run downloads it)..."
if "$VENV_DIR/bin/python3" "$(dirname "$0")/vieneu_synth.py" --list-voices >/dev/null 2>&1; then
  echo "OK - VieNeu is ready. Run 'npm run tts:voices' to see the voices."
else
  echo
  echo "WARNING: vieneu is installed but the model could not be loaded."
  echo "The first load downloads a few hundred megabytes from Hugging Face;"
  echo "check the network, then run 'npm run tts:voices' to retry."
  exit 0
fi
