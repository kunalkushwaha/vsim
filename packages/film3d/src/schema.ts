// Film3DDoc — a 3D film as a validated DOCUMENT, the same shape that made the 2D path
// work (packages/motion FilmDoc): the AI authors data at story altitude — sets, actors,
// beats, shots — zod rejects anything malformed, and a compiler lowers it to a plain
// SceneDocument for the existing deterministic render pipeline. The model can suggest a
// bad film; it cannot emit an invalid one, and it never touches geometry or keyframes.
import { z } from "zod";
import { EXTRA_CHARACTERS } from "./characters.extra.js";
import { SURFACE_NAMES, CUTOUT_NAMES, SCREEN_NAMES } from "./surfaces.js";

/**
 * The castable characters — a curated subset of `@vsim/assets`' bundled library, with the
 * story-level clip vocabulary the compiler maps onto real rig clips. Only clothed/creature
 * rigs are castable (the bare MakeHuman bodies read wrong in close-ups). Duplicated from
 * `library/manifest.json` ON PURPOSE: the schema must validate synchronously (and without
 * file access), so this table is the contract — a test asserts it stays in sync with the
 * manifest.
 */
/** KayKit Adventurers share one rig + animation library (CC0; see library CREDITS). */
const ADVENTURER = {
  clips: ["Idle", "Walking_A", "Running_A", "Cheer", "Interact", "PickUp", "Sit_Floor_Idle", "Lie_Down", "Spellcasting", "Jump_Full_Short"],
  idle: { clip: "Idle" },
  walk: { clip: "Walking_A" },
  run: { clip: "Running_A" },
  faces: [0, 1] as const,
  scale: 1,
  runAt: 2.4,
  eye: 1.05,
} as const;

export const CHARACTERS = {
  fox: {
    clips: ["Walk", "Run", "Survey"],
    idle: { clip: "Survey" },
    walk: { clip: "Walk" },
    run: { clip: "Run" },
    /** World-axis the rig faces at rotation 0 (from the manifest). */
    faces: [-1, 0] as const,
    /** Extra uniform scale on top of the manifest's normalization (a fox is small). */
    scale: 0.66,
    /** Comfortable travel speed in units/s per gait — used to pick walk vs run. */
    runAt: 2.2,
    /** Camera aim height (world units, after scaling) — roughly the head. */
    eye: 0.65,
    /** Flat material override for untextured rigs (the fox/dog samples render gray otherwise). */
    tint: [0.78, 0.42, 0.18] as const,
  },
  dog: {
    clips: ["walk", "trot"],
    idle: { clip: "walk", speed: 0.18 }, // no idle clip — a slow shuffle reads as resting
    walk: { clip: "walk" },
    run: { clip: "trot" },
    faces: [0, -1] as const,
    scale: 1,
    runAt: 2.0,
    eye: 0.6,
    tint: [0.62, 0.52, 0.4] as const,
  },
  suited: {
    clips: ["walk", "run", "idle", "wave"],
    idle: { clip: "idle" },
    walk: { clip: "walk" },
    run: { clip: "run" },
    faces: [1, 0] as const,
    scale: 1,
    runAt: 2.4,
    eye: 1.45,
  },
  deer: {
    clips: ["walk", "run", "idle"],
    idle: { clip: "idle" },
    walk: { clip: "walk" },
    run: { clip: "run" },
    faces: [0, -1] as const,
    scale: 1,
    runAt: 2.8,
    eye: 1.28,
  },
  bear: {
    clips: ["walk", "run", "idle"],
    idle: { clip: "idle" },
    walk: { clip: "walk" },
    run: { clip: "run" },
    faces: [0, -1] as const,
    scale: 1.1,
    runAt: 2.0,
    eye: 0.88,
  },
  rabbit: {
    clips: ["walk", "run", "idle"],
    idle: { clip: "idle" },
    walk: { clip: "walk" },
    run: { clip: "run" },
    faces: [0, -1] as const,
    scale: 0.9,
    runAt: 1.5,
    eye: 0.34,
  },
  knight: ADVENTURER,
  barbarian: ADVENTURER,
  mage: ADVENTURER,
  rogue: ADVENTURER,
  ...EXTRA_CHARACTERS,
} as const;

