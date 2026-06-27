# Implementation Plan — Phase 2: Characters, Scene-from-Description, Cinematography

*Companion to `PLAN.md`. Goal: go from "animate objects" to "describe a world with a walking
character, filmed from multiple angles, and render it deterministically."*

---

## 0. The target demo (definition of done)

The exact ask — *"green grass, blue sky, a character walking, with different camera angles"* —
producible **two ways**, both yielding the same deterministic MP4 and a matching live preview:

1. **Code:** an authoring script builds a ground + sky + a rigged character playing a walk clip
   while translating across the field, with a 3-shot camera sequence (wide → tracking → close-up).
2. **English:** `vsim edit --prompt "green grass under a blue sky, a character walking across the
   field, film it wide then cut to a close-up"` → the copilot emits the same scene document.

> **On "Mickey Mouse" specifically:** Mickey is copyrighted/trademarked Disney IP — we will not
> bundle, generate, or ship it. The *capability* is "play any rigged character," and the demo +
> shipped asset library use **CC0 / permissively-licensed** rigs (e.g. Khronos sample models like
> `CesiumMan`/`Fox`, Quaternius, or Mixamo under its terms). A user who owns a licensed Mickey rig
> can load it themselves; that's their call, not ours.

---

## 1. Constraints inherited from the tenets

Every new capability is a **new field on the scene document**, validated by zod — nothing holds
hidden state. Determinism stays a **test**: skeletal pose and skinning are evaluated from frame
indices (never wall-clock), the software CPU-skin path is the **oracle**, and golden-frame hashes
gate CI. One runtime drives both preview and render. The AI runs **only at authoring time** and
emits a document — the render path never sees the model, so determinism is unaffected. And we
**de-risk the scary part first**: skinning-determinism is proven on a synthetic rig before any glTF
or authoring sugar is built.

---

## 2. Capability A — Skeletal characters (the hard part)

### 2.1 Scene-document additions

```ts
// New top-level arrays
skins?:  Skin[]
clips?:  AnimationClip[]

Skin {
  id: string
  joints: string[]               // node ids, in skin order (joints are ordinary nodes)
  inverseBindMatrices: Mat4[]     // one per joint (column-major, matches core/math)
}

// MeshData (geometry.ts) gains optional skin attributes (loaded, never hand-authored):
MeshData += { joints?: number[] /* 4 per vertex */, weights?: number[] /* 4 per vertex */ }
Node.mesh += { skinId?: string }  // binds a mesh to a skin

AnimationClip {
  id: string
  durationFrames: number
  channels: ClipChannel[]
}
ClipChannel {
  jointNodeId: string                                  // a node in the skin's joints
  path: "translation" | "rotation" | "scale"
  times:  number[]                                     // FRAME indices (converted from glTF seconds at load)
  values: number[]                                     // flat: vec3 per key (T/S) or quat per key (R)
  interpolation: "linear" | "step" | "cubicspline"
}

// Playing a clip — lives on the character's root node:
Node += { clip?: ClipPlayback }
ClipPlayback { clipId: string; startFrame: number; speed: number /*1=normal*/; loop: boolean }
```

Time stays in frames. glTF clips are authored in seconds; the loader converts `time → round(time*fps)`
once, so sampling is integer-frame and reproducible.

### 2.2 glTF loader work (`@vsim/assets`)

