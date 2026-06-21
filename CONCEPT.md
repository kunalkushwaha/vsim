# Concept Brief — Web-Native 3D Animation & Video Framework

*Working name: TBD. Captured from brainstorming session, 2026-06-22.*

---

## One-line pitch

**"Remotion for real 3D."** A code-first, deterministic 3D engine for the web that
**exports short videos *and* embeds live interactive scenes from the same project** —
with real simulation (physics, particles, characters, data-driven) and an AI copilot.
Open-core, developers first.

## Why now / the gap

| Tool | Proved | Falls short on |
|------|--------|----------------|
| **Remotion** | code → video is a real category | 2D React-DOM only; no real 3D or simulation |
| **Spline / Theatre.js** | web 3D editing + timelines work | weak simulation, video export at scale, AI, data-driven generation |
| **Blender** | full 3D power | desktop-only, steep, no web/embed/collab, not built for templated render-at-scale |
| **Runway / AI video** | text → video is magic | no controllable scene graph, no determinism, no precise edit |

The wedge sits exactly in the middle: **controllable, reproducible, code-defined 3D that
ships as both video and live embed.**

---

## Target audiences (layered — one engine, four surfaces)

Serve sequentially, not at once:

1. **Developers** — core SDK / code API. ← **FIRST WEDGE**
2. **Designers / motion artists** — visual timeline editor built on the SDK.
3. **Non-technical creators** — templates + AI + simple controls.
4. **End-users on a site** — embeddable, configurable widgets.

This is the Figma/Remotion/Supabase pattern: engine → editor → templates → embeds.

## Business model

**Open core.** Open-source engine/SDK (adoption, trust, ecosystem) + paid cloud editor
and **server-side rendering** (the natural metered, monetizable resource).

---

## Architecture (the core bets)

```
        AUTHORING (3 modes, one document)
   ┌───────────┬──────────────┬──────────────┐
   │ Timeline  │  Code (R3F /  │  AI copilot  │
   │   UI      │   JSON DSL)   │ (prompt→doc) │
   └─────┬─────┴───────┬───────┴──────┬───────┘
         │             │              │
         ▼             ▼              ▼
        ┌──────────────────────────────┐
        │   CANONICAL SCENE DOCUMENT    │  ← single source of truth (serializable JSON/DSL)
        └───────────────┬──────────────┘
                        ▼
        ┌──────────────────────────────┐
        │   DETERMINISTIC RUNTIME       │  ← fixed timestep, seeded RNG, frame-indexed
        │   (Three.js + Rapier v1,      │
        │    engine behind thin iface)  │
        └───────┬───────────────┬───────┘
                ▼               ▼
        ┌───────────────┐ ┌──────────────────────┐
        │ LIVE EMBED    │ │ HEADLESS RENDER       │
        │ (real-time)   │ │ frames → ffmpeg → MP4 │
        └───────────────┘ └──────────────────────┘
                ▲
        Blender / glTF assets feed in (asset source, NOT runtime)
```

### Bet 1 — One canonical scene document
All three authoring modes read/write the **same** serializable document.
- Timeline mutates it visually; code authors it directly (diffable); AI generates/patches it.
- Must round-trip: AI generates → designer tweaks → dev edits in code.
- This is both the **moat and the hardest design problem** (the Webflow↔code problem).
- **Open risk:** lossless code↔timeline round-trip. Likely need a primary source-of-truth
  rule or a structured merge, not naive bidirectional sync.

### Bet 2 — Determinism is the whole game
Because output is **video + interactive + personalized variants**, and includes
**simulation**, the runtime must be deterministic and reproducible:
- fixed timestep, seeded randomness, no frame-rate dependence.
- **preview == final server render == N personalized renders.**
- Rapier (Rust/WASM) is deterministic by design — a key reason to pick it.
- Headless render runs the **identical engine** offline → no "render surprise," no second
  renderer to keep in sync.