export type CharacterId = keyof typeof CHARACTERS;
export const CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[];

/** World-coordinate guard rails: the film plays out on a ±14-unit ground plane. */
const coord = z.number().min(-14).max(14);
/** No "__": the compiler namespaces every generated child node as `<id>__<part>` (and set
 * pieces as `__<name>`), so a user id containing "__" could collide with a generated node. */
const ID_RE = /^[a-zA-Z](?!.*__)[\w-]*$/;

export const PropSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tree"), id: z.string(), x: coord, z: coord, height: z.number().min(1).max(6).default(3), variant: z.enum(["conifer", "broadleaf"]).default("conifer") }),
  z.object({ kind: z.literal("rock"), id: z.string(), x: coord, z: coord, radius: z.number().min(0.1).max(1.5).default(0.4) }),
  z.object({ kind: z.literal("campfire"), id: z.string(), x: coord, z: coord }),
  // Set dressing (all deterministic geometry, colored from the set's palette):
  z.object({ kind: z.literal("bush"), id: z.string(), x: coord, z: coord, radius: z.number().min(0.3).max(1.5).default(0.6) }),
  z.object({ kind: z.literal("flowers"), id: z.string(), x: coord, z: coord, radius: z.number().min(0.3).max(2).default(0.8) }),
  z.object({ kind: z.literal("stump"), id: z.string(), x: coord, z: coord, radius: z.number().min(0.15).max(0.5).default(0.25) }),
  z.object({ kind: z.literal("log"), id: z.string(), x: coord, z: coord, length: z.number().min(0.8).max(3).default(1.6), /** Yaw in degrees. */ angle: z.number().default(0) }),
  z.object({ kind: z.literal("pond"), id: z.string(), x: coord, z: coord, radius: z.number().min(0.8).max(4).default(1.8) }),
  z.object({ kind: z.literal("lantern"), id: z.string(), x: coord, z: coord }),
  // Baked-artifact props (docs/plan-surface-pack.md): art names come from the surface
  // library's generated tables so validation stays synchronous.
  z.object({ kind: z.literal("sign"), id: z.string(), x: coord, z: coord, art: z.enum(SURFACE_NAMES as unknown as [string, ...string[]]), /** Yaw in degrees. */ angle: z.number().default(0) }),
  z.object({ kind: z.literal("cutout"), id: z.string(), x: coord, z: coord, art: z.enum(CUTOUT_NAMES as unknown as [string, ...string[]]), height: z.number().min(0.5).max(4).default(1.5), depth: z.number().min(0).max(0.5).default(0.1), angle: z.number().default(0) }),
  z.object({ kind: z.literal("screen"), id: z.string(), x: coord, z: coord, art: z.enum(SCREEN_NAMES as unknown as [string, ...string[]]), /** Yaw in degrees. */ angle: z.number().default(0) }),
  // Bundled CC0 model props (KayKit Medieval Hexagon; scripts/bundle-medieval.mjs):
  z.object({ kind: z.literal("building"), id: z.string(), x: coord, z: coord, variant: z.enum(["hut", "tavern", "windmill", "well", "tower"]).default("hut"), angle: z.number().default(0) }),
  z.object({ kind: z.literal("clutter"), id: z.string(), x: coord, z: coord, variant: z.enum(["barrel", "crate", "tent", "wheelbarrow", "sack"]).default("barrel"), angle: z.number().default(0) }),
]);

