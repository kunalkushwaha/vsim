# Plan — photoreal & high-end artistic characters

*Companion to `docs/plan-platform-studio.md`. Goal: lift vsim from flat software-rasterized "draft"
output to genuinely **photoreal** (and high-end **artistic**) characters.*

---

## The goal

> **vsim can produce photoreal character output** — real subsurface skin, soft shadows, global
> illumination — via a path-traced **Blender/Cycles** render backend, while the real-time editor
> preview is upgraded to PBR (texture maps + shadows + image-based lighting).

## Why this split

The pure-TS software renderer is the determinism **oracle** (Lambert-only; it will never be
photoreal — and that's fine, it stays the fast deterministic *draft*). Photorealism needs a
path tracer. vsim already drives **Blender headless** for asset generation, so extending that to
**Cycles rendering** is the natural, lowest-risk route to real photorealism. The model becomes:

- **edit + preview** fast in the Studio (engine-three, PBR) — *approximate*
- **final render** path-traced in Cycles — *photoreal*

Determinism shifts here from "byte-identical on any CPU" to **deterministic inputs + fixed Cycles
seed/sample count** (a documented, deliberate tradeoff for the photoreal path).

## Milestones

| # | Milestone | Verifiable here? | Outcome |
|---|-----------|------------------|---------|
| **F1** | **Cycles photoreal character still** — a Blender backend that imports a vsim character glTF, builds a subsurface **skin** material, lights it (studio 3-point), frames a camera, and path-traces a PNG | ✅ (read the PNG) | "A bundled character, rendered photoreal." |
| **F2** | **PBR material + texture-map pipeline** — `MaterialSchema` gains normal/roughness/metalness/AO/emissive map slots; the loader reads all glTF maps; **SSS-skin MakeHuman** assets exported with full maps | ✅ (loader tests) | "Characters carry real PBR maps, not just base colour." |
| **F3** | **engine-three real-time fidelity** — wire the PBR maps + shadow maps + ACES tone mapping + **HDRI image-based lighting** into the editor preview | ⚠️ code/typecheck only (no headless WebGL here) | "The editor preview looks good, not flat." |
| **F4** | **Scene-document → Cycles backend + Studio "Final render (photoreal)"** — translate a full vsim document (meshes/lights/camera/animation) to Blender, path-trace frames → MP4; wire a photoreal option into the Studio render endpoint | ✅ (read frames) | "Click Final render → a photoreal MP4 of your scene." |

**Leading with F1** (then F2 → F3 → F4): F1 is the only step that both *delivers* true photorealism and
is *provable* in this environment, and it de-risks the whole direction. F2 is recommendation #1 (the
PBR pipeline, which feeds both Cycles and engine-three); F3 is recommendation #2 (the editor preview).

## Constraints / honesty

- **Likeness/IP:** photoreal *real people* need rights; bundle only CC0/licensed assets, never a
  specific real person's likeness without consent (consistent with the project's IP stance).
- **No headless WebGL here:** F3 (engine-three) is written + typechecked but its visual result can
  only be confirmed by running `pnpm studio` locally — F1/F2/F4 are verified by reading rendered files.
- **Cost:** Cycles is CPU-path-traced here (slower); GPU would be used in production.
