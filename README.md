# vsim — code → 3D video

A web-native, **deterministic** 3D animation & short-video framework. Write a scene in
code, render a reproducible MP4, or embed it live. *"Remotion for real 3D."*

See [`CONCEPT.md`](./CONCEPT.md) for the vision and [`PLAN.md`](./PLAN.md) for the roadmap.

## Why deterministic?

The same scene must produce the **same** output whether previewed live, rendered on a
server, or rendered as 100 personalized variants. So the runtime uses a fixed timestep,
frame-based time, and a seeded RNG. Determinism is enforced in CI via golden-frame hashes.

## Packages

| Package | Role |
|---------|------|
| `@vsim/core` | Scene document schema, fixed-timestep clock, seeded RNG, animation eval, math, engine interface — **zero engine deps** |
| `@vsim/engine-software` | Pure-TS reference rasterizer. Runs anywhere (no GPU), bit-identical — the determinism oracle & default renderer |
| `@vsim/engine-three` | Three.js production renderer (GPU, high fidelity) |
| `@vsim/physics-rapier` | Deterministic Rapier physics adapter |
| `@vsim/render` | Headless frame capture → ffmpeg → MP4 (+ audio mux) |
| `@vsim/authoring` | Declarative builder API: code → scene document |
| `@vsim/player` | Browser real-time preview component |
| `@vsim/cli` | `vsim render scene.ts -o out.mp4` |

## Quickstart

```bash
pnpm install
pnpm example:cube        # build + render examples/01-cube → out/cube.mp4
pnpm test                # unit + determinism (golden-frame) tests
```

## Status

v0.1 in progress — `code → video` MVP. Tracked in `PLAN.md`.
