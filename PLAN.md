# Implementation Plan — 3D Video Framework

*Companion to `CONCEPT.md`. Target: small founding team (2–4). Horizon to v0.1 (open-source `code → video` SDK): ~10–14 weeks.*

---

## 0. Guiding engineering tenets

These fall directly out of the three core bets and should constrain every decision:

1. **The scene document is the only source of truth.** Every subsystem reads/writes it; nothing holds hidden state. If it isn't in the document, it doesn't exist.
2. **Determinism is a test, not a hope.** `render(scene, seed) → bytes` must be reproducible. We assert it in CI from week 1, not at the end.
3. **One engine, two drivers.** The same runtime advances frames for the live player *and* the headless renderer. We never fork rendering logic.
4. **Engine-agnostic core.** Three.js/Rapier live behind interfaces so the future WebGPU core is a swap, not a rewrite.
5. **De-risk the scary parts first.** Headless GPU rendering and cross-run determinism are validated in M0 *before* we build on them.

---

## 1. Repo & package architecture

Monorepo (pnpm workspaces + Turborepo or Nx). TypeScript everywhere. Vitest for unit, Playwright for headless/visual.

```
/packages
  core/            # scene document schema, runtime clock, animation eval, RNG — ZERO engine deps
  engine-three/    # Three.js adapter: document → scene graph, per-frame update
  physics-rapier/  # Rapier adapter: deterministic fixed-step world, body sync
  render/          # headless frame capture + ffmpeg muxing (video+audio)
  player/          # browser real-time preview component (play/pause/seek)
  cli/             # `vsim render scene.ts -o out.mp4`
  authoring/       # code authoring API (declarative builder → document)
/examples          # canonical demo scenes (also used as golden tests)
/apps
  docs/            # docs site (later)
```

**Interfaces that define the seams (write these first, in `core`):**
- `SceneDocument` — serializable scene (see §2)
- `Engine` — `build(doc)`, `applyFrame(state)`, `captureFrame() → pixels`, `dispose()`
- `PhysicsWorld` — `step(dt)`, `getBodyTransforms()`, `setSeed()`, deterministic config
- `Clock` — fixed-timestep scheduler: `advanceTo(frameIndex)`

---

## 2. The Scene Document (data model sketch)

The first real artifact. Keep it boring, explicit, versioned.

```ts
SceneDocument {
  version: "0.1"
  meta: { fps: 30, duration: 150 /*frames*/, resolution: [1920,1080], seed: 12345 }
  assets: Asset[]              // glTF refs, textures, audio (content-addressed)
  nodes: Node[]               // tree: transform, mesh|light|camera, parent
  materials: Material[]
  physics?: { gravity, bodies: RigidBody[], colliders: Collider[] }
  animation: Track[]          // keyframes on node/material properties; time in FRAMES
  audio?: { trackId, gain, beats?: number[] /*frame indices*/ }
  camera: { activeNodeId }
}
```

Decisions to lock in M1:
- **Time is measured in frames, not seconds.** Eliminates float drift; beats map to frame indices (the audio↔determinism win).
- **Keyframe interpolation:** linear + cubic-bezier easing per segment.
- **Validation:** zod schema → typed parse + helpful errors. Schema is the public contract.

---

## 3. Milestone plan (MVP path)

| Milestone | Goal | Exit criteria (demoable) |
|-----------|------|--------------------------|
| **M0 — Foundations & spikes** | Repo, CI, de-risk the two scary assumptions | A throwaway script renders 60 frames headless → MP4; same scene rendered twice is hash-identical |
| **M1 — Document + deterministic core** | Scene doc + runtime + animation, no physics | A keyframe-animated cube (from a JSON doc) renders to a correct MP4 via CLI |
| **M2 — Deterministic physics** | Rapier integrated, fixed-step, reproducible | Falling/colliding bodies render to MP4; two renders byte-match; preview == render |
| **M3 — Authoring + assets + audio** | Real `code → video` DX | Write a `.ts` scene with a glTF model + physics + audio track; one command → MP4 with sound |
| **M4 — Player + polish + OSS launch** | Shippable v0.1 | Live preview component (play/seek); docs + 3 examples; published packages; determinism gate in CI |

