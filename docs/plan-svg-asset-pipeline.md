# Plan — SVG-first animation asset pipeline

> Brainstorm following the weather-example landmarks (PR #32), where hand-authored SVGs were
> triangulated into 3D stage scenery. The thesis: **SVG is the asset format coding agents are
> natively fluent in** — text they can write, diff, review, and iterate on with nothing but a
> browser screenshot loop — and it maps cleanly onto vsim's determinism story (same bytes →
> same triangles → same pixels). This plan turns that one-off into a pipeline.

## 1 · Why SVG as the base-asset format

- **Agents author it fluently.** LLMs are demonstrably strong at HTML/CSS/SVG. An asset
  request becomes a prompt; the refine loop (author → render preview → critique → edit) is
  fully automatable because the asset *is code*. No GUI tooling in the loop.
- **It's reviewable.** Assets become PR-able text: diffs show what changed, golden-image
  tests show what it looks like. "Asset packs as code."
- **It's deterministic.** No binary opaqueness; parsing + triangulation are pure functions.
- **The ecosystem is enormous.** CC0/CC-BY vector sources to seed packs: Kenney (CC0),
  game-icons.net (CC-BY), Twemoji (CC-BY), Wikimedia silhouettes (PD/CC0), OpenMoji.
  Licensing stays auditable because the source file travels with the asset.

## 2 · Grow the SVG subset we understand

Today `landmarks.ts` reads `<polygon fill>` only, with a hand-rolled ear clipper. Promote it
to `@vsim/assets` `loadSvg()` built on proven MIT libraries:

- **earcut** (mapbox) — triangulation *with holes* (evenodd/nonzero fill), battle-tested.
- **svgpath** — parse `<path d>`, flatten transforms, normalize arcs/béziers.
- Bézier flattening at a **fixed sample count** (not adaptive-by-float-error) keeps output
  byte-stable across platforms.
- Trivial element conversions: `<rect> <circle> <ellipse> <polyline> <line>`.
- Strokes: expand to thin quads (cheap) or stroke-to-path (later).
- Gradients → per-vertex colors or small generated textures.
- `<text>` → outlines via opentype.js (already a dependency) so wordmarks become geometry.
- **svgo** in CI to normalize authored files before parsing.

## 3 · From flat to 3D: dimensionality recipes

One source silhouette, several body plans — pick per asset via `data-*` attributes:

| Recipe | What it makes | How |
|---|---|---|
| **Layered flats** (shipped) | Stage scenery, skylines, backdrops | `data-z` per `<g>`; paint order = depth; parallax under camera moves |
| **Extrusion** | Logos, landmarks, props with real thickness | front/back faces + wall quads from outline edges; optional bevel ring |
| **Lathe / revolve** | Vases, towers, lamp posts, chess pieces, tree trunks | an SVG *profile path* spun around Y — agents draw profiles easily |
| **Inflation** | Soft "paper puppet" look (Monument Valley) | distance-transform heightfield from the silhouette → pillowed relief |
| **Scatter stencil** | Forests, crowds, star fields | SVG shape as a spatial mask for the hashed scatter system (grass already works this way) |

- **Pivots for animation**: `data-pivot="x,y"` on a group → the node's origin, so ears wave
  and arms swing around the right point (the mouse character, described declaratively).
- **Paths as motion data**: an SVG path in a `#motion` layer becomes a position track —
  camera dollies, walk paths, particle emitter sweeps. Draw the shot, don't keyframe it.

## 4 · Asset kits: conventions + manifest

A kit = a folder of SVGs + `manifest.json` (mirror of the character library):

```
kits/city-props/
  manifest.json        # id, license, scale hints, tags
  tree-oak.svg         # data-height-m="6" data-recipe="flats"
  lamp-post.svg        # data-recipe="lathe" data-emissive="#head"
  bench.svg            # data-recipe="extrude" data-depth="0.4"
  preview.html         # contact sheet — the human/agent review surface
```

- `data-material` per shape: roughness/metalness/emissive so a lamp head glows.
- Deterministic per-instance variation (heights, lean, hue) hashed from instance id —
  the tree()/grass() trick generalized.
- An agent can emit a whole themed kit in one shot ("1920s Paris", "cyberpunk alley"),
  preview it as the contact sheet, and iterate — then every scene gets set dressing by name.

## 5 · Animating SVG-born assets

- **Cutout puppets**: a `#rig` layer of `<line>` bones (joints at endpoints) + groups named
  per part → auto-build the pivoted node hierarchy. The 2D-puppet workflow (Spine / AE
  puppet tool), but authored as text.
- **SMIL/CSS ↔ tracks**: allow simple `<animateTransform>` / `@keyframes` in the SVG and
  convert them to vsim keyframe tracks. The *same file* animates in a plain browser tab
  (instant preview, no engine) and byte-identically in the renderer.
- **Path morphing**: **flubber** (MIT) interpolates between arbitrary paths → generate
  morph-target sequences (logo A → logo B, sun → moon weather icons).
- **Lottie import**: the bodymovin JSON format carries thousands of ready-made animations
  (LottieFiles). A lottie→tracks importer is the highest-leverage "open library" move.
- **Draw-on reveals**: stroke-dashoffset line drawing as an overlay effect for diagrams,
  maps, and logo stings — pairs naturally with the vector text system.

## 6 · Blender as the photoreal stage (later)

vsim's two-tier model — deterministic TS draft, Cycles photoreal final — extends from
*scenes* to *assets*, and Blender imports SVG natively as curves:

- **svg → glb baker** (`scripts/blender/svg-to-asset.py`, runs on `pip install bpy` like
  cycles-render already does): import SVG → extrude + bevel + solidify → PBR materials from
  the same `data-material` hints → export `.glb` into the character/prop library. Draft
  render keeps the flat/extruded TS mesh; photoreal gets real bevels, normals, and shadows —
  **same silhouette, two fidelities, one source file**.
- **Geometry nodes on SVG curves**: curve-to-mesh for railings/cables (Tower Bridge chains,
  properly round), array/scatter along paths, procedural buildings from SVG footprints.
  OpenStreetMap exports SVG → real city blocks become geometry.
- **Inflation at quality**: displacement/subsurf on the silhouette heightfield for the
  puffed look with real GI.
- **Rig transfer**: the `#rig` bone layer generates a bpy armature, so a cutout puppet
  becomes a genuinely skinned 3D character in the photoreal pass.

## 7 · Guardrails

- Every kit asset gets a **golden-silhouette test**: render a canonical still, hash it —
  packs are regression-safe exactly like scenes.
- License file per kit; image drop-ins stay gitignored (established in PR #32).
- The parser subset is a *contract*: reject unsupported SVG features loudly (no silent
  wrong renders) and document the supported grammar in `docs/scene-document.md`'s sibling.

## 8 · Suggested sequencing

1. `loadSvg()` in `@vsim/assets` — earcut + svgpath, holes, transforms, all basic shapes
   (promote + retire the weather example's local parser).
2. Extrusion + lathe recipes with `data-*` conventions (depth, pivot, material, z).
3. First kit: **city props** (trees, lamps, benches, vehicles) + contact-sheet preview page;
   set-dress the park/weather examples from it.
4. Cutout-puppet rig layer → rebuild the mouse as a declarative SVG puppet (the proof).
5. flubber morphs + draw-on reveals (weather icons, logo stings).
6. Lottie importer.
7. Blender `svg-to-asset.py` baker → photoreal props from the same files.
