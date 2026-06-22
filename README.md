# vsim — code → 3D video

**"Remotion for real 3D."** Write a 3D scene in TypeScript — meshes, physics, glTF
models, beat-synced audio — run one command, and get a **deterministic** MP4. The same
scene also plays live in the browser. Preview == final render == N personalized variants,
because the runtime is byte-for-byte reproducible.

```bash
npm i -D @vsim/cli @vsim/authoring
npx vsim render scene.ts -o out.mp4
```

```ts
// scene.ts
import { scene } from "@vsim/authoring";

export default scene({ fps: 30, duration: 90, width: 640, height: 360 })
  .material("cube", { color: [0.95, 0.4, 0.4], roughness: 0.5 })
  .light({ type: "ambient", intensity: 0.35 })
  .light({ type: "directional", intensity: 1.2, direction: [-0.5, -1, -0.35] })
  .mesh("floor", { geometry: { kind: "plane", size: [20, 20] }, material: "cube", position: [0, -1, 0] })
  .mesh("cube", { geometry: { kind: "box", size: [1.4, 1.4, 1.4] }, material: "cube" })
  .camera({ position: [3, 2.2, 4.5], lookAt: [0, 0.3, 0], fov: 45 })
  .animate("cube", "rotation.y", [
    { frame: 0, value: 0 },
    { frame: 90, value: Math.PI * 2 },
  ])
  .build();
```

That's the whole loop: a `.ts` file in, a reproducible `.mp4` out — no GPU required (the
default renderer is a pure-TypeScript rasterizer that runs anywhere).

## Why deterministic?

The same scene must produce the **same** pixels whether previewed live, rendered on a
server, or fanned out into 100 personalized variants. So the runtime uses a fixed
timestep, **frame-based time** (beats and physics steps map to frame indices, never wall
clock), and a **seeded RNG** — global `Math.random` is banned in runtime code by a lint
rule. Determinism is enforced in CI via golden-frame hashes: two renders of the same
scene are byte-identical, and the live preview matches the headless render frame-for-frame.

## What's in the box (v0.1)

- **Code → video**: declarative scene builder → MP4 via `vsim render`.
- **Physics**: deterministic Rapier rigid bodies, fixed-step, reproducible.
- **Assets**: glTF/GLB load + export.
- **Audio**: mux a track into the MP4 and drive properties from beat frames.
- **Live preview**: a browser player that shares the exact runtime with the renderer.

## Examples & showreel

Four canonical scenes live in [`examples/`](./examples) (cube, collapsing box stack,
glTF model, beat-synced pulse). Render any of them, or build the montage:

```bash
pnpm install
pnpm example:cube     # → out/cube.mp4
pnpm showreel         # renders all examples → out/showreel.mp4
```

`out/showreel.mp4` is produced entirely by vsim (ffmpeg only concatenates the clips).

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
| `@vsim/assets` | glTF/GLB asset pipeline (load + export) |
| `@vsim/cli` | `vsim render scene.ts -o out.mp4` |

## Docs

- [Quickstart](./docs/quickstart.md)
- [Scene document reference](./docs/scene-document.md)
- [Determinism guide](./docs/determinism.md)
- [Vision & roadmap](./CONCEPT.md) · [`PLAN.md`](./PLAN.md)

## Develop

Requires Node ≥ 20, pnpm, and ffmpeg on PATH.

```bash
pnpm install
pnpm test          # unit + determinism (golden-frame) tests
pnpm typecheck
pnpm lint          # determinism lint (bans Math.random in runtime)
pnpm build         # compile all packages to dist/
```

Releasing is documented in [`RELEASING.md`](./RELEASING.md).

## Status

**v0.1 — the open-source `code → video` SDK.** The runtime, renderer, physics, assets,
audio, and player are built, tested, and deterministic in CI. Up next: an AI copilot
(prompt → scene-document patches), a visual timeline editor, and cloud rendering — see
[`PLAN.md`](./PLAN.md).

## License

MIT
