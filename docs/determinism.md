# Determinism

The core promise: **the same scene produces the same output** — whether previewed live,
rendered on a server, or rendered as 100 personalized variants. This is what makes
server-side rendering and templated/data-driven generation trustworthy.

## How it's enforced

1. **Frame-based time.** Time is measured in whole frames, never wall-clock seconds. The
   `Clock` advances in a fixed timestep (`dt = 1/fps`) with optional sub-steps. No
   frame-rate dependence, no accumulated float drift. (`packages/core/src/clock.ts`)

2. **Seeded randomness only.** All randomness comes from `Rng` (mulberry32), seeded from
   `document.meta.seed`. Global `Math.random` is **banned** in runtime packages by a lint
   guard (`scripts/check-determinism.mjs`, run in CI). (`packages/core/src/rng.ts`)

3. **One engine, two output modes.** The live player and the headless renderer step the
   *same* `SceneRuntime` and draw with the *same* `Engine`. There is no separate render
   path that could drift from preview.

4. **Deterministic physics.** Rapier (Rust/WASM) is stepped at the fixed sub-timestep, so
   the same scene simulates identically run-to-run.

5. **Audio as frame indices.** Beats are stored as frame numbers, not seconds, so
   audio-reactive animation is reproducible.

6. **Stateful features replay from frame 0.** Physics, spring bones, and stance locking
   (`ik.lock`) step forward frame by frame; on a backward seek the runtime replays from
   frame 0 rather than interpolating, so scrubbing, re-rendering, and worker splits all
   agree. Particles avoid state entirely: every particle's position is a **closed-form**
   function of (index, frame, seed) — ballistic motion from hashed spawn parameters.

7. **Parallel rendering is byte-identical.** The software renderer can rasterize any
   horizontal band of a frame independently (`SoftwareEngineOptions.region`), so
   `renderToVideo({ workers: N })` / `vsim render --workers N` splits frames across
   worker threads and concatenates the rows — proven equal to a single-threaded render
   in `tiling.test.ts` and `parallel.test.ts`. Scenes with physics fall back to
   single-threaded (see point 6).

## How it's tested (the CI gate)

- `packages/render/src/determinism.test.ts` renders a scene twice and asserts the frames
  are **byte-identical** (sha256), and compares against committed golden hashes
  (`__golden__.json`). A drift fails CI.
- `packages/render/src/physics-determinism.test.ts` does the same for a physics scene
  (run-twice equality; no committed golden, since Rapier's f32 results are deterministic on
  a given build but not guaranteed bit-identical across different CPUs).

## The software engine as the determinism oracle

`@vsim/engine-software` is a pure-TypeScript rasterizer with **no GPU and no native deps**.
Because it's pure JS, it produces identical bytes on every machine — making it both the
default headless renderer and the reference against which the GPU (`engine-three`) path is
compared. It's also why the whole pipeline runs in any CI environment without a GPU.
