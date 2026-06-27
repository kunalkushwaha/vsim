# ADR 0001 — Render backend & determinism rules

Status: accepted · Date: 2026-06-22 · Closes M0 Spikes A & B (PLAN T-003/T-004/T-005)

## Context

Two assumptions could sink the project and had to be de-risked first:
- **Spike A** — can we render 3D headless and produce an MP4 cheaply/reliably?
- **Spike B** — can the engine produce reproducible (byte-identical) output across runs?

## Decision

### Rendering backend
A renderer-agnostic `Engine` interface, with **two** implementations:

1. **`@vsim/engine-software`** — pure-TypeScript rasterizer (z-buffer, Gouraud lambert).
   No GPU, no native dependencies. **This is the default headless renderer** and the
   determinism oracle. It is what the `render` package streams into ffmpeg.
   - *Spike A result:* proven. `doc → frames → ffmpeg → MP4` runs in any environment
     (incl. CI) with zero GPU. A 3s 640×360 clip renders in well under a second.
2. **`@vsim/engine-three`** — Three.js/WebGL for high-fidelity GPU output (PBR lighting,
   antialiasing). Renderer is injectable: a browser canvas (the player) or a headless GL
   context (e.g. `headless-gl`) on a server. This is the future high-fidelity render path;
   it shares the exact `Engine` contract and reuses core tessellation so geometry matches.

**Why software-first:** it removes the GPU/driver/infra dependency from the critical path,
guarantees determinism, and keeps the dev loop and CI trivial. The GPU path is additive.

### Determinism rules (Spike B — proven via the golden-frame test)
1. Time is **frames**, never wall-clock. Fixed timestep `dt = 1/fps`, with `meta.substeps`.
2. All randomness via seeded `Rng` (mulberry32) seeded from `meta.seed`.
   `Math.random` / `Date.now` / `performance.now` are **banned** in runtime packages and
   enforced by `scripts/check-determinism.mjs` in CI. (The `player` is exempt — it uses
   wall-clock for live playback only.)
3. One engine drives both live preview and offline render — no second path to drift.
4. Physics (Rapier) stepped at the fixed sub-timestep; run-to-run identical.
5. Beats stored as frame indices → reproducible audio-reactive motion.
6. CI gate: render twice, assert byte-identical frames + match committed golden hashes.

## Consequences
- The whole stack runs headless anywhere; GPU is opt-in, not required.
- "Preview == server render == N variants" holds by construction, tested in CI
  (`render/parity.test.ts` scrubs the player and frame-hashes it against the offline render).
- Trade-off: the software renderer is feature-limited (lambert, no shadows/AA). Acceptable:
  it's the reference/default; `engine-three` is the fidelity path when GPU is available.
- Resolved: the software renderer now does near-plane clipping (Sutherland–Hodgman against
  `w = ε`), so triangles crossing the near plane are clipped, not dropped.
