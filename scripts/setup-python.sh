#!/usr/bin/env bash
#
# Creates the project-local Python environment used for text-to-speech.
#
# A venv rather than a global install: the machine's python3 is the Xcode
# Command Line Tools one, and installing into it needs elevated rights and
# pollutes a system interpreter that other tooling depends on.
#
# Only edge-tts is required. It is the whole TTS stack: no model download, no
# GPU, no second interpreter.
set -euo pipefail

cd "$(dirname "$0")/.."

VENV_DIR=".venv"

if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtualenv at $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi

echo "Upgrading pip"
"$VENV_DIR/bin/python3" -m pip install --quiet --upgrade pip

echo "Installing edge-tts"
"$VENV_DIR/bin/python3" -m pip install --quiet 'edge-tts>=7.2.8'

echo
echo "Installed:"
"$VENV_DIR/bin/python3" -m pip show edge-tts | grep -E '^(Name|Version):'

echo
echo "Verifying English voices are reachable..."
if "$VENV_DIR/bin/python3" "$(dirname "$0")/edge_tts_synth.py" --list-voices --locale en-US >/dev/null; then
  echo "OK - Edge TTS is reachable."
else
  echo
  echo "WARNING: could not reach the Edge TTS endpoint."
  echo "This is a known and recurring failure - the service is an unofficial"
  echo "Microsoft endpoint that periodically rejects clients (Sec-MS-GEC token)."
  echo "The pipeline still runs with --mock-tts, but any video produced that"
  echo "way is stamped devMock in job.json and is not publishable."
  exit 0
fi