- This is the single biggest piece of defensible engineering. Most web engines are sloppy here.

### Bet 3 — Same engine, two output modes
Real-time loop for the embed; deterministic frame-stepping for export. One codebase.

### Stack decision
- **v1: Three.js + Rapier**, hidden behind a thin engine interface.
  - Three.js → largest dev community + React-Three-Fiber (perfect for code authoring).
  - Rapier → deterministic physics.
- **Later: custom WebGPU compute core** for heavy sims (GPU particles/fluids), swapped in
  *without breaking the scene document / public API.*
- Babylon.js = runner-up (more batteries) but loses on the dev-ecosystem dimension that *is* the wedge.

### Audio (core requirement)
- Beat-sync, voiceover/TTS, sound effects, audio-driven timing.
- **Map beats → frame numbers (not wall-clock)** so audio-reactive animation stays
  reproducible in headless render. Audio + determinism reinforce each other.

### Collaboration
- Start with **Git-style versioning** (diff/branch/PR — nearly free since scenes are code/JSON).
- Defer Figma-style real-time multiplayer to the designer layer. Not in v1.

---

## Simulation scope (all four wanted; sequence them)

1. **Physics (rigid/soft)** — Rapier, deterministic. *(v1)*
2. **Particles & effects** — CPU first, GPU/WebGPU later. *(v1 basic → v3 GPU)*
3. **Procedural / data-driven** — rules + live data → motion. *(v1–v2)*
4. **Character / skeletal** — rigs, walk cycles, mocap retarget, avatars (VRM), lip-sync. *(v2–v3, hardest)*

---

## MVP — the "Code → Video" magic moment

**Situation:** small founding team (2–4), months horizon.

**v0.1 north-star demo:** *Write a small 3D scene in code (R3F-style) with physics, hit
render, get an MP4 with real 3D + deterministic simulation.* The developer "aha."

**v0.1 must-haves**
- [ ] Canonical scene document schema (v0)
- [ ] Three.js runtime with **fixed-timestep deterministic loop** + seeded RNG
- [ ] R3F-style declarative code API
- [ ] Rapier physics integration (deterministic)
- [ ] glTF asset import (from Blender pipeline)
- [ ] Headless render → frames → **ffmpeg → MP4**
- [ ] Basic audio track attached + exported (beat-sync can follow)

**Explicitly NOT in v0.1:** visual editor, multiplayer, templates, GPU particle core,
characters/skeletal, marketplace.

## Suggested roadmap

- **Phase 0 (MVP):** scene doc + deterministic Three.js+Rapier runtime + code API +
  headless MP4. → *code → video.*
- **Phase 1:** AI copilot (prompt → scene-doc patches, schema-constrained); glTF asset
  pipeline + library; audio beat-sync + TTS voiceover.
- **Phase 2:** visual timeline editor on the document; **cloud render service** (first $).
- **Phase 3:** templates/verticals (e-commerce, explainers, social); WebGPU particle core;
  characters/skeletal + mocap; collaboration.

---

## Top risks / open questions

1. **Code ↔ timeline round-trip fidelity** — the hardest UX/architecture problem. Decide
   the source-of-truth model early.
2. **Headless GPU rendering cost & throughput** — this is the COGS *and* the monetization
   hook. Validate the render pipeline (headless WebGL/WebGPU + ffmpeg + GPU infra) early.
3. **Cross-platform float determinism** — mitigated by running final renders through the
   *same* pipeline; still verify Rapier reproducibility across your preview/render targets.
4. **AI → valid scene DSL** — constrain via JSON schema / tool-calling; ground in the
   actual available assets so it can't hallucinate geometry.
5. **Scope discipline** — 4 audiences × 4 use cases × 4 sim types is a platform, not an MVP.
   The team's success depends on holding the line at "code → video" for v0.1.

## Naming

Working dir is `video-simulator` — placeholder. Worth a real name before launch
(the "for real 3D" / "code→video" angle suggests something dev-flavored).
