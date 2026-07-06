# Plan — the SVG/HTML animation studio (base assets for movies, explainers & kids' content)

> Companion to `plan-svg-asset-pipeline.md`. That doc feeds SVG into the 3D engine; THIS one
> brainstorms the 2D craft itself: how agent-authored SVG + CSS + open-source JS animation
> becomes something you'd call a film — an animated short, a technical explainer, a kids'
> episode — not a pile of clip-art tweens.

## 1 · What separates "great" from "clip-art"

Great is a *style system*, not better drawings. Every asset in a production imports the same
design tokens, so an agent can generate 50 assets that look like one artist made them:

- **Palette tokens** — 5–7 named colors + tint/shade ramps; lint bans raw hex outside them.
- **One shape language** — a corner-radius scale, a stroke-width scale, one lighting
  direction (all shadows agree), consistent negative space.
- **Texture pass** — SVG filters (subtle grain, paper, halftone) applied at the scene level
  so everything sits in the same world; `rough.js` for a whole hand-drawn/whiteboard mode.
- **Timing presets, not tweens** — named eases (`snappy`, `floaty`, `heavy`, `mechanical`)
  with squash/stretch and follow-through baked into presets. The Disney 12 principles as a
  utility library: `anticipate()`, `overshoot()`, `arc()`, `secondaryAction()`. Agents reach
  for a preset, never a linear tween — this single rule kills 80% of "programmer animation".

## 2 · The asset taxonomy (what a production actually needs)

1. **Characters** — cutout puppets: grouped body parts with pivots; a facial state library
   (eyes/brows/mouths as `<symbol>` swaps — expression = brow × eye × mouth combination);
   an 8-shape **viseme set** for lip-sync; blink/idle/breathe loops that run for free.
2. **Sets & backdrops** — parallax layer stacks (near/mid/far), sky systems with time-of-day
   palettes, interior/exterior kits.
3. **Props** — the pipeline doc's kits (extrude/lathe recipes still apply in 2D as shading).
4. **Explainer diagram primitives** — the technical-content goldmine: server/db/browser/
   cloud/queue icons *with animated states* (idle pulse, error shake, busy spinner); packet
   dots that travel along `<path>` connectors; arrows that draw on; containers that expand;
   a code-block component with typing + line-highlight; step chips; animated charts.
5. **Typography** — kinetic type presets, karaoke captions, title cards, lower thirds.
6. **Effects** — confetti, impact stars, speed lines, smears, dust poofs, weather.
7. **Transitions** — iris, wipe, shape-morph cuts, match cuts on silhouettes.
8. **Audio scaffolding** — beat markers, viseme timing tracks, SFX cue points.

## 3 · Open-source library landscape (what to build on vs. build)

| Library | License | Use it for |
|---|---|---|
| **Motion Canvas** | MIT | *The* explainer-video engine (TypeScript, procedural, code blocks, signals) — closest existing thing to this whole plan; study or adopt |
| **anime.js v4** | MIT | Lightweight SVG timelines: path morphing, line drawing, motion paths |
| **Theatre.js** | Apache-2.0 | A real timeline/sequence editor UI in the browser — choreograph scenes visually, store as JSON |
| **GSAP** (+ MorphSVG/DrawSVG) | free (not OSI) | Industry-standard timelines; flag the license nuance before depending on it |
| **Motion** (motion.dev) | MIT | WAAPI-based springs/gestures |
| **lottie-web / dotLottie** | MIT | Import thousands of ready-made After-Effects-grade animations |
| **Rive runtime** | MIT (editor closed) | State-machine characters (interactive) |
| **rough.js** | MIT | Hand-drawn/whiteboard style mode |
| **Excalidraw** | MIT | Sketchy diagram assets + its huge community libraries |
| **vivus.js** | MIT | Line-drawing reveals |
| **flubber** | MIT | Shape interpolation (weather icons, logo morphs, mouth shapes) |
| **two.js / p5.js** | MIT/LGPL | Generative/procedural motion graphics |
| **Manim** | MIT (Python) | The 3Blue1Brown reference — steal its *grammar* (Create/Transform/Indicate) even if we don't run it |
| **Piper TTS + whisperX** | MIT/BSD | Narration + forced alignment → viseme & caption timing |

The gap none of them fill alone: a **token-governed asset system** + **agent-oriented
conventions** + **deterministic frame export**. That's the part worth building.

## 4 · Three production archetypes

- **Animated short (kids)** — character-driven: puppet rigs, big eases, googly eyes that
  track targets, confetti physics, day/night palette swaps. Story beats as a `screenplay.json`
  the agent fills scene by scene.
- **Technical explainer** — diagram-driven: the packet-along-a-path pattern, draw-on arrows,
  typed code, zoom-and-highlight camera moves on an SVG canvas (viewBox animation *is* the
  camera). Manim-style grammar: `create() → transform() → indicate() → fade()`.
- **Concept/edu explainer** — metaphor-driven: morph transitions between representations
  (equation → graph → physical picture via flubber), kinetic typography, narrated pacing
  from the audio alignment track.

## 5 · The film pipeline (deterministic, agent-runnable, today)

```
screenplay.json → per-scene HTML/SVG (assets from kits) → master Theatre.js/anime timeline
   → frame-step export: timeline.seek(frame/fps) + headless-Chromium screenshot per frame
   → ffmpeg → MP4   (+ Piper narration → whisperX alignment → visemes & karaoke captions)
```

- Frame-stepping a seekable timeline in headless Chromium is **deterministic** — same DOM,
  same frame index, same pixels — the same contract vsim's renderer makes, so goldens work.
- The viewBox is the camera: pans/zooms/shakes are viewBox keyframes, which agents reason
  about trivially (it's four numbers).
- vsim bridge (both directions): 2D SVG puppets composited over 3D vsim sets; or vsim's
  weather-style dioramas embedded as scenes inside a 2D film.

## 6 · Agent workflow: the writers' room

- **Screenplay as data**: scene list, beats, dialogue, camera notes — agent-writable JSON;
  each beat maps to a timeline chapter.
- **Contact sheets + animated previews** per kit (hover to play a loop) — the review
  surface for humans AND for agent self-critique via screenshot.
- **The refine loop is the studio**: author SVG → screenshot → critique → edit, per asset;
  then per scene; then per cut. Exactly the loop that built the weather cities, scaled up.
- **Lint as art direction**: tokens-only colors, pivots required on limbs, ease presets
  only, max path complexity, viewBox conventions. The linter is the style guide enforced.
- **Golden frames** at t = 0 / mid / end of every animation keep packs regression-safe.

## 7 · Suggested proving grounds (in order)

1. **Explainer starter kit** — 12 diagram primitives (server, db, browser, queue, packet
   dots, draw-on arrow, code block, callout, chip, chart bar/line, zoom camera helper) +
   tokens + preview page. Test: a 60-second "how a web request works" short, fully
   agent-produced, exported to MP4 via the frame-step recorder.
2. **Character starter kit** — one kid-friendly puppet (rebuild the vsim mouse as an SVG
   cutout) with expression matrix, viseme set, blink/idle loops. Test: a 20-second gag with
   narration + lip-sync from the Piper→whisperX track.
3. **The recorder** — the reusable `record.mjs` (Playwright + ffmpeg, frame-stepped,
   deterministic) that turns ANY seekable HTML/SVG timeline into an MP4 — the piece that
   makes everything above "a movie" instead of "a web page".