Today the loader bakes node transforms into world-space vertices and **drops skins/animations**.
For rigged models it must instead:
- Preserve the **node hierarchy** (don't bake) for any node referenced by a skin.
- Parse `skins` → joints (node ids) + `inverseBindMatrices` accessor.
- Read per-vertex `JOINTS_0` + `WEIGHTS_0` accessors into `MeshData.joints/weights`.
- Parse `animations` → channels (sampler input/output accessors, interpolation) → `AnimationClip`.
- Keep the existing bake path for **static** (un-skinned) meshes — no regression.

### 2.3 Runtime: pose evaluation (`@vsim/core`)

In `SceneRuntime.computeFrameState(frame)`, before the existing FK pass:
1. For each node with `clip`, compute `localFrame = (frame - startFrame) * speed`, wrapped to
   `durationFrames` if `loop`. Out-of-range (before start / after end, non-loop) → clip inert.
2. Sample each channel at `localFrame`: `step` (hold), `linear` (lerp for T/S, **quaternion slerp**
   for R — shortest-path, deterministic), `cubicspline` (glTF Hermite). Write the result into the
   joint node's local transform (joints are ordinary nodes already in `nodeMap`).
3. Existing FK (`computeWorld`) then resolves joint world matrices for free.
4. For each skinned mesh node, compute `jointMatrix[j] = jointWorld[j] · inverseBind[j]`
   (glTF skinning; the skinned mesh ignores its own node transform per spec). Attach
   `skin: { jointMatrices: Mat4[] }` to that node's `ResolvedNode` in the `FrameState`.

All pure matrix/quaternion math → deterministic, engine-agnostic.

### 2.4 Engines

- **`@vsim/engine-software` (oracle):** CPU skinning. Per vertex,
  `p' = Σ w_i · jointMatrix[joint_i] · p` (and the 3×3 part for the normal), computed each frame
  before the existing project → shade → near-clip → rasterize pipeline. Deterministic, no GPU.
- **`@vsim/engine-three` (fidelity):** build a `THREE.SkinnedMesh` + `Skeleton`; each frame push the
  joint matrices onto the bones (GPU skinning). Not byte-identical to the software path — same
  two-engine reality we already accept; the software oracle is what the golden gate pins.

`FrameState`/`Engine` extension: `ResolvedNode.skin?: { jointMatrices: Mat4[] }`, and `loadMesh`
already carries `MeshData` (now with joints/weights). No breaking change to existing scenes.

### 2.5 Authoring API (`@vsim/authoring`)

```ts
scene({...})
  .character("hero", { model: "cesium-man", clip: "walk", loop: true })   // load rig + play clip
  .animate("hero", "position.x", [{frame:0,value:-4},{frame:90,value:4}]) // root translation = "walking across"
```

`.character()` registers the glTF asset, its skin, and clips; `.playClip(nodeId, clip, opts)` is the
explicit form. Root motion is intentionally **node translation** (clip plays in place, node moves) for
v1 — simpler and deterministic; baked-in root motion from the clip is a later option.

### 2.6 Determinism & tests

- **Synthetic-rig unit test (no external asset):** a hand-built 2-joint "bar" with a bend clip —
  assert (a) two runs are byte-identical, (b) vertices actually deform toward the expected side.
  This is the real de-risking spike, runnable in CI with zero downloads.
- **glTF golden:** a committed small rigged sample (CesiumMan) → software CPU-skin → golden hashes.
- **Parity:** the existing `render/parity.test.ts` harness extends to a skinned scene (player scrub
  == offline render).

### 2.7 Milestone M5 — tasks

| ID | Task | Effort |
|----|------|--------|
| ★ T-050 | Schema: `skins`, `clips`, `ClipPlayback`, `MeshData.joints/weights`, `mesh.skinId` (zod+types) | M |
| ★ T-051 | Runtime: clip sampler (step/linear+slerp/cubicspline) + FK joints + skin matrices in FrameState | L |
| ★ T-052 | Software engine: CPU skinning (oracle) | M |
| ★ T-053 | Synthetic-rig determinism + deformation test (the spike) | M |
| ★ T-054 | glTF loader: parse skins, animations, JOINTS_0/WEIGHTS_0; preserve joint hierarchy; keep static bake | L |
| T-055 | engine-three `SkinnedMesh` path | M |
| T-056 | Authoring `.character()` / `.playClip()` | M |
| T-057 | glTF golden + parity test for a skinned example | M |
| T-058 | Example 05: a rigged character walking | S |

---

## 3. Capability C — Cinematography / multiple camera angles

### 3.1 Scene-document additions

```ts
// `camera` stays as the default/fallback. Add:
cameras?: CameraDef[]                       // CameraDef = today's CameraSchema + id, + lookAtNodeId?
shots?:   Shot[]                            // active-camera timeline
Shot { cameraId: string; startFrame: number; endFrame: number }

CameraDef += { lookAtNodeId?: string }      // aim at a (moving) node each frame = tracking shot
// Animatable camera channels via the existing animation track, target { cameraId, path }:
//   path ∈ "fov" (dolly-zoom), "lookAt" (vec3 target move)
```

### 3.2 Runtime

- `resolveCamera` picks the active camera by frame from `shots` (fallback to `camera`).
- `lookAtNodeId` → resolve that node's world translation each frame and aim the camera at it
  (a look-at constraint) — deterministic tracking.
- Evaluate camera-targeted animation channels (fov, lookAt) alongside node/material channels.

### 3.3 Authoring + presets

```ts
.camera("wide",  { position:[0,3,12], lookAt:[0,1,0], fov:40 })
.camera("close", { position:[2,1.6,3], lookAtNodeId:"hero", fov:35 })
.shot("wide", 0, 45).shot("close", 46, 90)
.orbit("orbitCam", { target:[0,1,0], radius:8, startFrame:0, endFrame:90 })  // preset → keyframes
```

Rig presets (`orbit`, `dolly`, `crane`, `track`) compile to camera nodes + keyframes / constraints —
no new runtime concepts, just sugar over §3.1.

### 3.4 Milestone M6 — tasks

| ID | Task | Effort |
|----|------|--------|
| ★ T-060 | Schema: `cameras`, `shots`, `lookAtNodeId`, camera animation channels | M |
| ★ T-061 | Runtime: active-camera-by-frame, look-at-follow constraint, camera channel eval | M |
| T-062 | Authoring: multi-camera + `.shot()` + rig presets (orbit/dolly/crane/track) | M |
| T-063 | Player: shot-aware preview (cuts + scrub) | S |
| T-064 | Determinism: shot cuts + tracking byte-identical; Example 06 (3 shots) | S |

---

## 4. Capability B — Environments & scene-from-description

### 4.1 Environment additions

```ts
environment?: {
  sky?: { type: "flat" | "gradient"; top?: Vec3; bottom?: Vec3 }   // "blue sky" = gradient
  fog?: { color: Vec3; nearFrac: number; farFrac: number }          // depth haze
}
// New light type:
light.type += "hemisphere"   // { skyColor, groundColor, intensity } — natural outdoor fill
```

- Software engine: render a **gradient sky** as the background fill (vertical lerp) instead of a flat
  clear; apply **depth fog** during rasterization; add hemisphere term to `shade()`.
- "green grass" (v1) = a large ground plane with a green material + hemisphere light. Instanced grass
  blades are a Phase-3 stretch, not required for the demo.

### 4.2 Asset library (the AI's grounding)

A curated, **licensed** registry the copilot can pick from — *"grounded in available assets so it
can't invent geometry"* (CONCEPT §6). `assets/library/manifest.json`:

```json
[{ "id":"cesium-man", "kind":"character", "tags":["humanoid","walk"],
   "uri":"...", "clips":["walk","idle"], "license":"CC-BY" }]
```

Content-addressed; only CC0/permissive entries ship. The copilot receives the catalog (ids + tags +
clips) and may reference **only** these — no hallucinated meshes.

### 4.3 Copilot extensions (`@vsim/ai`)

New schema-constrained ops, added to the existing tool vocabulary:
`setEnvironment` (sky/fog), `addCharacter` (libraryId + clip + path), `addCamera`, `setShot`.
Then a **generate mode**: a description + the asset catalog → a short *plan* (entities: environment,
character(s), cameras, shots) → emit the ops that build the whole scene from blank. Still grounded,
still schema-validated, still deterministic to render.

### 4.4 Milestone M7 — tasks

| ID | Task | Effort |
|----|------|--------|
| ★ T-070 | Schema + software/three: gradient sky, depth fog, hemisphere light | M |
| T-071 | Ground/"grass" helper (colored plane + hemisphere); stretch: instanced grass | M |
| ★ T-072 | Asset library + manifest (CC0 rigs/props/env), content-addressed, license field | L |
| ★ T-073 | Copilot ops: `setEnvironment`, `addCharacter`, `addCamera`, `setShot` (grounded in catalog) | L |
| ★ T-074 | Copilot generate-mode: description → plan → ops (full scene) | L |
| T-075 | Example 07 + demo: the target scene from **both** code and English | M |

---

## 5. Critical path & sequencing

```
M5 (characters) ── T-050 → T-051 → T-052 → T-053(spike) → T-054(glTF) → T-056/57/58
                                              │
M6 (cameras)    ──────────────── T-060 → T-061 → T-062/63/64
                                              │
M7 (env + AI)   ── T-070 → T-072(library) → T-073 → T-074 → T-075(demo)
```

Build characters first (riskiest — skinning determinism), cameras next (you need to film the
character), then environments + the AI that composes all three. The synthetic-rig spike (T-053)
gates the whole thing: if CPU-skin determinism doesn't hold, fix it before building on top.

## 6. Determinism risks & mitigations

| Risk | Mitigation |
|------|------------|
| Quaternion slerp sign / shortest-path differences | One canonical slerp in `core/math`, unit-tested; flip to shortest arc deterministically |
| `cubicspline` Hermite correctness | Implement per glTF spec; golden-test against a known sample |
| glTF seconds → frames rounding drift | Convert once at load (`round(t*fps)`); sample by integer frame |
| CPU (oracle) vs GPU (three) skin divergence | Expected; oracle = CPU software path, GPU is fidelity-only (same as today's two engines) |
| Root motion ambiguity | v1 = node translation + in-place clip (explicit, reproducible); baked root motion later |
| CPU-skin perf on dense meshes | Acceptable for the reference renderer; optimize later (typed-array batch, or push to GPU path) |

## 7. Open questions

- Root motion: node-driven path (v1) vs. extracting translation from the clip's root channel.
- Animation retargeting across rigs — out of scope; ship clips authored for each rig.
- Sky as a background shader (v1) vs. a real sky dome mesh (needed if the camera tilts far up).
- How rich the copilot "generate mode" plan step should be (single tool-use pass vs. plan→ops).