Then **Phase 1+** (lower resolution, §6): AI copilot → cloud render → visual editor → templates.

---

## 4. Detailed task breakdown

Format: `[ID] Title — (effort: S≤2d / M≤1wk / L≤2wk) · deps`. ★ = critical path.

### M0 — Foundations & de-risking spikes (~2 wks)
- ★ `T-001` Monorepo scaffold (pnpm + Turbo, TS, lint, Vitest, Playwright) — S
- `T-002` CI pipeline (typecheck, test, build) on PRs — S · T-001
- ★ `T-003` **Spike A — headless render:** prove Three.js + WebGL renders offscreen on a server and frames pipe to ffmpeg → MP4. Evaluate: headless Chromium (Playwright, SwiftShader/ANGLE) vs native (`gl`/offscreen + node). Pick one, document why. — L · T-001
- ★ `T-004` **Spike B — determinism:** run a fixed-timestep loop + Rapier twice; assert identical body transforms & frame hashes. Identify nondeterminism sources (Date.now, Math.random, async ordering). — M · T-001
- `T-005` Decision memo: rendering backend + determinism rules (written, in repo) — S · T-003,T-004

**Gate:** if Spike A can't hit acceptable cost/throughput, revisit render strategy *now*.

### M1 — Scene document + deterministic core (~2–3 wks)
- ★ `T-010` `SceneDocument` zod schema + types + parse/validate — M · T-005
- ★ `T-011` `Clock`: fixed-timestep scheduler, `advanceTo(frame)`, accumulator pattern — M · T-010
- ★ `T-012` Seeded RNG (e.g. mulberry32/PCG); ban global `Math.random` via lint rule — S · T-010
- ★ `T-013` Animation evaluator: track + keyframe → property value at frame N (linear + bezier) — M · T-010
- ★ `T-014` `Engine` interface + **`engine-three`**: build scene graph from doc, `applyFrame` — L · T-010
- ★ `T-015` `render` package: drive Clock → Engine, capture each frame, ffmpeg → MP4 (no audio yet) — M · T-014, T-003
- ★ `T-016` `cli`: `vsim render <doc.json> -o out.mp4 --fps --frames` — S · T-015
- `T-017` Golden-frame test harness: render example, hash frames, compare to baseline — M · T-015
- `T-018` Example 01: keyframe-animated cube + camera move (JSON doc) — S · T-016

**Exit:** `T-018` renders correctly and `T-017` passes deterministically twice.

### M2 — Deterministic physics (~2 wks)
- ★ `T-020` `PhysicsWorld` interface + **`physics-rapier`**: deterministic mode, fixed dt = 1/fps (or substeps) — L · T-011
- ★ `T-021` Body↔node sync: physics transforms drive scene-graph nodes per frame — M · T-020, T-014
- ★ `T-022` Determinism integration test: rigid-body scene renders byte-identical across 2 runs — M · T-021, T-017
- `T-023` Preview==render parity test: same scene in player vs headless → frame-hash match — M · T-022, (T-040 player can come later; stub a browser-run harness)
- `T-024` Example 02: stack of boxes collapsing under gravity — S · T-021

**Exit:** `T-022` green; physics sim is reproducible and matches preview.