export const ActorSchema = z.object({
  id: z.string(),
  character: z.enum(CHARACTER_IDS as [CharacterId, ...CharacterId[]]),
  x: coord,
  z: coord,
  /** Point the actor initially faces toward (defaults to the world origin). */
  facing: z.tuple([coord, coord]).optional(),
});

export const Film3DActionSchema = z.discriminatedUnion("do", [
  z.object({
    do: z.literal("move"),
    actor: z.string(),
    to: z.tuple([coord, coord]),
    /** Start in seconds RELATIVE to the beat's start (like FilmDoc actions). */
    at: z.number().min(0),
    dur: z.number().positive(),
    /** Omit to auto-pick by speed (distance / dur). */
    gait: z.enum(["walk", "run"]).optional(),
  }),
  z.object({
    do: z.literal("play"),
    actor: z.string(),
    /** A clip the actor's rig really has — validated against CHARACTERS in superRefine. */
    clip: z.string(),
    at: z.number().min(0),
    dur: z.number().positive().default(2),
  }),
  z.object({
    do: z.literal("face"),
    actor: z.string(),
    /** Turn to face this world point. */
    to: z.tuple([coord, coord]),
    at: z.number().min(0),
    dur: z.number().positive().default(0.6),
  }),
]);

export const Film3DBeatSchema = z.object({
  id: z.string(),
  start: z.number().min(0),
  end: z.number().positive(),
  caption: z.string().max(110).optional(),
  /** Spoken voice-over line, read by the narrator at the beat's start (captions stay on screen). */
  narration: z.string().max(200).optional(),
  actions: z.array(Film3DActionSchema).default([]),
});

export const ShotSchema = z.object({
  at: z.number().min(0),
  dur: z.number().positive(),
  shot: z.enum(["wide", "close", "follow", "orbit"]),
  /** An actor id, or a world point [x, y, z]. Defaults to the first actor (or the origin). */
  target: z.union([z.string(), z.tuple([z.number(), z.number(), z.number()])]).optional(),
  /** Camera distance from the target (defaults per shot kind). */
  distance: z.number().min(1).max(30).optional(),
  height: z.number().min(0.2).max(15).optional(),
  /** Azimuth in degrees around the target: 0 puts the camera at +z looking back. */
  angle: z.number().default(0),
  /** Orbit only: degrees swept over the segment (default 90; negative = clockwise). */
  sweep: z.number().min(-360).max(360).default(90),
  fov: z.number().min(20).max(90).optional(),
});

