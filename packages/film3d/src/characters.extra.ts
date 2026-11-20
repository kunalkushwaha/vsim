// AI-AUTHORED CAST — GENERATED FILE, appended by `vsim creature` (see creature.ts).
// Each entry was designed as a validated CreatureDoc (committed in creatures/), compiled by
// scripts/blender/make-animal.py, turntable-reviewed by the designer, and registered here.
// vsim's own MIT assets. Hand-edit freely; the tool only ever appends before the closing brace.
export const EXTRA_CHARACTERS = {
  wolf: {
    clips: ["walk", "run", "idle"],
    idle: { clip: "idle" },
    walk: { clip: "walk", stride: 0.74 },
    run: { clip: "run", stride: 1.03 },
    faces: [0, -1] as const,
    scale: 1,
    runAt: 3.8,
    eye: 0.65,
  },
  barnowl: {
    clips: ["walk", "run", "idle"],
    idle: { clip: "idle" },
    walk: { clip: "walk", stride: 0.35 },
    run: { clip: "run", stride: 0.49 },
    faces: [0, -1] as const,
    scale: 0.8,
    runAt: 1.2,
    eye: 0.6,
  },
  redsquirrel: {
    clips: ["walk", "run", "idle"],
    idle: { clip: "idle" },
    walk: { clip: "walk", stride: 0.25 },
    run: { clip: "run", stride: 0.38 },
    faces: [0, -1] as const,
    scale: 1,
    runAt: 3.5,
    eye: 0.22,
  },
} as const;
