# Plan — vsim Studio (first demoable platform)

*Companion to `PLAN.md` / `CONCEPT.md`. This is **surface 2** ("designers / visual timeline editor")
— the step that turns the engine/SDK into a **platform people use**, not just a library developers call.*

---

## The goal

> **A browser app where you load a 3D scene, watch it play, scrub the timeline, click an object,
> and edit it live — and the preview updates instantly. Then export the scene (and render the MP4).**

Concretely, the **first demoable platform** = you open `vsim Studio` in a browser and can:

1. **See** a 3D scene rendered live on a canvas (reusing `@vsim/player` + `@vsim/engine-three`).
2. **Play / pause / scrub** the timeline (frame-accurate, the same runtime the renderer uses).
3. **Select** an object from a scene tree.
4. **Edit** its transform (position/rotation/scale) and material colour — preview updates instantly.
5. **Export** the edited scene document (JSON) — which `vsim render` turns into the final MP4.

That is a credible, demoable "studio": **load → preview → edit → export**, all in the browser, on top
of the deterministic engine we already have.

## Why this is achievable now

- The **scene document is the single source of truth**, and the runtime reads it **fresh every
  frame** — so mutating the document and re-presenting the current frame updates the preview live,
  with no engine rebuild for transform/material tweaks.
- `@vsim/player` already drives the real `SceneRuntime` + an `Engine` against a `<canvas>`, with
  `play/pause/seek` and an `onFrame` callback. The editor is a thin UI shell around it.
- "Preview == render" is already a tested invariant, so what you edit is what you'll export.

## Milestones

| # | Milestone | Demoable outcome |
|---|-----------|------------------|
| **M1** | **Live preview shell** — `apps/studio` (Vite + vanilla TS), canvas driven by `Player`, a sample procedural scene, play/pause + scrub slider + frame counter | "A 3D scene plays and scrubs in a web app." |
| **M2** | **Scene tree + selection** — a panel listing the document's nodes; click to select | "Click an object in the tree, see what's in the scene." |
| **M3** | **Inspector (live edit)** — edit the selected node's position/rotation/scale + material colour; preview updates instantly | "Drag a value, the scene changes live." ← **first demoable platform** |
| **M4** | **Timeline keyframing** — add/edit a keyframe for the selected property at the current frame (turns an edit into animation) | "Set two keyframes, scrub, watch it animate." |
| **M5** | **AI prompt + export** — a prompt box that edits the scene via the copilot; an Export that downloads the scene JSON (and shows the `vsim render` command) | "Type 'make the cube red', then export and render." |

**Goal line for "first demoable platform": M1–M3.** M4–M5 make it compelling; cloud rendering and
accounts (the business layer) come after.

## Architecture / what's reused

```
apps/studio  (Vite + vanilla TS, no UI framework — matches the project's hand-rolled ethos)
  └─ <canvas>  ← new Player(doc, { canvas })  → ThreeEngine (WebGL)   [@vsim/player, @vsim/engine-three]
  └─ scene tree / inspector  → mutate `doc` (the @vsim/core SceneDocument) → player.seek(currentFrame)
  └─ sample scene built with @vsim/authoring (procedural — browser-safe, no fs/glTF)
```

- **Browser-safe scenes only** at first: `@vsim/assets`' `loadCharacter` needs Node `fs`, so the
  in-browser samples use procedural geometry/props. Character loading comes later via a pre-baked
  document JSON or a small backend.
- **Live update strategy:** transform + material-colour edits mutate the doc and re-present (cheap);
  structural changes (add/remove node, change geometry) rebuild the `Player`.

## Not in this plan (later platform phases)

Cloud render service (GPU workers, render credits — the monetization hook), user accounts / project
persistence, real-time collaboration, a template marketplace, hosted AI (managed keys). These are
**surface 3–4 + the business layer** from `CONCEPT.md` and follow the editor.
