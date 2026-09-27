#!/usr/bin/env bash
# Create clone-projects/<slug>-longform/ and copy the engine + shared modules + fonts + Claude marks.
#   bash .../scripts/setup_workdir.sh <slug>      (run from the workspace root or anywhere; uses absolute paths)
set -euo pipefail
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SKILL/../../../.." && pwd)"          # workspace root (contains clone-projects/)
SLUG="${1:?slug}"
WD="$ROOT/clone-projects/${SLUG}-longform"
mkdir -p "$WD"/{source,audio,renders,frames,fonts,assets/logos,assets/gifs,assets/figures,assets/thumbs,assets/shots}
cp "$SKILL"/templates/{longform_engine,media_marks,hyper_edits,light_fx,fonts,claude_marks}.py "$WD/"
cp "$SKILL"/templates/fonts/*.ttf "$WD/fonts/"
cp "$SKILL"/assets/claude-*.png "$WD/assets/"
[ -f "$WD/render.py" ] || cp "$SKILL/templates/render_template.py" "$WD/render.py"
echo "workdir: $WD"
