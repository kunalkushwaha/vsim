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

Nineteen canonical scenes live in [`examples/`](./examples): cube, collapsing box stack, glTF model,
beat-synced pulse, a procedural **walking character** filmed from three angles, a **kid playing
soccer** (a hand-animated kick + a ball that launches), an original **cartoon puppy** (a
procedural quadruped with a trot gait + waggy tail), rigged characters from the bundled
[character library](./packages/assets/library/CREDITS.md) — a **Fox**, a realistic **person**, and a
cast of **MakeHuman humans with real skin textures** (a woman, a man, and a child, generated headlessly
by `scripts/blender/make-human.py`; a **walk/run/idle/wave clip library** in `examples/13-clips`, the
**body variety** side-by-side in `examples/14-cast`, and one wearing **real clothing geometry**
— a suit + shoes as separate skinned meshes — in `examples/15-clothing`), plus a **VRM avatar**
(the web-3D humanoid format; `loadVrm` parses the humanoid bone map + license) in `examples/16-vrm`,
and **morph-target lip-sync** — a face whose mouth opens on every audio beat — in `examples/17-lipsync`,
and a character walking through a **park of procedural props** (`.tree()`/`.rock()` from cylinder/cone
primitives) in `examples/18-park`, and a procedural **quadruped** trotting in `examples/19-dog` —
loaded by name with `loadCharacter()` and **rendered with their real glTF textures** (PNG/JPEG
base-color, sampled in the software renderer), a **manga** scene (one-flag cel-shading +
outlines via `style: "manga"`), and **text & titles** — a title card, a sliding lower-third, and a
caption, as true vector type composited on top of the 3D — in `examples/20-titles`. Render any of
them, or build the montage:

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
| `@vsim/text` | Deterministic vector text rasterizer (bundled font → glyph fill) for screen-space titles/captions |
| `@vsim/physics-rapier` | Deterministic Rapier physics adapter |
| `@vsim/render` | Headless frame capture → ffmpeg → MP4 (+ audio mux) |
| `@vsim/authoring` | Declarative builder API: code → scene document |
| `@vsim/player` | Browser real-time preview component |
| `@vsim/assets` | glTF/GLB asset pipeline (load + export) |
| `@vsim/ai` | AI copilot: natural-language prompt → schema-constrained scene-document edits (Claude tool-use) |
| `@vsim/cli` | `vsim render scene.ts -o out.mp4` · `vsim edit scene.ts --prompt "…"` |

## AI copilot (preview)

Edit a scene in natural language. The copilot turns your prompt into **schema-constrained
edit operations** (Claude tool-use), grounded in the scene's existing objects — it can't
emit invalid geometry — then applies them deterministically into a new scene document you
can render like any other.

It runs the LLM through the Anthropic SDK (`ANTHROPIC_API_KEY`) **or**, if no key is set,
through the `claude` CLI (a Claude Code login) — so it works with whichever you have.

```bash
export ANTHROPIC_API_KEY=…            # optional — falls back to the `claude` CLI
vsim edit scene.ts --prompt "make the cube blue and add a point light" -o edited.scene.json
vsim edit scene.ts --prompt "spin it twice as fast" --render out.mp4
```

The AI runs only at authoring time and produces a document — it never touches the render
loop, so determinism is unaffected. Programmatically:

```ts
import { editScene, CopilotSession } from "@vsim/ai";
const { doc, operations, summary } = await editScene({ doc: scene, prompt: "add a red floor" });

// Multi-turn refine — follow-ups resolve against the running transcript:
const session = new CopilotSession(scene);
await session.refine("make the cube blue");
await session.refine("now spin it twice as fast"); // "it" = the cube
session.document; // the edited scene so far
```

## vsim Studio (preview — the visual editor)

The first slice of the **visual editor** (surface 2). A browser app on top of the same engine:
load a scene, **play/scrub** the timeline, **select** an object, **edit** its transform/colour
live, **keyframe** those properties (value at one frame, another later → it animates, with clickable
markers on the timeline), ask the **AI copilot** to change the scene in natural language, and
**render an MP4** — all in the browser. The preview updates instantly because the runtime reads the
scene document every frame, so *preview == render*.

```bash
pnpm studio:server   # backend (AI copilot + MP4 render) → http://localhost:8787
pnpm studio          # editor (Vite dev server)         → http://localhost:5173
```

Built with Vite + vanilla TS (no UI framework), reusing `@vsim/player` + `@vsim/engine-three` in the
browser and `@vsim/ai` + `@vsim/render` in a tiny Node backend (the seed of the eventual cloud layer;
the AI uses `ANTHROPIC_API_KEY` or the `claude` CLI). See
[`docs/plan-platform-studio.md`](./docs/plan-platform-studio.md) for the roadmap to a full platform.

## Docs

- [Quickstart](./docs/quickstart.md)
- [Scene document reference](./docs/scene-document.md)
- [Determinism guide](./docs/determinism.md)
- [ADR 0001 — render backend & determinism](./docs/decisions/0001-render-backend-and-determinism.md)
- [Guide: creating characters with Blender / MakeHuman](./docs/guides/blender-characters.md) — generate rigged, animated, **textured** glTF headlessly (incl. a realistic MakeHuman human with real skin) → `loadGltfRig`
- [Text & titles](./docs/plan-text-titles.md) — screen-space titles/captions/lower-thirds as deterministic vector type, in draft + photoreal + live preview
- [Vision & roadmap](./CONCEPT.md) · [`PLAN.md`](./PLAN.md)

`pnpm docs:site` builds a static documentation site (landing page + the docs above) into
`site/` — generated by the project's own tooling, no framework.

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
audio, and player are built, tested, and deterministic in CI. **Phase 1 in progress:** the
AI copilot (`@vsim/ai`, `vsim edit`) — prompt → schema-constrained scene-document edits.
Next: a visual timeline editor and cloud rendering — see [`PLAN.md`](./PLAN.md).

## License

MIT
