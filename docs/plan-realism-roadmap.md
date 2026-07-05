# Plan — realism roadmap (post PR #2)

*Follow-up to `docs/plan-photoreal.md`. PR #2 landed the draft renderer's realism base:
per-pixel Lambert + Blinn-Phong specular, 2× supersampled AA, PCF shadow mapping, distance
fog, the full PBR texture-map pipeline (normal / metallic-roughness / occlusion / emissive),
organic procedural trees, and `blendInFrames` (static-pose → clip blending). This doc breaks
down what remains, as concrete tasks in dependency order. Every task keeps the two invariants:
**pure TypeScript in the deterministic path** and **byte-identical renders** (golden hashes
regenerated only on intentional shading changes, with proof tests).*

---

## Phase R1 — renderer polish (engine-software)

| # | Task | Notes / acceptance |
|---|------|--------------------|
| R1.1 | **Bilinear PCF** — weight the 3×3 shadow taps by sub-texel position (tent filter) | Shadow edges lose residual stair-stepping; test: monotonic ramp across a shadow edge |
| R1.2 | **Opt-in ACES tone mapping** — `meta.tone: "none" \| "aces"` (default `"none"`), applied at resolve time; mirror in engine-three (it already runs ACES — flag aligns the draft) | Bright speculars roll off instead of clipping; goldens only change for scenes that opt in |
| R1.3 | **Perspective-correct interpolation** — divide attributes by w during rasterization | Fixes UV swim on large ground planes seen at grazing angles; parity test unaffected |
| R1.4 | **Mipmaps + trilinear sampling** — build mip chains at `loadMesh`, select level from screen-space UV derivatives | Kills texture shimmer/moiré on distant textured meshes in motion |
| R1.5 | **Alpha / transparency** — `opacity < 1` materials: back-to-front sorted pass after opaque | Enables glass, ghosting, fade-ins of 3D objects (today opacity is stored but unused) |
| R1.6 | **Point-light shadows** (single cube-face or dual-paraboloid map, lowest-cost variant) | Lamps/interior scenes ground their subjects like the sun does |

## Phase R2 — environment & atmosphere

| # | Task | Notes |
|---|------|-------|
| R2.1 | **Sun disc + horizon glow in the gradient sky** (sun position derived from the first directional light) | Sky and lighting finally agree; sunset scenes get a visible source |
| R2.2 | **Hemisphere-based IBL approximation** — irradiance from sky/ground colors modulated by AO | Cheap "bounce light"; flat-lit sides of objects stop looking dead |
| R2.3 | **Deterministic particle system** — seeded Rng + fixed-step (leaves, dust, rain, sparks); document schema `particles[]` | The CONCEPT doc's "real simulation" pillar; must replay identically |
| R2.4 | **Ground detail** — procedural grass tufts / scatter instancing via the hashed-variation pattern from `tree()` | Fox scene's empty green plane becomes a field |

## Phase R3 — characters (the realism ceiling for stories)

| # | Task | Notes |
|---|------|-------|
| R3.1 | **Clip-to-clip crossfade** — `NodeSchema.clip` accepts an array; overlapping playbacks slerp-blend by ramp weights (extends `blendInFrames`) | idle → walk → run on one character; the #1 animation gap |
| R3.2 | **Re-export MakeHuman assets with full PBR maps** (`scripts/blender/make-human.py`: bake normal + roughness) | The renderer already consumes the maps (PR #2); the bundled assets just don't carry them yet |
| R3.3 | **Foot-lock IK pass** — post-clip solver pinning grounded feet (deterministic, frame-based) | Removes foot-slide when characters translate while walking |
| R3.4 | **Secondary motion** — deterministic spring bones (hair, tails, cloth flutter) as a runtime post-pass | Puppy tail / hair stops being rigid; seeded, fixed-step |
| R3.5 | **Facial animation library** — standard morph set (visemes + emotions) on the MakeHuman exports; extend `17-lipsync` | Talking characters beyond mouth-open |

## Phase R4 — photoreal finals (from `plan-photoreal.md`, unchanged)

| # | Task | Notes |
|---|------|-------|
| R4.1 | **F1: Cycles still** — Blender backend renders one photoreal character frame from a baked vsim scene | `apps/studio/cycles-bake.ts` already resolves world-space geometry through `SceneRuntime` |
| R4.2 | **F4: document → Cycles MP4** — frame range → path-traced frames → encode; Studio "Final render (photoreal)" button | Deterministic inputs + fixed seed/samples (documented tradeoff) |
| R4.3 | **Browser path tracer** (`three-gpu-pathtracer` behind the `Engine` interface) | Photoreal stills/turntables with zero server — the web-first alternative |

## Phase R5 — web & performance

| # | Task | Notes |
|---|------|-------|
| R5.1 | **Fetch-based asset loader** — `loadGltfRig`/`loadCharacter` variants taking URL/ArrayBuffer (parser is already pure; only `node:fs` blocks the browser) | Characters + clips load client-side |
| R5.2 | **WebCodecs MP4 export** — `VideoEncoder` + mp4 muxer behind the same frame loop | In-browser export; SoftwareEngine in a worker for deterministic pixels |
| R5.3 | **Worker-tiled software renderer** — row bands across Web Workers / worker_threads | Reclaims the ~3× cost of per-pixel + SSAA; determinism safe (tiles are independent) |
| R5.4 | **WebGPU preview** — three.js WebGPURenderer behind `ThreeEngine` | Headroom for R2.3 particles and heavy scenes |

## Sequencing recommendation

**R3.1 (crossfade) → R1.1–R1.3 (cheap visual wins) → R3.2 (assets carry the maps the renderer can now shade) → R2.1–R2.2 (atmosphere) → R5.1–R5.2 (web story) → R4 (photoreal).**
R3.1 first because character motion quality is the most visible realism gap left after PR #2,
and it completes the graphics→animation arc that `blendInFrames` started.
