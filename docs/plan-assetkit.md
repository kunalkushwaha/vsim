# Plan — assetkit: generated assets for films and explainers

> **Status:** v1 implemented on `feat/assetkit` (buildings, flowers, lakes, QA turntable, bake-to-GLB
> bridge, vsim library pack). North star: everything here exists so people can make **short films and
> explanatory videos** quickly — assets must be reusable, describable in a small doc, and land in the
> vsim library so a scene references them by name.

## Problem

The Diwali/Lakshmi films showed the quality ceiling of assets assembled ad hoc from primitives in
per-film Blender scripts: toy-like shapes, no reuse, no review step, and nothing a film or the AI
copilot can reference by id. vsim already uses Blender as its *asset source* (make-human, make-animal,
CreatureDoc); assetkit generalises that pattern to sets and props.

## Design

```
 Doc (JSON)  ──► builder (Blender)  ──► QA turntable  ──► bridge (bake → GLB)  ──► library pack  ──► loadModel(name)
 FlowerDoc       flora.py              turntable.py        export.py                models/assetkit/   film / scene
 BuildingDoc     building.py                                                         manifest.json
 LakeDoc         terrain.py
                 fetch_textures.py (CC0 ambientCG, cached + credited)
```

Everything runs **headless** (`make.py`, CI-able) and **live** through Blender MCP (the same modules,
imported into a running Blender, for interactive art direction).

### Builders (one per asset kind; the only kind-specific part)
| Module | Doc | Presets | Notes |
|---|---|---|---|
| `flora.py` | FlowerDoc: petal shape (length/width/tip/cup/bowl/flick/ruffle/roll), layout (rings \| golden-angle spiral), colour (gradient, edge tint, veins, speckles, SSS), centre (pod/disc/stamens), sepals, stem, leaf | lotus, marigold, rose, lily, daisy | petal material is a function of UV only → one baked texture serves all petals |
| `building.py` | BuildingDoc: footprint, floors, bays, wall/trim textures + tints, window/door shape, ground floor (arcade/glass/windows), jharokha, balcony, roof (parapet+chhatri / gable) | haveli, modern, cottage | `style`: realistic (CC0 PBR, world-space box projection) or explainer (flat colours); glass `night` value + door hinges for animatable states; panels/windows instanced |
| `terrain.py` | LakeDoc: size/res, shoreline ellipse + noise irregularity, depth/shelf, banks/hills, water colour/ripple, dressing counts, ghats (`side: "north"` only for now — others raise) | village_lake, park_pond | height+slope blended ground (mud/sand/grass/rock; flat colours without the cache), frame-driven ripples, ghats reuse the building kit |

### Conventions (all assetkit models)
- **Metres**, Blender Z-up during build; GLB is **Y-up** (glTF), front facade toward **+Z** in vsim.
- **Grounded**: origin at ground contact, lowest point y = 0 — except lakes (origin = water level,
  `grounded: false`).
- **Deterministic**: same doc ⇒ same asset (flowers/lakes are seeded; buildings have no random parts).
  The doc is stored in the manifest so every library asset can be regenerated from the repo — given the
  CC0 texture cache (`fetch_textures.py`). `make.py` refuses a *realistic* build without it unless
  `--allow-flat` (then the manifest says `style: realistic-flat-fallback`, never a silent downgrade).
- **Budgets**: `--max-tris` decimates; instancing keeps buildings at ~20–50k triangles.

### Bridge (`export.py`) — why "bake to one atlas"
vsim's `loadGltf()` merges a model into **one** `MeshData` with one set of maps. So the bridge:
1. realises every mesh/curve under the root at a chosen `lod` (subsurf level) into one mesh in the
   root's local space (object-linked materials kept; per-piece random stored as a face attribute so
   per-window lighting survives the merge);
2. decimates to `max_tris`; 3. smart-projects + packs a fresh `atlas` UV layer;
4. bakes **copies** of the source materials into the atlas with Cycles (EMIT trick): base colour, and
   an emissive map when anything glows (`night` chooses which windows are lit; strength capped so the
   map stores colour, not clipping);
5. exports one material on TEXCOORD_0 from a throwaway scene (the glTF exporter otherwise picks up
   objects selected in other scenes). Live-session safe: never edits source materials, restores state.

### vsim side
`packages/assets`: `listModels()` / `loadModel()` read every pack in `MODEL_PACKS`
(`medieval`, `assetkit`); `ModelMeta` gains `pack`, `kind`, `grounded`, `size_m`.

### Manifest entry (`models/assetkit/manifest.json`)
`{ name, file, kind, preset, source, units, up, front, grounded, size_m, size_axes, triangles, atlas,
emissive, style, night, doc }`. `size_m` is measured on the **exported** mesh in vsim/glTF axes
`[width x, height y, depth z]` (tested against the loaded geometry). Names must be unique across packs —
`listModels()` throws on a duplicate and on a corrupt manifest (only a *missing* pack is skipped).

## Tests & verification
- **TS (vitest):** `models.test.ts` loads every pack entry — UVs, texture, grounded unless
  `grounded:false`, caching, unknown-name error.
- **Python (headless Blender):** `scripts/blender/assetkit/test_assetkit.py` builds every preset,
  checks structure/budgets/scale, and round-trips a bake: GLB has one mesh, one material, one UV set,
  is grounded, reports its y-up size, and emissive appears iff `night > 0`. Plus regressions from code
  review: builds without the texture cache, frame-width-keyed frame meshes, chhatris on the roof slab,
  lotus-pad veins from its own UVs, unsupported ghat side rejected, non-Principled surfaces never glow.
  Run: `VSIM_BLENDER=/path/to/blender pnpm test:assetkit`.
- **Visual:** QA sheets in `models/assetkit/qa/`, plus `examples/04-gltf/assetkit-haveli.ts` rendered
  by vsim's own engine.

## Review log
Code review (medium) on the first cut found 10 issues — all fixed with regression tests: lake crash
without the texture cache; `size_m` from the framed flower head and in Blender axes; frame-mesh cache
ignoring frame width; lotus-pad veins from Object coords (broken by the merge); non-Principled
surfaces glowing grey in the emission bake; `listModels` swallowing manifest errors / duplicate names;
floating rooftop chhatris; `ghats.side` ignored; silent flat-texture fallback; unused building `seed`.
Re-review (low) of the fixes found 1 more — `bake_to_glb` IndexError on an asset with no renderable
geometry → now a clear ValueError (tested).

## Out of scope (v1) / follow-ups
- Film3D schema: building/clutter variants are a fixed enum — add assetkit models (+ metres→film-unit
  scale) so films and the copilot can write `variant: "haveli"`.
- Animatable states don't survive baking (door hinges, `night` keyframes): export lit/unlit variants
  or split parts (like the windmill fan).
- Lakes: transmission + ripple motion are lost in the bake → water as a separate vsim surface.
- Normal-map bake; LOD chains; explainer-style outlines.
- Polish: haveli corner seams, cottage side-wall brick orientation, haveli ochre strength, marigold
  saturation, lily speckles.
- Packaging: `packages/assets/package.json` `files` omits `models/` (pre-existing for medieval too).
