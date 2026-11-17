# Plan — Film3D × assetkit: generated models in films by name

> **Status:** v1 implemented on `feat/film3d-assetkit` (stacked on `feat/assetkit`, PR #136).
> North star: a film doc (hand-written or from the AI copilot) can say `"variant": "haveli"` or
> `"variant": "marigold"` and get a real generated model in the right place, at the right size.

## Problem
assetkit (docs/plan-assetkit.md) lands models in `packages/assets/models/assetkit/`, but Film3D's
`building` / `clutter` variants are a fixed enum of the KayKit medieval set, and `flowers` is only
procedural spheres. Films and the copilot can't reach the new library.

## Design

### Units: 1 film unit = 1 metre
The cast already sits at that scale: the human rig is ~1.6 units tall (eye 1.45), deer eye 1.28.
assetkit models are real-world metres, so they go in at **scale 1**. The KayKit models keep
their own `MODEL_SCALE` (they're toy-scale hex tiles). An optional per-prop `scale` (0.25–2) lets a
storybook film shrink a haveli to sit with chibi Adventurers (~1.25 units tall).

### Synchronous name table (codegen, like `surfaces.ts`)
Schema validation is synchronous and can't read the manifest. `scripts/gen-assetkit-table.mjs`
writes `packages/film3d/src/assetkit.ts`:
```ts
export const ASSETKIT_MODELS = { haveli: { kind: "building", size_m: [13.75, 13.95, 11.52] }, … } as const;
export const ASSETKIT_BUILDINGS = ["cottage", "haveli"] as const;
export const ASSETKIT_FLOWERS = ["lotus", "marigold"] as const;
```
A vitest asserts the table matches the manifest, and the failure message says to run
`pnpm gen:assetkit`. After `make.py`, re-running the codegen is the one extra step.

### Schema
- `building.variant` = medieval ∪ `ASSETKIT_BUILDINGS`; new optional `scale` (0.25–2, default 1).
- `flowers` gains optional `variant` ∈ `ASSETKIT_FLOWERS`. Without it you get the existing
  procedural patch, unchanged. With it you get a patch of real flower models laid out by the same
  golden-angle scatter, spaced by the model's footprint, plus optional `scale` (0.5–3).
- **Stage fit** (superRefine): an assetkit building's rotated footprint × scale must stay on the
  ±14 stage, so the copilot can't place a 14 m haveli half off the world. Agent-readable message
  with the footprint and a suggested position.

### Budget
Each instance copies its mesh (no GPU instancing in the document), and library flowers are
40–50k triangles. A patch is capped at **9** models (count ∝ area / footprint²). Superrefine
also caps the doc at **36** flower models, so one film stays under ~2M triangles.

### Rendering
`sets.model()` already places a GLB with a white material (the baked atlas is the colour).
assetkit buildings use the same path at scale 1 × `scale`. Lit windows (the emissive map) come
from the bake's `night` value: haveli 0.5, cottage 0.6. They read as warm windows at dusk or night
and stay subtle by day.

### Copilot (`generate.ts`)
The prompt lists the new variants with sizes and when to use them: a haveli or cottage as the
landmark of an Indian street or village, and marigold or lotus patches for festive or devotional
scenes. It also reminds the model that these are big, so one goes at the back of the stage.

## Tests
- schema: accepts `haveli` / `flowers.variant: marigold`; rejects unknown variant; rejects a
  haveli whose footprint leaves the stage; rejects >36 flower models; medieval defaults unchanged.
- codegen table in sync with manifest.
- `placeProp`: haveli at scale 1 → mesh node with scale [1,1,1]; `scale` multiplies; flower patch
  → N meshes within radius, N ≤ 9, deterministic.
- e2e: a demo film `films/diwali-lane.film3d.json` validates, compiles and renders stills
  (visual check by eye).

## Verification
- vitest: all suites green (new `packages/film3d/src/assetkit.test.ts`, emissive test in
  `packages/assets/src/models.test.ts`); typecheck + determinism lint clean.
- e2e: `films/diwali-lane.film3d.json` (meadow→dusk, haveli + cottage, marigold and lotus
  patches, lamps, a walking character) validates, compiles and renders. Stills checked by eye,
  plus a full 16 s MP4.

## Review log
- **Found in e2e (bug from PR #136):** static `loadGltf()` / `loadModel()` read only the
  base-colour texture, so assetkit's baked emissive map (lit windows) never reached vsim. It now
  loads `emissiveTexture` alongside the colour atlas. Test: models whose manifest says `emissive`
  load a lit `emissiveMap`, the others and KayKit don't.
- Self-review (the code-review subagent hit the account rate limit), 3 fixed:
  1. the stage-fit suggestion was rounded with `toFixed(1)` and could round *outward* into a
     position that fails again → truncated toward the centre; a test re-validates every
     suggestion across angles, scales and edges;
  2. flower-patch inset ignored the per-instance ×1.1 size jitter → inset by the largest size;
     tested at scale 2.5;
  3. the copilot prompt claimed windows glow "at dusk/night", but the bake is static (always on)
     → wording fixed.
- Noted, not fixed (pre-existing): compiled scene docs carry inline texture bytes, so
  `JSON.stringify` of a scene with large atlases exceeds V8's string limit. Studio's JSON export
  and photoreal path stringify scene docs. The render path (worker structured clone) is fine.

## Out of scope
Day/night baked variants (`haveli-night`) or an animatable `lit` amount (today's lit windows are
always on, and only a few are lit); compact scene serialisation (shared mesh refs) for Studio; GPU instancing for flower patches; lakes as Film3D
props (the water has to be a vsim surface first); clutter-sized assetkit props.
