# film3d — AI-directed 3D films (prompt → Film3DDoc → SceneDocument → MP4)

**STATUS: SHIPPED (v1)** — `@vsim/film3d` (schema + sets + compiler + generator),
`vsim film -p "<story>" --template 3d`, `vsim render <file>.film3d.json`,
`films/fox-day.film3d.json` (hand-written vocabulary proof) and
`films/snowy-park.film3d.json` (AI-directed, valid on the first attempt).

**v2 SHIPPED — narration + the director's review loop.** Beats carry an optional
`narration` line; `narrationScript(doc)` plans the timed lines and the CLI voices them
through the shared 2D pipeline (`packages/motion/tools/narrate.mjs`, espeak-ng) and muxes
the WAV into the MP4 (`-shortest` clips any tail). Both v1 non-goals that pointed here are
now done: narration is shared, and the generator closes the render–look–revise loop —
`vsim film --template 3d` renders one still per camera shot (`pickReviewStills`), the
model reads its own frames and replies KEEP or a revised document (`reviewFilm3D`), every
revision re-validated so a bad revision can never replace a working film (`--review N`,
default 1). Lip-sync remains out (no viseme assets on the creature rigs).

**v2.1 — photoreal masters.** `apps/studio/cycles-render.mjs` accepts `*.film3d.json`
directly (shared `isFilm3D`/`film3dToScene` sniff from `@vsim/film3d`), plus `--from/--to`
frame ranges (the baker warm-steps stateful animation through skipped frames) and
`--audio` muxing offset to film time (exact-rational frame rate, audio apad-ed so a short
narration never truncates video). Cycles fixes for the film3d sets: strongly emissive
meshes (flames) no longer shadow their own point light, and world/sun energy floors now
follow the set's own hemisphere level so dusk/night stay art-directed dark. The sky gradient + sun disc and linear fog now translate to Cycles (world shader
behind a Light Path split; depth-masked compositor fog). Particles (sparks/smoke) now bake per frame
and render as emissive transparent-mixed spheres — the Cycles translation is complete.

**v2.2 — the animal cast.** `scripts/blender/make-animal.py` generalizes the quadruped
generator into a per-species table (bones, parts, gait parameters): deer (long legs,
antlers), bear (bulk + shoulder hump), rabbit (tall ears, quick gait), each with
walk/run + a breathing idle clip — vsim's own MIT assets, no licensing bookkeeping,
regenerable headlessly. Castable set is now fox, dog, deer, bear, rabbit, suited.
Add a species by adding a table.

**v2.3 — set dressing.** Six new prop kinds — `bush`, `flowers`, `stump`, `log`, `pond`,
`lantern` — all deterministic geometry (golden-angle scatter, no RNG) colored from the
set's palette (`SetLook` gains `water` + `bloom`). The lantern is a real staging light
(warm decay-2 point). Prop placement is consolidated into one exhaustiveness-checked
`placeProp()` dispatch; authored ids may no longer contain `__` (reserved for generated
child nodes). The director's prompt now tells the model to dress sets like locations.

