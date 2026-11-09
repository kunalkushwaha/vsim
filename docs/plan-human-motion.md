# Plan — human motion v2: people who walk, talk and gesture believably

> North star: short films and explainers are mostly *people doing small things* — walking up,
> talking, pointing at something, nodding, shrugging, sitting down. Today a vsim person has four
> clips (mocap walk; hand-keyed run / idle / wave) and the feet skate.

## Findings (measured, 2026-11-09)
1. **Facing**: humans and fox walked sideways in every film (manifest `faces` wrong) — fixed
   separately in PR #138 (`fix/character-facing`) with a skeleton-measured regression test.
2. **Foot skate**: clips play at a fixed rate whatever the travel speed. Mocap walk's natural
   ground speed ≈ 1.22 m/s; a film moving the actor at 0.87 m/s skates ~30%.
3. **Run is broken**: the hand-keyed run's planted foot doesn't travel backward (measured
   natural speed ≈ −0.2 m/s) — it reads as jogging in place / floating.
4. **Idle** is a held A-pose with arms out — mannequin-like; **wave** is the only gesture.

## Status
- **B (clip library) — done.** Pipeline: `scripts/blender/mocap/clips.json` (trials + windows) →
  `fetch-cmu.sh` (pinned commit) → `retarget-clips.py` (Blender: world-space rotation deltas,
  heading normalised, loop point search) → `scripts/mocap-merge.mjs` (Node: joint-local channels
  against each GLB's own rest pose, per-body hip scaling, **ground lock**, in-place animation
  replacement + compaction — re-running is byte-identical). All five MakeHuman bodies gain
  run (new, mocap), idle (new: an attentive listener), wait, talk, sit_down, sit, stand_up, pick_up.
- Lessons (each caught by a test or a render, each fixed):
  - CMU subjects face any direction per trial (heading fixes −95°…+177°) → normalise heading.
  - Hip height from the mocap floor is unreliable across subjects → FK ground lock per frame.
  - Loop seams: search start AND end for a pose+velocity match; glTF loops wrap AT the duration,
    so the last key must repeat the first pose (else the blended pre-start pose is never shown).
  - Animation ORDER is API (`character()` with no clip plays `animations[0]`) → replace in place.
  - Clip durations arrive as 115.99999 frames → round, don't floor.
- A (stride matching), C (Film3D) — next.

## Design
### A. Stride-matched gaits (engine-agnostic, all characters)
- `CHARACTERS[id].walk/run` gain `stride` — the clip's natural ground speed in units/s (at the
  character's film scale), measured from the rig: planted-foot velocity relative to the root.
- compile: playback `speed = clamp(travel / stride, 0.6, 1.7)`; outside that range switch gait
  (walk↔run) instead of skating. A test re-measures every stride from the rig (no hand numbers).
### B. Mocap clip library for the MakeHuman cast (CMU, free for all uses)
- Retarget a curated set of CMU BVH trials with the existing `make-human.py` retargeter
  (generalised to N clips): walk (keep), **run**, **idle (weight shift, breathing)**, **talk**
  (conversational hand gestures), **point**, **nod**, **shrug**, **wave**, **sit down / sit
  idle / stand up**, **pick up**, **look around**, **clap**. Cyclic clips get loop-blended ends;
  one-shots are flagged `once` so the compiler doesn't loop them.
- Clips are in-place (root translation stripped), same rig → every MakeHuman character (human,
  man, kid, suited, speaker) gets the whole library.
### C. Film3D
- `play` accepts the new clips; one-shot clips hold their last pose until the next action;
  copilot prompt lists them with when to use each (talk while narrating, point at a prop, …).
- Cast the other MakeHuman humans (woman, man, kid) — not just `suited`.

## Tests
- stride measured == table (per character, tolerance); compile picks speed within clamp.
- every library clip present on every MakeHuman rig; in-place (root drift < 2 cm/cycle);
  loop clips: first/last pose match; foot-skate metric during walk/run below threshold.
- e2e: a neutral demo ("two people meet in a park, one points the way") rendered; contact sheet.

## Out of scope
Facial animation beyond the existing mouth morph; hand-object attachment (holding props);
IK foot planting on uneven ground.
