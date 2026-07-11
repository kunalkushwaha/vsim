#!/usr/bin/env bash
# Fetch the third-party asset SOURCE packs vsim's generators use, into vendor/ (gitignored).
#
# None of these are needed to render: everything the engine uses at runtime is committed in
# packages/assets/library/. Fetch them only to REGENERATE or EXTEND those assets.
#
# NOTE for sandboxed/proxied environments (CI, Claude Code on the web): direct file downloads
# from most hosts are often blocked, but `git clone` of public GitHub repos usually works —
# which is why everything here clones instead of curling release zips.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p vendor
clone() { # clone <repo-url> <dir>
  if [ -d "vendor/$2/.git" ]; then echo "✓ vendor/$2 (already fetched)"; else
    git clone --depth 1 "$1" "vendor/$2" && echo "✓ vendor/$2"; fi
}

# MPFB2 — MakeHuman's Blender add-on (GPL; used as a TOOL, its output is CC0).
# Regenerates the realistic humans: scripts/blender/make-human.py
clone https://github.com/makehumancommunity/mpfb2 mpfb2
(cd vendor/mpfb2/src && rm -f ../../mpfb2.zip && zip -qr ../../mpfb2.zip mpfb) && echo "✓ vendor/mpfb2.zip (add-on zip for make-human.py)"

# MakeHuman community assets (CC0/CC-BY per file — check before bundling anything new).
# Hair, clothes, eyes, expressions, poses for richer humans.
clone https://github.com/makehumancommunity/makehuman-assets makehuman-assets

# KayKit Character Pack: Adventurers (CC0) — source of the bundled knight/barbarian/mage/rogue.
clone https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 kaykit-adventurers

# KayKit Medieval Hexagon Pack (CC0) — source of the bundled village models
# (packages/assets/models/medieval/; rebundle with scripts/bundle-medieval.mjs).
clone https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0 kaykit-medieval-hexagon

echo "done — see docs/asset-packs.md"