**v3 — the living stage (PRs #59–#74).** The stage itself now moves and reads:
- **Animated textures** — mesh `textureFrames[]` + a `"texture.frame"` track (core channel,
  PR #59); the `screen` prop plays baked HTML frame sequences on a kiosk (#60), the
  animated surfaces are AI-designable under a strict lint (`vsim surface --anim`, #63),
  and Cycles masters play them too (per-frame bake selection, #69).
- **A real village** — `building` (hut/tavern/windmill/well/tower) and `clutter` props from
  bundled CC0 KayKit models (#61); the windmill's blades turn (sub-node extraction + a
  rotation track, #65).
- **Weather** — one screenplay field stages deterministic snowfall/rain/fireflies/leaves,
  pre-warmed so the sky is full from frame 0 (#72, tuned #74).
- **A colored cast** — CreatureDoc parts take per-part colors baked to a palette texture
  (barn owl #66/#67, wolf #68, the built-in deer/bear/rabbit #70); species read by coat,
  not just silhouette.
- Showcase screenplays, all AI-directed: `village-dusk` (#62), `tavern-night` (#64),
  `first-snow` (#73). The mux `-shortest` bug (short narration truncating renders with
  EPIPE) was found and fixed by the village film (#62).

**v3.1 — cinematic polish (PRs #76–#84).** Time, light, and sound joined the vocabulary:
- **Animated environment** — sky/fog/background are per-frame animation targets
  (`animateEnv`, `light.intensity` channel); the screenplay `transition` field lerps the
  whole look to another set's mid-film, sun disc and set lights included (#76;
  `sunset-meadow` #77, `examples/26-sunset` #81).
- **Rain falls in streaks** — velocity-stretched particles (`ParticlesSchema.streak`, #79;
  `rainy-dusk` #80).
- **Bloom** — opt-in glow around bright linear pixels, band-safe and byte-identical when
  tiled; dusk/night sets opt in as `glow` (#82).
- **Ambience** — one field synthesizes a seeded, deterministic ffmpeg noise bed (rain /
  wind / fire) for the film's duration and mixes it under the narration (#84).

The 2D path proved the shape: `vsim film -p "<topic>"` asks the AI for a *validated
document*, and a deterministic interpreter renders it (`packages/motion`, FilmDoc).
This plan applies the same shape to the real 3D engine.

## Why this works with almost no new machinery

The hard half already exists on the 3D side:

- **The validated document** — SceneDocument (zod) is already the render contract.
- **The interpreter** — the whole render pipeline (`SceneRuntime` → software engine →
  ffmpeg) already turns documents into byte-reproducible MP4s.
- **The vocabulary** — `@vsim/authoring` has sets-worth of primitives (sky, fog, trees,
  rocks, grass, orbit cameras, shots, title overlays), and `@vsim/assets` bundles a
  character library with per-character clips and placement metadata.

What's missing is the same thing FilmDoc solved for 2D: **altitude**. Raw SceneDocument
is too low-level for an LLM to author a good film (meshes, quaternions, keyframes).
The fix: a small high-level document — **Film3DDoc** — that a compiler lowers to a
SceneDocument.

## The document (Film3DDoc, `film3d-1`)

```jsonc
{
  "version": "film3d-1",
  "title": "A Fox at Golden Hour",
  "fps": 30,
  "set": "meadow",                      // meadow | dusk | night | snow | studio
  "props": [
    { "kind": "tree", "id": "t1", "x": -5, "z": -6, "height": 3.2 },
    { "kind": "campfire", "id": "fire", "x": 0, "z": 0 }
  ],
  "actors": [
    { "id": "fox", "character": "fox", "x": 3, "z": -1 }   // fox | dog | human | man | kid | suited
  ],
  "beats": [                            // contiguous, like FilmDoc
    { "id": "b1", "start": 0, "end": 6, "caption": "…",
      "actions": [
        { "do": "move", "actor": "fox", "to": [-3, 0.5], "at": 0.5, "dur": 4 },
        { "do": "play", "actor": "fox", "clip": "Survey", "at": 4.5, "dur": 1.5 }
      ] }
  ],
  "camera": [                           // contiguous shot list (cuts), auto-wide if empty
    { "at": 0, "dur": 6, "shot": "follow", "target": "fox", "distance": 5, "height": 1.4 }
  ]
}
```

Guard rails mirror FilmDoc's superRefine: unique ids, id regex, contiguous beats and
camera segments, per-character **clip validation** (an actor can only `play` clips its
rig actually has), action targets must exist, world coordinates clamped, total length
capped. The model can propose a bad film; it cannot emit an invalid one.

## The compiler (`compileFilm3D`)

`Film3DDoc → SceneDocument`, via SceneBuilder:

- **Set presets** are art-directed looks lifted from the strongest example scenes:
  `meadow` = the fox golden hour (06), `dusk` = the campfire night (24, ACES),
  plus `night`, `snow`, `studio`.
- **Props**: builder trees/rocks, plus a ported **campfire set piece** (stone ring,
  log teepee, flickering emissive flame tongues, sparks/smoke particles, an
  inverse-square point light that breathes).
- **Actors**: `loadCharacter()` rigs. The compiler tracks each actor's (x, z, heading)
  through the beat list: `move` becomes position keyframes + a turn toward the travel
  direction (using the manifest's `faces` axis) + gait clips (walk/run chosen by speed,
  crossfaded via `playClip`), settling back to an idle clip.
- **Camera**: shot kinds `wide` / `close` / `follow` / `orbit` compile to named cameras +
  `shot()` cuts; `follow` samples the target actor's path; `orbit` uses the builder's
  orbit preset.
- **Captions/title**: beat captions become fading text overlays; the film title is an
  opening card.

Deterministic by construction — the compiler is a pure function of the document (asset
bytes are committed), and the render pipeline's guarantees do the rest.

## Stages

1. **Schema + sets + compiler + tests** (`packages/film3d`), and `vsim render` accepts
   `*.film3d.json` directly (version-sniffed in `loadScene`).
2. **Hand-written demo film** (`films/fox-meadow.film3d.json`) → refine loop → committed
   as the vocabulary proof.
3. **Generator**: `vsim film -p "<story>" --template 3d` — same headless `claude -p`
   runner and validate-retry loop as the 2D generator, with a 3D-specific prompt
   (vocabulary + craft rules: shot variety, move-then-rest rhythm, prop layouts).
4. **Showcase**: an AI-directed fox film in the README next to the 2D CDN film.

## Non-goals (v1)

- No three.js-in-browser recording (GPU rasterization breaks byte-reproducibility; the
  software engine already does real 3D deterministically).
- No free-form geometry from the AI — only the kit vocabulary.
- No narration in v1 (the 2D narration pipeline can be shared later).
