#!/usr/bin/env python3
"""Text-to-image through a local ComfyUI instance, default model FLUX.1-schnell.

This is the interface the generate-image skill calls:

    python scripts/generate_image.py \\
      --prompt "..." --width 768 --height 1344 \\
      --output "output/images/name.png"

It talks to ComfyUI's HTTP API rather than importing diffusers directly. That
keeps the model, its weights and its VRAM out of this process: ComfyUI already
solves loading, offloading and queueing, and a pipeline that shells out to it
does not pay a model load per image.

Only the standard library is used, so no virtualenv is needed to run it.

Exit codes:
    0  image written
    2  bad arguments
    3  ComfyUI unreachable
    4  generation failed or produced nothing
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

DEFAULT_SERVER = "http://127.0.0.1:8188"
DEFAULT_WORKFLOW = Path(__file__).parent / "workflows" / "flux-schnell.json"

# FLUX works in multiples of 16; anything else is silently rounded by some nodes
# and hard-errors in others, so it is checked here where the message can be
# useful.
DIMENSION_STEP = 16
POLL_INTERVAL_S = 1.0


def fail(code: int, message: str, hint: str = "") -> None:
    print(f"error: {message}", file=sys.stderr)
    if hint:
        print(hint, file=sys.stderr)
    sys.exit(code)


def check_server(server: str) -> dict:
    try:
        with urllib.request.urlopen(f"{server}/system_stats", timeout=5) as response:
            return json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        fail(
            3,
            f"ComfyUI is not reachable at {server} ({exc})",
            "\nStart it first:\n"
            "  cd /path/to/ComfyUI && python main.py\n\n"
            "The default workflow needs these files in ComfyUI/models/:\n"
            "  unet/flux1-schnell.safetensors\n"
            "  clip/t5xxl_fp8_e4m3fn.safetensors\n"
            "  clip/clip_l.safetensors\n"
            "  vae/ae.safetensors\n\n"
            "Point at a different server with --server, or supply your own\n"
            "graph with --workflow if your model filenames differ.",
        )
    return {}


def build_workflow(path: Path, prompt: str, width: int, height: int, seed: int) -> dict:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        fail(2, f"Could not read workflow {path}: {exc}")

    # Substituted as JSON values so a prompt containing quotes or newlines
    # cannot break the graph.
    raw = raw.replace('"%PROMPT%"', json.dumps(prompt))
    raw = raw.replace('"%WIDTH%"', str(width))
    raw = raw.replace('"%HEIGHT%"', str(height))
    raw = raw.replace('"%SEED%"', str(seed))

    try:
        workflow = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(2, f"Workflow is not valid JSON after substitution: {exc}")

    return {k: v for k, v in workflow.items() if not k.startswith("_")}


def queue_prompt(server: str, workflow: dict, client_id: str) -> str:
    payload = json.dumps({"prompt": workflow, "client_id": client_id}).encode()
    request = urllib.request.Request(
        f"{server}/prompt", data=payload, headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())["prompt_id"]
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:800]
        fail(
            4,
            f"ComfyUI rejected the workflow (HTTP {exc.code})",
            f"\n{detail}\n\nThis usually means a model filename in the workflow does not\n"
            "match what is installed. Check ComfyUI/models/ and adjust\n"
            f"{DEFAULT_WORKFLOW.name} or pass --workflow.",
        )
    except (urllib.error.URLError, TimeoutError) as exc:
        fail(3, f"Lost contact with ComfyUI while queueing: {exc}")
    return ""


def wait_for_images(server: str, prompt_id: str, timeout_s: int) -> list[dict]:
    deadline = time.time() + timeout_s

    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{server}/history/{prompt_id}", timeout=10) as response:
                history = json.loads(response.read())
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(POLL_INTERVAL_S)
            continue

        entry = history.get(prompt_id)
        if not entry:
            time.sleep(POLL_INTERVAL_S)
            continue

        status = entry.get("status", {})
        if status.get("status_str") == "error":
            messages = status.get("messages", [])
            fail(4, "ComfyUI reported an execution error", f"\n{json.dumps(messages, indent=2)[:1200]}")

        images = [
            image
            for output in entry.get("outputs", {}).values()
            for image in output.get("images", [])
        ]
        if images:
            return images

        # An entry with no images and no error means it finished but saved
        # nothing - a workflow without a SaveImage node, for instance.
        if entry.get("outputs"):
            fail(4, "The workflow completed but produced no image (is there a SaveImage node?)")

        time.sleep(POLL_INTERVAL_S)

    fail(4, f"Timed out after {timeout_s}s waiting for ComfyUI")
    return []


def download(server: str, image: dict, destination: Path) -> None:
    query = urllib.parse.urlencode(
        {
            "filename": image["filename"],
            "subfolder": image.get("subfolder", ""),
            "type": image.get("type", "output"),
        }
    )

    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(f"{server}/view?{query}", timeout=60) as response, destination.open(
            "wb"
        ) as handle:
            shutil.copyfileobj(response, handle)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        fail(4, f"Could not download the generated image: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate an image via ComfyUI")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=1024)
    parser.add_argument("--output", required=True)
    parser.add_argument("--seed", type=int, default=None, help="omit for a random seed")
    parser.add_argument("--server", default=DEFAULT_SERVER)
    parser.add_argument("--workflow", type=Path, default=DEFAULT_WORKFLOW)
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()

    if not args.prompt.strip():
        fail(2, "--prompt is empty")

    for name, value in (("width", args.width), ("height", args.height)):
        if value <= 0 or value % DIMENSION_STEP:
            fail(2, f"--{name} must be a positive multiple of {DIMENSION_STEP}, got {value}")

    seed = args.seed if args.seed is not None else random.randint(0, 2**32 - 1)
    output = Path(args.output)

    stats = check_server(args.server)
    devices = stats.get("devices") or [{}]
    device = devices[0].get("name", "unknown")
    print(f"ComfyUI  : {args.server} ({device})")
    print(f"workflow : {args.workflow.name}")
    print(f"size     : {args.width}x{args.height}   seed: {seed}")

    workflow = build_workflow(args.workflow, args.prompt, args.width, args.height, seed)
    prompt_id = queue_prompt(args.server, workflow, str(uuid.uuid4()))
    print(f"queued   : {prompt_id}")

    images = wait_for_images(args.server, prompt_id, args.timeout)
    download(args.server, images[0], output)

    # The skill is explicit that success is not claimed unless the file exists.
    if not output.is_file() or output.stat().st_size == 0:
        fail(4, f"Nothing was written to {output}")

    print(f"written  : {output}  ({output.stat().st_size / 1024:.0f} KB)")
    if len(images) > 1:
        print(f"note     : the workflow produced {len(images)} images; saved the first")
    return 0


if __name__ == "__main__":
    sys.exit(main())
