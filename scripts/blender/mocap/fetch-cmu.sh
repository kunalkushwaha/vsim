#!/usr/bin/env bash
# Fetch the CMU mocap BVH trials clips.json uses (pinned commit), into $1 (default ~/.cache/vsim-mocap).
set -euo pipefail
DIR=${1:-$HOME/.cache/vsim-mocap}
SHA=09a07f54f3bbb58797325f009282d0b2048a2871
mkdir -p "$DIR"
for f in $(python3 -c "import json,sys;print(' '.join(sorted({c['bvh'] for c in json.load(open(sys.argv[1]))['clips']})))" "$(dirname "$0")/clips.json"); do
  s=${f%%_*}; s=$(printf "%03d" "$((10#$s))")
  [ -s "$DIR/$f" ] || curl -fsSL "https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/$SHA/data/$s/$f" -o "$DIR/$f"
  echo "✓ $f"
done
