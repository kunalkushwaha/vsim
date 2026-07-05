# Quickstart

## Install

```bash
pnpm install
```

## Render a scene to video

```bash
pnpm render examples/01-cube/scene.ts -o out/cube.mp4
```

Or use any of the bundled examples:

```bash
pnpm example:cube       # keyframed spinning/bouncing cube
pnpm example:physics    # deterministic Rapier leaning tower
pnpm example:beat       # audio beat-synced pulse (muxes audio)
pnpm example:gltf       # loads a glTF/GLB torus
pnpm example:crossfade  # a human blending idle → walk → run (layered clips)
pnpm example:normalmap  # tangent-space bump relief under a raking light
```

There are 23 in all — see [`examples/`](../examples) or `pnpm showreel` to render every one
into a single reel.

## Render faster (multi-core)

```bash
pnpm render examples/23-crossfade/scene.ts -o out/crossfade.mp4 --workers 4
```

`--workers N` splits every frame into horizontal bands rendered by N worker threads —
**byte-identical** to a single-threaded render, ~2.5× faster on 4 cores. Scenes with
physics fall back to single-threaded automatically (the simulation is stateful).

## Author a scene in code

A scene is just a module that default-exports a `SceneDocument`. The `@vsim/authoring`
builder is the ergonomic way to make one:

```ts
import { scene } from "@vsim/authoring";

export default scene({ fps: 30, duration: 90, width: 640, height: 360 })
  .material("cube", { color: [0.95, 0.4, 0.4] })
  .light({ type: "ambient", intensity: 0.4 })
  .light({ type: "directional", intensity: 1.2, direction: [-0.5, -1, -0.3] })
  .mesh("cube", { geometry: { kind: "box" }, material: "cube" })
  .camera({ position: [3, 2, 4.5], lookAt: [0, 0, 0] })
  .animate("cube", "rotation.y", [
    { frame: 0, value: 0 },
    { frame: 90, value: Math.PI * 2 },
  ])
  .build();
```

Render it:

```bash
pnpm render path/to/scene.ts -o out/my.mp4
```

## Preview live in the browser

The player drives the **same** runtime and engine as the renderer, so the live preview
matches the export exactly:

```ts
import { createPlayer } from "@vsim/player";
import doc from "./scene.ts";

const player = createPlayer(doc, { canvas: document.querySelector("canvas")!, loop: true });
await player.init();
player.play();
// player.seek(45); player.pause(); player.onFrame = (f, total) => ...
```

## Render a single frame (debug / thumbnail)

```bash
pnpm render examples/01-cube/scene.ts --still out/frame.png --frame 30
```

## CLI

```
vsim render <scene.ts|scene.json> [-o out.mp4] [--workers N] [--still frame.png --frame N] [--audio file]
vsim edit <scene.ts|scene.json> --prompt "..." [-o out.scene.json] [--render out.mp4]
```

See [scene-document.md](./scene-document.md) for the full document reference and
[determinism.md](./determinism.md) for why renders are reproducible.