### M3 — Authoring API + assets + audio (~3 wks)
- ★ `T-030` `authoring` API: declarative builder (R3F-style components or TS builder) → `SceneDocument` — L · T-010
- ★ `T-031` Scene file loader: import a `.ts`/`.tsx` scene, produce document for CLI — M · T-030, T-016
- ★ `T-032` glTF asset pipeline: load (Draco/meshopt opt.), deterministic await-all-before-step, content-addressed cache — L · T-014
- `T-033` Material/lighting basics (PBR, ambient/directional) wired through document — M · T-014
- ★ `T-034` Audio: attach track, mux into MP4 via ffmpeg; expose `beats[]` (frame indices) — M · T-015
- `T-035` Audio-reactive binding: drive a property from beat frames (proves the determinism story) — S · T-034, T-013
- `T-036` Example 03: glTF model + physics + music with a beat-synced pulse — S · all above

**Exit:** `T-036` — one command turns a `.ts` scene into an MP4 with model, physics, and synced audio.

### M4 — Player, polish, OSS launch (~2–3 wks)
- ★ `T-040` `player` component: real-time canvas, play/pause/seek/scrub, shares runtime with render — L · T-014
- `T-041` Progress + error UX in CLI; deterministic logging — S · T-016
- `T-042` Docs site: quickstart, scene-doc reference, determinism guide, render guide — L · T-036
- `T-043` 3 polished examples + a 20-sec showreel rendered by the tool itself — M · T-036
- ★ `T-044` Determinism gate in CI (golden hashes) blocks merges — S · T-022
- `T-045` Package publishing (npm), versioning, license (open-core boundary documented) — M · T-001
- `T-046` Landing page + README with the "Remotion for real 3D" pitch + showreel — M · T-043

**Exit:** packages published; a developer can `npm i`, write a scene, render an MP4, and embed the player — all from docs.

---

## 5. Critical path & sequencing

```
T-001 ─┬─ T-003 (Spike A render) ─┐
       └─ T-004 (Spike B determ.) ─┴─ T-005 ─ T-010 ─┬─ T-011 ─ T-020 ─ T-021 ─ T-022 ─ T-044
                                                     ├─ T-013 ─┐
                                                     ├─ T-014 ─┴─ T-015 ─ T-016 ─ T-031
                                                     └─ T-030 ─ T-031 ─ T-032 ─ T-036 ─ T-040 ─ launch
```
**The spine:** doc schema → engine adapter → render→MP4 → physics determinism → authoring → audio → player. Everything else hangs off it. **Do Spikes A & B before anything else** — they can invalidate the whole approach, and finding that out in week 2 is cheap.

---

## 6. Post-MVP phases (lower resolution)

**Phase 1 — AI + ecosystem** (after v0.1 traction)
- AI copilot: prompt → scene-document *patches*, constrained by the zod schema (tool-calling), grounded in available assets so it can't invent geometry.
- Asset library + Blender export guide/plugin; particle system (CPU first).
- Procedural/data-driven module (CSV/JSON/API → animation).

**Phase 2 — Editor + cloud (first revenue)**
- Visual timeline editor on top of the document (the round-trip problem: decide source-of-truth model — likely "document is canonical, code is one view").
- Cloud render service: queue, GPU workers, render credits (the monetization hook). Reuse `render` package as the worker.

**Phase 3 — Scale**
- Custom WebGPU compute core (GPU particles/fluids) behind the `Engine` interface.
- Characters/skeletal: rigs, walk cycles, VRM avatars, mocap retarget, lip-sync.
- Templates/verticals (e-commerce, explainers, social). Git-style versioning → optional multiplayer.

---

## 7. Quality gates / Definition of Done

A task is done when: typed, unit-tested, example/golden updated, docs touched, and (for runtime tasks) **the determinism CI gate passes**. Every merge to main keeps `examples/` rendering and frame-hashing identically.

---

## 8. Suggested team split (2–4 people)

- **Engine/runtime owner** — core, clock, animation, engine-three, physics-rapier (the spine).
- **Pipeline/infra owner** — render package, headless backend, ffmpeg, CLI, CI, determinism gates.
- **DX/authoring owner** (if 3rd) — authoring API, examples, docs, player.
- Spikes A/B in M0 done in parallel by the engine + infra owners; converge on the decision memo before M1.
