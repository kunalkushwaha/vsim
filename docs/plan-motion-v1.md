# Plan — motion/ v1: explainer kit + deterministic recorder (proving ground #1)

> **STATUS: SHIPPED** (PRs #36–#40). M1 scaffold + M2 recorder + M3 kit + M4 film + M5
> integration all merged; `pnpm film:webreq` renders the 60-second explainer to MP4
> (1801 frames in ~90 s). One refinement vs. this plan: the package lives at
> `packages/motion` so vitest/workspace tooling covers it for free. Hard-won lesson now
> documented in the film source: cue discipline (reset-cue-first, guarded state flips,
> window-silent fade-outs, one owner per attribute) and `window.__recording` to suppress
> ambient autoplay under the recorder.

> Concrete implementation plan for the first proving ground of
> `plan-svg-animation-studio.md`: a token-governed SVG explainer kit, a deterministic
> HTML→MP4 recorder, and a complete agent-produced film — "How a web request works".

## Decisions (locked for v1)

- **Home**: a new top-level `motion/` workspace package (`@vsim/motion`). It shares the
  repo's values (determinism, tests, showreel) but none of the 3D engine's code — the 2D
  studio must stand alone in a browser tab.
- **No animation framework.** v1 ships a tiny **seekable timeline** of our own
  (`timeline.ts`: keyframes + named ease presets, `seek(frame)` pure function of frame
  index). Rationale: the recorder's determinism contract *is* seek-purity; owning ~150
  lines beats auditing a dependency for wall-clock leaks. anime.js/Theatre.js can be
  adopted later behind the same seek contract.
- **Ease presets only**: `snappy | floaty | heavy | mechanical | overshoot` — cubic-bezier +
  baked follow-through. No linear tween exported from the lib.
- **Tokens**: `motion/tokens.json` (palette ramps, stroke scale, radius scale, type scale)
  → generated `tokens.css` custom properties. Lint: assets reference tokens, never raw hex.
- **The camera is the viewBox**: a `camera()` helper tweens the root `viewBox` (4 numbers).
- **Recorder contract**: the film page exposes `window.__film = { fps, frames, seek(f) }`;
  `record.mjs` (Playwright + bundled Chromium + ffmpeg) frame-steps `seek(f)` →
  screenshot → MP4. Same DOM + same frame ⇒ same pixels; a determinism test hashes
  sampled frames across two runs.
- **Narration v1**: caption track from `screenplay.json` (karaoke-style highlight); real
  TTS (Piper) + forced alignment is a stretch goal, the data shape is ready for it.

## Milestones (each = implement → test → review → PR → merge)

**M1 — scaffold + timeline + tokens**
`motion/` package: `tokens.json` → `tokens.css` generator, `lib/ease.ts` presets,
`lib/timeline.ts` (seekable, frame-pure, unit-tested), `lib/camera.ts` viewBox tween,
harness page proving seek-purity in a browser.

**M2 — deterministic recorder**
`record.mjs`: launches bundled Chromium, frame-steps `window.__film.seek(f)`, screenshots
→ ffmpeg → MP4. `--frames a..b`, `--out`. Test: record a 30-frame harness clip twice,
assert byte-identical frame hashes (goldens for web animation).

**M3 — explainer kit v1 (12 primitives + contact sheet)**
SVG `<symbol>` library + tiny JS state APIs, all token-styled: browser window, server,
database, queue, cloud, **packet dots along a `<path>`**, draw-on arrow, code block
(typing + line highlight), callout, step chip, bar/line chart, camera helper. Each has
idle/active/error states and a loop preview on `kit/preview.html` (the contact sheet).

**M4 — the film: "How a web request works" (~60 s)**
`films/web-request/`: `screenplay.json` (6 beats: URL typed → DNS → TCP/TLS → request →
server+db → response render), scenes built from the kit, one master timeline, captions,
viewBox camera moves. Rendered in-env by M2 to `out/web-request.mp4`.

**M5 — integration + docs**
README section + docs page for `motion/`, showreel-adjacent script (`pnpm film:webreq`),
roadmap STATUS entry, lint wiring (tokens-only colors), CI test inclusion.

## Definition of done (v1)

A fresh clone runs `pnpm film:webreq` and gets a byte-reproducible 60-second explainer
MP4 authored entirely from SVG/CSS/TS — no GPU, no external services — with the kit's
contact sheet reviewable in a browser and every library piece unit-tested.
