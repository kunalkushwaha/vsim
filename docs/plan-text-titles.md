# Plan / state — text & titles

*Status: **shipped & pushed** to `main` (commits `b259c6b` draft+photoreal, `743855f` live preview).
Paused here. This doc is the handoff so work can resume cold.*

---

## The goal

> **Screen-space text on top of the 3D** — titles, captions, lower-thirds — as **true vector type**
> (a bundled font filled deterministically), working identically in the **draft** MP4, the
> **photoreal** (Cycles) MP4, and the **live Studio preview**, and placeable by the **AI copilot**.

Not bitmap fonts, not the platform's font engine: glyph outlines are filled by vsim, so the same
text is the same pixels everywhere (and stays inside the determinism guarantee).

## What shipped (all done)

| Area | What | Verified here? |
|---|---|---|
| Rasterizer | `@vsim/text` — opentype.js + bundled **DejaVu Sans Bold**, glyph-path supersampled scanline fill (nonzero winding) → coverage bitmap. Per-glyph layout via `charToGlyph`+kerning (sidesteps opentype 1.3.5's GSUB crash on DejaVu). | ✅ rendered "Hello, vsim!" PNG, deterministic |
| Schema | core `TextOverlay` (id/text/x/y/size/color/opacity/align/box) + `doc.overlays`; `FrameState.overlays`; runtime resolves + animates them via tracks targeting `overlayId` (opacity/x/y/size/color). | ✅ runtime tests |
| Draft | `engine-software` composites overlays as a post-pass (gamma-space alpha blend + optional box). | ✅ rendered `out/titles.mp4`, read frames |
| Photoreal | bake emits resolved overlays per frame; `apps/studio/cycles-overlay.ts` composites them onto the path-traced PNGs with the **same** compositor → pixel-identical to draft. | ✅ composited onto a stand-in path-traced PNG |
| Live preview | `@vsim/player` `overlayCanvas` option paints `FrameState.overlays` onto a stacked transparent 2D canvas via `@vsim/text` (same layout+gamma). Studio stacks `#preview-overlay`, fetches the font, passes it in. | ⚠️ Vite build + pure-layout tests only (no headless WebGL/DOM here) |
| Authoring | `.text(id, text, opts)`, `.animateOverlay(id, path, kfs)`, `.title(...)` fade-in/out preset. | ✅ example renders |
| AI copilot | `add_text` / `remove_text` tools + `overlayId` on `add_animation`; system prompt mentions titles. | ✅ op + tool-mapping tests |
| Example | `examples/20-titles` — title card (fade) + sliding lower-third + caption + credit. In showreel + `pnpm example:titles`. | ✅ |

Gate at pause: determinism lint clean (7 runtime pkgs incl. `text`), all 32 projects typecheck,
**101 tests** pass, existing golden renders unchanged.

## API quick reference

```ts
scene({ duration: 120, width: 1280, height: 720 })
  .title("t", "vsim", { size: 150, endFrame: 55 })                 // centered, fades in→hold→out
  .text("cap", "Lower third", { x: 0.05, y: 0.84, align: "left",
        box: { color: [0.04,0.05,0.09], opacity: 0.62 } })          // caption with a box
  .animateOverlay("cap", "x", [{frame:58,value:-0.4},{frame:70,value:0.05,easing:"easeOut"}]); // slide in
```

- Position is **normalized [0..1]**, origin top-left; `align` anchors horizontally, `y` is the line's
  vertical center. `size` is output pixels. `color` is linear RGB.
- AI: *"add a title 'Welcome' that fades in"* → `add_text` + `add_animation(overlayId)`.

## Architecture notes (so the split makes sense)

- **`@vsim/text` has two entries.** `.` is **browser-safe** (no `node:fs`; named opentype imports so
  it bundles for the web; caller provides the font via `setFont`). `@vsim/text/node` reads the bundled
  `.ttf` and registers it automatically. `engine-software` + `cycles-overlay` use `/node`; the Studio
  fetches the bundled `.ttf` (`?url`) and calls `setFont`.
- **One compositor, three outputs.** Draft and photoreal share `compositeOverlays` (engine-software).
  The live preview re-implements the *same* normalized layout + gamma in `player/overlay-canvas.ts`
  (`overlayDraw` is the pure, unit-tested core); it draws to a 2D canvas instead of a framebuffer.
- **`FrameState.overlays`** is the single resolved-per-frame source all three read.

## Honesty / known gaps

- **Live preview is unverified visually here** — no WebGL/DOM in the sandbox. What *is* proven: the
  Vite production build succeeds (font asset emitted, no node builtins in the browser bundle), and the
  pure `overlayDraw` layout/tint math is tested and mirrors the verified software compositor. First
  real check = open `pnpm studio`. If a title is offset, suspect the CSS stack
  (`#stage` relative wrapper / `#preview-overlay` `inset:0`), a quick fix.
- **Vertical centering uses the tight glyph bbox**, so a string's ascenders/descenders shift its
  visual center slightly; fine for single-line titles. If multi-line / baseline-stable layout is
  wanted later, have `rasterizeText` also return font ascent/descent and position by baseline.
- **Single line only** — no wrapping, no multi-line, no per-run styling. Newlines aren't handled.
- **opentype.js 1.3.5** is deprecated but used only for outline extraction (deterministic); pinned.

## If resuming — likely next steps

1. **Eyeball the Studio preview** (`pnpm studio`) and fix any overlay-canvas alignment.
2. **Studio authoring UI for text** — an inspector panel to add/edit overlays (currently only via
   code or the AI prompt). The schema + AI ops already exist; this is just UI.
3. Multi-line / word-wrap + baseline-stable vertical alignment.
4. Font choice (bundle a second family, or `setFont` a user font) and per-overlay font selection.
5. More animation presets (typewriter reveal, per-character stagger).

## Key files

```
packages/text/                         new package (rasterizer + bundled font)
  src/index.ts        browser-safe core: rasterizeText / measureText / setFont / hasFont
  src/node.ts         node entry: auto-loads the bundled font
  fonts/DejaVuSans-Bold.ttf (+ LICENSE-DejaVu.txt)
packages/core/src/document.ts          TextOverlaySchema, doc.overlays, track.overlayId
packages/core/src/{runtime,engine}.ts  overlay resolution + FrameState.overlays
packages/engine-software/src/overlay.ts compositeOverlays (draft + photoreal share this)
packages/player/src/overlay-canvas.ts  overlayDraw (pure) + paintOverlays (browser 2D)
apps/studio/cycles-overlay.ts          composites overlays onto Cycles PNGs
apps/studio/{index.html,src/main.ts}   stacked overlay canvas + font load
packages/ai/src/{operations,tools}.ts  add_text / remove_text / overlayId
examples/20-titles/scene.ts            the demo
```
```bash
pnpm example:titles   # → out/titles.mp4
```
