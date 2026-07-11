# Plan — the surface pack: HTML → textures, SVG → geometry, AI-authored

**STATUS: SHIPPED (S1–S5, PRs #53–#57; v2 #59; v2.1 #60).** captureStill baker + surface
library + loadSurface (S1); svgToMesh + texturedQuad (S2); sign/cutout film props with
codegen'd art tables (S3); `vsim surface` generate→look→revise + the first AI-designed
surface, woodland-welcome-board (S4). **Animated textures v2 (PR #59)**: `textureFrames[]`
on mesh data + a `"texture.frame"` track (floored with a lerp-drift epsilon, clamped to the
sequence) selects the sampled frame in the software engine; `texturedQuad(id, { frames })`
authors it. engine-three and the Cycles bake are static-preview consumers: they show the base
`texture`, falling back to `textureFrames[0]`. **Screens v2.1 (PR #60)**: surface type
`"anim"` — source.html implements the recorder's `window.__film = { fps, frames, seek }`
contract, baked to a committed `frames/` sequence (art.png = frame 0); `loadSurfaceFrames()`
+ the film3d `screen` prop play it on a kiosk with a looping step-eased track (exact integer
holds at any doc fps). Showcase: `festival-marquee` (24 frames @ 12 fps, chasing bulbs).

*Goal: let the AI design **surface detail** (signs, posters, screens, patterns) in the two
visual languages it is genuinely fluent in — HTML/CSS and SVG — and bake those artifacts
into deterministic assets the films can cast, exactly the way characters work today.*

## Why this fits the architecture (research findings)

- **The HTML baker already exists.** `packages/motion/record.mjs` frame-steps pages in a
  pinned Chromium with determinism flags (`--force-color-profile=srgb --disable-lcd-text
  --font-render-hinting=none`), waits on `document.fonts.ready`, and is golden-tested
  byte-reproducible (record.mjs:5, record.test.ts:27). A single-still bake is a ~10-line
  variant: `goto file://` + one `screenshot`.
- **Textures are inline RGBA on `kind:"mesh"` geometry** (`core/document.ts:50-64`) and are
  **not JSON-serializable** — so a baked PNG cannot ride inside a Film3DDoc. It must be a
  **committed asset loaded by name at compile time**, the same contract as character rigs
  ("compileFilm3D is a pure function of the document; asset bytes are committed").
- **SVG → mesh has precedent**: `examples/25-weather/landmarks.ts` already ear-clips
  committed `<polygon>` SVGs into `kind:"mesh"` geometry, and
  `docs/plan-svg-asset-pipeline.md` sketched the broader direction. This plan promotes
  that pattern into the library with extrusion.
- **Cross-machine Chromium rasterization is not byte-stable**, so the committed PNG is the
  canonical asset; the HTML is the committed *source* that regenerates it (the
  `examples/04-gltf/make-asset.ts` bake-step pattern, restated in `docs/asset-packs.md`).

## The surface library

```
packages/assets/surfaces/
  <name>/
    source.html      # committed source — self-contained: inline CSS, bundled fonts only,
                     # no network, fixed data-size="512x384" viewport annotation
    art.png          # committed bake (the canonical bytes films consume)
    surface.json     # { name, size, license: "generated", prompt?: "..." }
  manifest.json      # index; listSurfaces() / loadSurface(name) → RGBA (like characters)
```

- `scripts/bake-surfaces.mjs` — regenerates every `art.png` from its `source.html` via the
  motion recorder's still mode (new `captureStill(path, {width, height})` export). CI does
  NOT re-bake (Chromium variance); a unit test asserts every surface has matching
  source + png + manifest entry.
- SVG shapes live in the same folder as `source.svg` and are consumed as **geometry**, not
  pixels: a pure-TS path parser (M/L/H/V/C/Q/Z subset, curves flattened) + the promoted
  ear-clip triangulator produce `kind:"mesh"` positions/indices at load. ~250 lines, no new
  dependency — consistent with the repo's "own the 150 lines" ethos; `svgExtrude` gives the
  outline depth (front/back faces + side walls).

## New authoring + film3d vocabulary

- `@vsim/assets`: `loadSurface(name)` → `{ texture, width, height }`;
  `svgToMesh(svg, { depth, scale })` → mesh data.
- `@vsim/authoring`: `b.texturedQuad(id, { texture, size })` (a `kind:"mesh"` quad with
  uvs + inline texture) — the primitive the props build on.
- **film3d props** (palette-aware, same `placeProp` pattern as `lantern`):
  - `{ kind: "sign", id, x, z, art: "<surface name>", angle }` — two posts + a board faced
    with the baked art; the schema validates `art` against the surface manifest (same
    synchronous-table trick as CHARACTERS, with the sync test).
  - `{ kind: "cutout", id, x, z, art, height, angle }` — an extruded SVG silhouette
    (logos, theater-set shapes, title cards in the world).
- The generator prompt lists available surface names, so the director can stage them.

## The AI loop: `vsim surface -p "…"`

Same generate → look → revise shape as films and creatures:
1. The AI writes a **self-contained HTML artifact** under hard constraints (validated by
   a linter step, not zod: no external URLs, no scripts for v1, bundled font faces only,
   declared size ≤1024²).
2. Bake → the designer **looks at its own PNG** (one review round) and may revise the HTML.
3. Register: write `source.html`, `art.png`, manifest entry. The surface is immediately
   stageable in films; the committed PNG re-renders byte-identically forever.
SVG mode (`--svg`) does the same with a `source.svg` + a rendered mesh turntable still.

## Determinism analysis

- Films consume only **committed PNG/SVG bytes** → the render pipeline's guarantees are
  untouched; golden hashes stay valid on every platform.
- The bake step is reproducible on one machine/Chromium build (recorder's existing
  guarantee) and treated like the Blender bakers: source-of-truth committed alongside.
- SVG→mesh is a pure function (parse → flatten → earclip) — deterministic everywhere, unit
  tested with fixed fixtures.

## Explicit non-goals (v1)

- **Animated textures** (screens that play HTML films): core has no texture frame-sequence
  channel — a real v2 feature (sketch: `data.textureFrames[]` + an `animate(id,
  "texture.frame", …)` track; the recorder already emits frame sequences).
- **HTML/CSS as 3D modeling** (CSS 3D transforms): dead end — HTML is the *surface*
  language, SVG the *shape* language.
- Photoreal path: Cycles consumes the same baked RGBA via the existing texture bake
  export — no extra work, but no special material either (unlit emissive option later for
  `screen`-like props).

## Stages

1. `captureStill` in the recorder + `scripts/bake-surfaces.mjs` + the surfaces folder with
   two hand-written proofs (a wooden trail sign, a poster) — golden still test.
2. `svgToMesh` (parser + promoted ear-clip + extrude) in `@vsim/assets` + unit tests;
   `b.texturedQuad` in authoring.
3. film3d `sign` + `cutout` props + schema/manifest sync validation + prompt + tests.
4. `vsim surface` generate/review/register loop; showcase film ("a rabbit stops under the
   trail sign at night, lantern light on the painted arrow").
5. Docs: asset-packs.md cross-link, README one-liner once shipped.
