#!/usr/bin/env bash
# Render the HyperFrames overlay layer (hf_layer/index.html, 1080x770,
# transparent) to RGBA PNG frames the PIL compositor stacks per frame.
#
#   bash .../scripts/render_hf_layer.sh            # from clone-projects/<slug>-animated/
#   bash .../scripts/render_hf_layer.sh hf_layer frames/hf_layer 30
#
# Requires: node >= 22, Google Chrome, ffmpeg (hyperframes doctor). ~7s per
# 60 frames on an M4. Output: frames/hf_layer/frame_000001.png ...
#
# Disk: the default capture path stages ~3.3 MB/frame of scratch (a 55s clip
# needs ~5.5 GB free). With <10 GB free pass HF_FLAGS="--low-memory-mode"
# (streams frames, 1 worker, ~2x slower) or free clone-projects/*/frames.
set -euo pipefail
DIR="${1:-hf_layer}"
OUT="${2:-frames/hf_layer}"
FPS="${3:-30}"
HF="npx --yes hyperframes@0.8.29"
[ -f "$DIR/index.html" ] || { echo "missing $DIR/index.html (copy templates/hf_layer/)"; exit 1; }
rm -rf "$OUT"; mkdir -p "$OUT"
( cd "$DIR" && HYPERFRAMES_SKIP_SKILLS=1 $HF lint . >/dev/null 2>&1 || true )
( cd "$DIR" && HYPERFRAMES_SKIP_SKILLS=1 $HF render --format png-sequence --fps "$FPS" -o "../$OUT" --quiet ${HF_FLAGS:-} . 2>&1 | grep -viE "npm warn|Render:trace|initSession" || true )
N=$(ls "$OUT" | grep -c '\.png$' || true)
[ "$N" -gt 0 ] || { echo "hyperframes produced no frames"; exit 1; }
python3 - "$OUT" <<'PY'
import os, sys
from PIL import Image
d = sys.argv[1]
f = sorted(x for x in os.listdir(d) if x.endswith(".png"))[0]
im = Image.open(os.path.join(d, f))
assert im.size == (1080, 770), f"hf layer is {im.size}, must be 1080x770"
assert im.mode == "RGBA", "hf layer has no alpha — body background must be transparent"
PY
echo "ok $OUT: $N RGBA frames @${FPS}fps"