export const Film3DDocSchema = z
  .object({
    version: z.literal("film3d-1").default("film3d-1"),
    fps: z.number().int().min(12).max(60).default(30),
    title: z.string().max(60),
    /** Art-directed look preset — sky, fog, lights, ground palette, tone mapping. */
    set: z.enum(["meadow", "dusk", "night", "snow", "studio", "autumn"]),
    /** Ambient particles across the whole stage and film (deterministic, seeded). */
    weather: z.enum(["snowfall", "rain", "fireflies", "leaves"]).optional(),
    /** Ambient sound bed under the narration — a seeded, deterministic procedural loop. */
    ambience: z.enum(["rain", "wind", "fire"]).optional(),
    /** In-film time-of-day: the sky/fog/background lerp to another set's look over [start, end] seconds. */
    transition: z.object({
      to: z.enum(["meadow", "dusk", "night", "snow", "studio", "autumn"]),
      start: z.number().min(0),
      end: z.number().positive(),
    }).optional(),
    props: z.array(PropSchema).max(24).default([]),
    actors: z.array(ActorSchema).max(3).default([]),
    beats: z.array(Film3DBeatSchema).min(1),
    /** Contiguous shot list (cuts). Empty = one auto wide shot over the whole film. */
    camera: z.array(ShotSchema).default([]),
  })
  .superRefine((doc, ctx) => {
    if (doc.transition) {
      if (doc.transition.end <= doc.transition.start) ctx.addIssue({ code: "custom", message: "transition.end must be after transition.start" });
      if (doc.transition.to === doc.set) ctx.addIssue({ code: "custom", message: "transition.to must differ from the film's set" });
    }
    const ids = new Set<string>();
    const actorChar = new Map<string, CharacterId>();
    for (const e of [...doc.props, ...doc.actors]) {
      if (ids.has(e.id)) ctx.addIssue({ code: "custom", message: `id "${e.id}" is not unique across props + actors` });
      ids.add(e.id);
      if (!ID_RE.test(e.id)) ctx.addIssue({ code: "custom", message: `id "${e.id}" must match [a-zA-Z][\\w-]* and must not contain "__" (reserved for generated nodes)` });
    }
    for (const a of doc.actors) actorChar.set(a.id, a.character);
    if (doc.props.length + doc.actors.length === 0) {
      ctx.addIssue({ code: "custom", message: "the film needs at least one actor or prop" });
    }

    let prevEnd = 0;
    for (const b of doc.beats) {
      if (b.start !== prevEnd) ctx.addIssue({ code: "custom", message: `beat "${b.id}" must start at ${prevEnd}s (beats are contiguous)` });
      if (b.end <= b.start) ctx.addIssue({ code: "custom", message: `beat "${b.id}" must end after it starts` });
      prevEnd = b.end;
      for (const a of b.actions) {
        const char = actorChar.get(a.actor);
        if (!char) {
          ctx.addIssue({ code: "custom", message: `beat "${b.id}": action targets unknown actor "${a.actor}"` });
          continue;
        }
        if (a.do === "play") {
          const clips = CHARACTERS[char].clips as readonly string[];
          if (!clips.includes(a.clip)) {
            ctx.addIssue({ code: "custom", message: `beat "${b.id}": ${char} "${a.actor}" has no clip "${a.clip}" (available: ${clips.join(", ")})` });
          }
        }
        const dur = a.do === "move" ? a.dur : (a.dur ?? 1);
        if (b.start + a.at + dur > b.end + 2) {
          ctx.addIssue({ code: "custom", message: `beat "${b.id}": action ${a.do}@${a.actor} overruns the beat by >2s` });
        }
      }
    }
    if (prevEnd > 90) ctx.addIssue({ code: "custom", message: `the film is ${prevEnd}s — keep it ≤90s` });

    let camEnd = 0;
    for (const [i, s] of doc.camera.entries()) {
      if (s.at !== camEnd) ctx.addIssue({ code: "custom", message: `camera segment ${i} must start at ${camEnd}s (segments are contiguous from 0)` });
      camEnd = s.at + s.dur;
      if (typeof s.target === "string" && !actorChar.has(s.target)) {
        ctx.addIssue({ code: "custom", message: `camera segment ${i}: target "${s.target}" is not an actor id (use an actor id or [x, y, z])` });
      }
      if ((s.shot === "follow" || s.shot === "orbit") && s.target !== undefined && typeof s.target !== "string" && s.shot === "follow") {
        ctx.addIssue({ code: "custom", message: `camera segment ${i}: a follow shot needs an actor target` });
      }
    }
    if (doc.camera.length > 0 && camEnd < prevEnd) {
      ctx.addIssue({ code: "custom", message: `camera segments end at ${camEnd}s but the film runs to ${prevEnd}s — cover the whole film` });
    }
  });

export type Film3DDoc = z.infer<typeof Film3DDocSchema>;
export type Film3DShot = z.infer<typeof ShotSchema>;
export type Film3DProp = z.infer<typeof PropSchema>;

/** Validate a candidate Film3DDoc; returns { doc } or { errors } with agent-readable messages. */
export function parseFilm3D(input: unknown): { doc: Film3DDoc; errors?: undefined } | { doc?: undefined; errors: string[] } {
  const res = Film3DDocSchema.safeParse(input);
  if (res.success) return { doc: res.data };
  return { errors: res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}
