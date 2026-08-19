#!/usr/bin/env bash
#
# Installs ComfyUI and the FLUX.1-schnell weights used for b-roll generation.
#
# ComfyUI lives outside the repository (default ~/ComfyUI) because the weights
# alone are over 20 GB and have no business in version control or in a project
# folder that gets copied around. COMFYUI_DIR overrides the location.
#
# Model choice is not a preference. FLUX.1-schnell is Apache 2.0; FLUX.1-dev is
# under a non-commercial licence, and this pipeline produces advertising for
# people selling things, which is commercial use. schnell is also a 4-step
# model where dev needs 20-28, so it is several times faster as well.
set -euo pipefail

COMFYUI_DIR="${COMFYUI_DIR:-$HOME/ComfyUI}"
PYTHON_BIN="${COMFYUI_PYTHON:-}"

if [ -z "$PYTHON_BIN" ]; then
  for candidate in python3.12 python3.11 python3.13 python3.10; do
    command -v "$candidate" >/dev/null 2>&1 && PYTHON_BIN="$(command -v "$candidate")" && break
  done
fi
[ -z "$PYTHON_BIN" ] && [ -x /opt/homebrew/opt/python@3.12/bin/python3.12 ] \
  && PYTHON_BIN=/opt/homebrew/opt/python@3.12/bin/python3.12

if [ -z "$PYTHON_BIN" ]; then
  echo "ComfyUI needs Python 3.10-3.13. On macOS: brew install python@3.12"
  exit 1
fi

echo "python   : $PYTHON_BIN ($("$PYTHON_BIN" --version 2>&1))"
echo "install  : $COMFYUI_DIR"

# fp8 rather than the 22 GB bf16 build: this machine has 24 GB of unified
# memory, and bf16 weights plus the T5 encoder would not fit alongside the OS.
# Swapping costs far more than the quality difference is worth.
# GGUF, not the fp8 safetensors build. PyTorch on MPS has no Float8_e4m3fn
# kernels, so fp8 weights fail at the sampler on Apple Silicon however much
# memory is free - this was verified the hard way after a 16 GB download.
# Q8_0 is near-bf16 quality at 11.8 GB and runs fine on MPS.
UNET_URL="https://huggingface.co/city96/FLUX.1-schnell-gguf/resolve/main/flux1-schnell-Q8_0.gguf"
T5_URL="https://huggingface.co/city96/t5-v1_1-xxl-encoder-gguf/resolve/main/t5-v1_1-xxl-encoder-Q8_0.gguf"
CLIP_URL="https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors"
# The VAE deliberately comes from a repackaged mirror, not from
# black-forest-labs/FLUX.1-schnell. That repository is gated: fetching it
# without an accepted licence and an HF token returns 401, and curl happily
# writes the error page over the destination. Same weights, no gate.
VAE_URL="https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors"

free_gb=$(df -g . | tail -1 | awk '{print $4}')
echo "disk     : ${free_gb} GB free"
if [ "$free_gb" -lt 28 ]; then
  echo
  echo "Need roughly 28 GB free (21 GB of weights plus PyTorch and headroom)."
  exit 1
fi

if [ ! -d "$COMFYUI_DIR/.git" ]; then
  echo
  echo "Cloning ComfyUI..."
  git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git "$COMFYUI_DIR"
fi

cd "$COMFYUI_DIR"

if [ ! -d "venv" ]; then
  "$PYTHON_BIN" -m venv venv
fi
./venv/bin/python3 -m pip install --quiet --upgrade pip

# GGUF weights need city96's loader nodes; ComfyUI cannot read them alone.
if [ ! -d "custom_nodes/ComfyUI-GGUF" ]; then
  echo
  echo "Installing ComfyUI-GGUF..."
  git clone --depth 1 https://github.com/city96/ComfyUI-GGUF.git custom_nodes/ComfyUI-GGUF
fi

echo
echo "Installing PyTorch (MPS build for Apple Silicon)..."
./venv/bin/python3 -m pip install --quiet torch torchvision torchaudio
echo "Installing ComfyUI requirements..."
./venv/bin/python3 -m pip install --quiet -r requirements.txt
./venv/bin/python3 -m pip install --quiet gguf

fetch () {  # url, destination, minimum megabytes
  local url="$1" dest="$2" min_mb="${3:-1}"

  if [ -f "$dest" ] && [ "$(du -m "$dest" | cut -f1)" -ge "$min_mb" ]; then
    echo "  have $(basename "$dest") ($(du -h "$dest" | cut -f1))"
    return
  fi

  echo "  downloading $(basename "$dest")..."
  mkdir -p "$(dirname "$dest")"

  # -f matters more than it looks: without it curl exits 0 on a 404 or a 401
  # and writes the error page to the destination. The first run of this script
  # did exactly that - a gated repository returned 401, a 140-byte HTML file
  # landed where the VAE should be, and setup reported success.
  curl -fL -C - --progress-bar -o "$dest" "$url" || {
    rm -f "$dest"
    echo
    echo "  FAILED: $url"
    echo "  If this is a gated repository, accept its licence on huggingface.co"
    echo "  and export HF_TOKEN, or use an ungated mirror."
    exit 1
  }

  # A download that returns 200 but is far too small is still a failure.
  local got_mb
  got_mb="$(du -m "$dest" | cut -f1)"
  if [ "$got_mb" -lt "$min_mb" ]; then
    rm -f "$dest"
    echo "  FAILED: $(basename "$dest") came back as ${got_mb} MB, expected at least ${min_mb} MB"
    exit 1
  fi
}

echo
echo "Fetching FLUX.1-schnell weights (~21 GB, resumable)..."
fetch "$UNET_URL"  "models/unet/flux1-schnell-Q8_0.gguf" 11000
fetch "$T5_URL"    "models/clip/t5-v1_1-xxl-encoder-Q8_0.gguf"    4000
fetch "$CLIP_URL"  "models/clip/clip_l.safetensors"               200
fetch "$VAE_URL"   "models/vae/ae.safetensors"                    250

cat <<NOTE

Done. Start the server:

  cd $COMFYUI_DIR && ./venv/bin/python3 main.py

Then, from the project:

  python scripts/generate_image.py \\
    --prompt "cinematic photo of a cozy coffee shop at night" \\
    --width 768 --height 1344 --output output/images/test.png

NOTE
