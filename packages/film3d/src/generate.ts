// The 3D film director: prompt → Film3DDoc via the `claude` CLI in headless print mode,
// with ONE retry that quotes the validator's messages back — the same loop that made the
// 2D generator land valid screenplays on the first or second attempt. The AI only ever
// authors the document; the compiler and renderer never see the model.
import { spawn } from "node:child_process";
import { CHARACTERS, CHARACTER_IDS, parseFilm3D, type Film3DDoc } from "./schema.js";
import { SURFACE_NAMES, CUTOUT_NAMES } from "./surfaces.js";
import { extractJson, parseReviewReply, type ReviewStill } from "./review.js";
import { parseCreature, type CreatureDoc } from "./creature.js";
import { parseSurface, SURFACE_FONT, type SurfaceDoc } from "./surface-gen.js";

const CHARACTER_NOTES = CHARACTER_IDS.map((id) => {
  const c = CHARACTERS[id];
  return `- "${id}": clips ${JSON.stringify([...c.clips])}`;
}).join("\n");

const INSTRUCTIONS = `You are the film director for vsim, a deterministic 3D animation engine. Turn the topic into a Film3DDoc — a short 3D film as pure JSON. Reply with ONLY the JSON object, no prose, no code fences.

The world is a 3D ground plane; x/z coordinates in [-14, 14], y is up. The camera sees roughly 10 units of width from the default distances. Schema:

{
  "title": string (≤60 chars),
  "fps": 30,
  "set": "meadow" | "dusk" | "night" | "snow" | "studio",   // meadow = golden hour; dusk pairs with a campfire prop (lit fire, ACES); night = blue moonlight; snow = overcast winter; studio = neutral stage
  "props": [                                                 // ≤24, scatter for depth: trees behind/around the action, rocks near it
    { "kind": "tree", "id", "x", "z", "height": 1..6, "variant": "conifer"|"broadleaf" },
    { "kind": "rock", "id", "x", "z", "radius": 0.1..1.5 },
    { "kind": "campfire", "id", "x", "z" },                  // a full lit fire: stones, logs, flames, sparks, warm light
    { "kind": "bush", "id", "x", "z", "radius": 0.3..1.5 },
    { "kind": "flowers", "id", "x", "z", "radius": 0.3..2 },  // a patch of blossoms in the set's accent colors
    { "kind": "stump", "id", "x", "z", "radius": 0.15..0.5 },
    { "kind": "log", "id", "x", "z", "length": 0.8..3, "angle": yaw degrees },  // fallen trunk — a natural bench/obstacle
    { "kind": "pond", "id", "x", "z", "radius": 0.8..4 },     // still water ringed by shore stones
    { "kind": "lantern", "id", "x", "z" },                    // glowing post light — pools warm light (great at dusk/night)
    { "kind": "sign", "id", "x", "z", "art": one of ${JSON.stringify([...SURFACE_NAMES])}, "angle": yaw degrees },  // a wooden board with real painted artwork
    { "kind": "cutout", "id", "x", "z", "art": one of ${JSON.stringify([...CUTOUT_NAMES])}, "height": 0.5..4, "angle": yaw }  // an extruded silhouette, like stage scenery
  ],
  "actors": [                                                // ≤3
    { "id", "character": one of the list below, "x", "z", "facing": [x, z] (optional point to face) }
  ],
  "beats": [                                                 // contiguous: each start == previous end; total ≤45s
    { "id", "start", "end", "caption": string ≤110 (optional, one sentence of story),
      "narration": string ≤200 (optional, a voice-over line spoken at the beat's start),
      "actions": [
        { "do": "move", "actor", "to": [x, z], "at": secs-into-beat, "dur": secs, "gait": "walk"|"run" (optional) },
        { "do": "play", "actor", "clip": a clip that character HAS, "at", "dur" },
        { "do": "face", "actor", "to": [x, z], "at", "dur" }
      ] }
  ],
  "camera": [                                                // contiguous cuts from 0 covering the whole film
    { "at", "dur", "shot": "wide"|"close"|"follow"|"orbit", "target": actorId | [x,y,z],
      "distance"?, "height"?, "angle": degrees around target (default 0), "sweep": orbit degrees (default 90), "fov"? }
  ]
}

Characters and the clips each rig really has (play only these):
${CHARACTER_NOTES}

Craft rules:
- Three to five beats, 15–40s total. Give the film a tiny arc: arrive → something happens → resolve.
- Rhythm: move, then rest. After each "move", let the actor "play" an idle-ish clip or hold a "face" so the audience can breathe. Actions must fit inside their beat.
- Move at animal/human speed: roughly 1–2 units per second walking, 2–3 running. Don't teleport across the world in one beat.
- Cut the camera with the beats (a new shot per beat reads as film grammar). Vary the shots: a follow for travel, a close for the pause, a wide or orbit for the finale. Orbit sweeps of 40–90° feel cinematic; ±180°+ feels like a video game.
- Compose in depth: put trees BEHIND the action (more negative z if the camera angle is near 0°), rocks near the path. 6–12 props is plenty.
- Dress the set like a location, not a lawn: a pond or fallen log as the scene's landmark, bushes and flowers along the path, a stump or lantern where someone pauses. Give actors somewhere to go TO.
- Captions are narration, not stage directions: "Something in the grass makes it stop." not "The fox plays Survey."
- Narrate the story: give most beats a "narration" line — one warm sentence a nature-documentary narrator would speak (≤20 words; it must fit inside the beat when read aloud). The caption may repeat it, shorten it, or be omitted.
- dusk/night sets are dark: keep the action within ~6 units of a campfire (dusk) or of the origin so it stays lit and inside the fog.`;

function runClaude(prompt: string, model?: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const args = ["-p", "--output-format", "json"];
    if (model) args.push("--model", model);
    const child = spawn("claude", args);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e: NodeJS.ErrnoException) =>
      reject(e.code === "ENOENT" ? new Error("`claude` CLI not found — install Claude Code to use `vsim film`.") : e),
    );
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude exited with code ${code}: ${err.trim()}`));
      try {
        const env = JSON.parse(out);
        if (env.is_error) return reject(new Error(`claude error: ${env.result ?? "unknown"}`));
        resolvePromise(typeof env.result === "string" ? env.result : "");
      } catch {
        reject(new Error(`could not parse claude output: ${out.slice(0, 200)}`));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Ask the AI for a Film3DDoc about `topic`. Invalid documents get ONE retry with the
 * validator's messages quoted back (the errors are written to be agent-readable).
 */
export async function generateFilm3D(
  topic: string,
  opts: { model?: string } = {},
): Promise<{ doc: Film3DDoc; attempts: number }> {
  const first = await runClaude(`${INSTRUCTIONS}\n\nTopic: ${topic}`, opts.model);
  let res = parseFilm3D(extractJson(first));
  if (res.doc) return { doc: res.doc, attempts: 1 };

  const retry = await runClaude(
    `${INSTRUCTIONS}\n\nTopic: ${topic}\n\nYour previous attempt was rejected by the validator:\n${res.errors!.map((e) => `- ${e}`).join("\n")}\n\nPrevious attempt:\n${first}\n\nFix every issue and reply with the corrected JSON only.`,
    opts.model,
  );
  res = parseFilm3D(extractJson(retry));
  if (res.doc) return { doc: res.doc, attempts: 2 };
  throw new Error(`the AI could not produce a valid Film3DDoc:\n  ${res.errors!.join("\n  ")}`);
}

const REVIEW_INSTRUCTIONS = `You directed the film below, and the dailies are in: each listed PNG is a rendered frame from one of your camera shots. Read every image file, look at it hard, then decide.

Judge like a director watching dailies:
- Is the subject actually IN frame, at a good size (not a speck, not clipped)?
- Does the staging read — actor near the interesting props, depth in the composition, not an empty lawn?
- Is the frame too dark or the horizon dead-centered?
- Do the shots vary across the film?

Reply with ONLY one of:
- the single word KEEP if the film holds up as shot
- the complete corrected Film3DDoc JSON (same schema and craft rules as before) with your fixes — move actors/props, re-aim or re-cut cameras, adjust distances/heights/angles. Keep the story; fix the filmmaking.`;

/**
 * The render–look–revise loop's "look": show the model its own rendered stills and let it
 * revise the screenplay. Returns the (validated) revision, or the original with
 * `revised: false` when the model answers KEEP — or when its revision fails validation
 * twice (a bad revision never replaces a working film).
 */
export async function reviewFilm3D(
  doc: Film3DDoc,
  stills: (ReviewStill & { path: string })[],
  opts: { model?: string; previous?: (ReviewStill & { path: string })[] } = {},
): Promise<{ doc: Film3DDoc; revised: boolean }> {
  const frames = stills.map((s) => `- ${s.label}: ${s.path}`).join("\n");
  // Later rounds see the previous dailies too, so the director can check its fix LANDED.
  const before = opts.previous?.length
    ? `\n\nThis is a later review round: the film above already reflects your last revision. The PREVIOUS round's frames, for comparison (did your changes land?):\n${opts.previous.map((s) => `- ${s.label}: ${s.path}`).join("\n")}`
    : "";
  const prompt = `${INSTRUCTIONS}\n\n${REVIEW_INSTRUCTIONS}\n\nThe film:\n${JSON.stringify(doc, null, 2)}\n\nRendered frames (read each file):\n${frames}${before}`;
  const first = parseReviewReply(await runClaude(prompt, opts.model));
  if (first.keep) return { doc, revised: false };
  let res = parseFilm3D(first.candidate);
  if (res.doc) return { doc: res.doc, revised: true };

  const retry = parseReviewReply(
    await runClaude(
      `${prompt}\n\nYour revision was rejected by the validator:\n${res.errors!.map((e) => `- ${e}`).join("\n")}\n\nReply with the corrected JSON only (or KEEP to leave the film as-is).`,
      opts.model,
    ),
  );
  if (retry.keep) return { doc, revised: false };
  res = parseFilm3D(retry.candidate);
  return res.doc ? { doc: res.doc, revised: true } : { doc, revised: false };
}

// ---- CreatureDoc: the same generate → look → revise loop, for ASSETS -----------------------

const CREATURE_INSTRUCTIONS = `You are a character designer for vsim, a deterministic 3D engine. Design a stylised low-poly QUADRUPED as a CreatureDoc — pure JSON, no prose, no fences.

Build space: Blender Z-up, the animal STANDS ON z=0 facing +y (head toward +y). Everything is built from primitives (cube/sphere/cyl are HALF-extent scales) rigidly attached to bones; the whole body gets one subsurf pass, so parts must OVERLAP generously or they detach; very thin parts (<0.02) vanish.

Schema (all numbers bounded; violations are rejected with readable errors):
{
  "id": "wolf",                      // lowercase library id
  "name": "Wolf", "description": one line,
  "bones": [                          // torso chain: hips(root) → spine → neck → head, plus tail; ≤9 total
    { "name", "head": [x,y,z], "tail": [x,y,z], "parent"? } ],
  "legs": { "front_y", "back_y",      // y of front/back leg pairs (near spine ends)
            "sx": half-stance-width, "top": shoulder z, "knee": z, "r_u", "r_l" },  // radii
  "legsBackR"?: thicker haunches radius,
  "parts": [ { "bone", "kind": "cube"|"sphere"|"cyl", "loc": [x,y,z], "scale": [x,y,z] } ],  // 4..24
  "gaits": { "walk": [swing, curl], "run": [swing, curl] },   // radians; curl is negative
  "scale": world scale (≤1.6), "runAt": u/s, "eye": aim height after scale, "tint": [r,g,b] flat color
}

Craft rules:
- SILHOUETTE FIRST: the animal must read from 8 units away. Exaggerate the one or two features that say the species (neck, ears, horns, hump, tail).
- Give it a FACE: a muzzle/beak part on the head, plus small dark parts won't show (flat tint) — shape the head so it reads.
- Parts sit ON bones that exist; leg meshes are automatic from "legs". Keep body parts overlapping by ~30%.
- Proportions: legs.top is the body height; body parts straddle it. Tail flows off the hips. Bones: hips at the rear (-y), head at the front (+y).
- Gaits: heavier animal → smaller swing (0.25) and slower runAt; light/quick → bigger swing (0.5+).`;

/** Ask the AI for a CreatureDoc; one validator-quoting retry (same loop as films). */
export async function generateCreature(
  topic: string,
  opts: { model?: string } = {},
): Promise<{ doc: CreatureDoc; attempts: number }> {
  const first = await runClaude(`${CREATURE_INSTRUCTIONS}\n\nDesign: ${topic}`, opts.model);
  let res = parseCreature(extractJson(first));
  if (res.doc) return { doc: res.doc, attempts: 1 };
  const retry = await runClaude(
    `${CREATURE_INSTRUCTIONS}\n\nDesign: ${topic}\n\nYour previous attempt was rejected:\n${res.errors!.map((e) => `- ${e}`).join("\n")}\n\nPrevious attempt:\n${first}\n\nFix every issue; reply with the corrected JSON only.`,
    opts.model,
  );
  res = parseCreature(extractJson(retry));
  if (res.doc) return { doc: res.doc, attempts: 2 };
  throw new Error(`the AI could not produce a valid CreatureDoc:\n  ${res.errors!.join("\n  ")}`);
}

/** Turntable review: the designer sees its own creature from three angles; KEEP or revise. */
export async function reviewCreature(
  doc: CreatureDoc,
  stills: { label: string; path: string }[],
  opts: { model?: string } = {},
): Promise<{ doc: CreatureDoc; revised: boolean }> {
  const prompt = `${CREATURE_INSTRUCTIONS}\n\nYou designed the creature below; the listed PNGs are turntable renders of the ACTUAL compiled model. Read each image and judge the silhouette like a character designer: do the proportions read? Is anything detached, floating, buried, or missing (a head inside the body, legs through the ground, no face)? Reply with ONLY the word KEEP, or the complete corrected CreatureDoc JSON.\n\nThe creature:\n${JSON.stringify(doc, null, 2)}\n\nRenders (read each file):\n${stills.map((s) => `- ${s.label}: ${s.path}`).join("\n")}`;
  const first = parseReviewReply(await runClaude(prompt, opts.model));
  if (first.keep) return { doc, revised: false };
  const res = parseCreature(first.candidate);
  return res.doc ? { doc: res.doc, revised: true } : { doc, revised: false };
}

// ---- SurfaceDoc: generate → bake → look → revise, for HTML artifacts -----------------------

const SURFACE_INSTRUCTIONS = `You are a graphic designer for vsim's surface library: painted signs, posters, labels, patterns that get baked to textures and staged in 3D films. Design ONE artifact as pure JSON, no prose, no fences:

{ "name": "kebab-case-id", "size": [width, height] (128..1024 each),
  "description": one line, "html": "<!doctype html>..." }

Hard constraints on the html (a strict lint rejects violations):
- Fully self-contained: ONE file, all CSS in a <style> block. No <script>, no <link>, no @import, no external URLs, no media elements. Only data:image/ URIs and the bundled font are allowed as resources.
- Font: @font-face { font-family: X; src: url("${SURFACE_FONT}"); } — this exact path, it is the only font file available.
- The page IS the artwork: html,body { margin:0; width:<W>px; height:<H>px; overflow:hidden } matching "size" exactly.
- No CSS animations/transitions — the bake is one deterministic still.

Craft: design like a print artist — strong silhouette, 2-4 color palette, big type, textures from layered gradients (wood grain, paper, sky). It will be seen from a few meters away in a film, so bold beats intricate.`;

/** Ask the AI for a SurfaceDoc; one lint-quoting retry (same loop as films/creatures). */
export async function generateSurface(
  topic: string,
  opts: { model?: string } = {},
): Promise<{ doc: SurfaceDoc; attempts: number }> {
  const first = await runClaude(`${SURFACE_INSTRUCTIONS}\n\nDesign: ${topic}`, opts.model);
  let res = parseSurface(extractJson(first));
  if (res.doc) return { doc: res.doc, attempts: 1 };
  const retry = await runClaude(
    `${SURFACE_INSTRUCTIONS}\n\nDesign: ${topic}\n\nYour previous attempt was rejected:\n${res.errors!.map((e) => `- ${e}`).join("\n")}\n\nFix every issue; reply with the corrected JSON only.`,
    opts.model,
  );
  res = parseSurface(extractJson(retry));
  if (res.doc) return { doc: res.doc, attempts: 2 };
  throw new Error(`the AI could not produce a valid SurfaceDoc:\n  ${res.errors!.join("\n  ")}`);
}

/** The designer looks at its own bake and may revise the HTML once. */
export async function reviewSurface(
  doc: SurfaceDoc,
  bakePath: string,
  opts: { model?: string } = {},
): Promise<{ doc: SurfaceDoc; revised: boolean }> {
  const prompt = `${SURFACE_INSTRUCTIONS}\n\nYou designed the artifact below; the PNG at ${bakePath} is the ACTUAL bake. Read the image and judge it like a print proof: composition, contrast, type legibility at a glance, anything clipped or overlapping. Reply with ONLY the word KEEP, or the complete corrected SurfaceDoc JSON.\n\nThe artifact:\n${JSON.stringify(doc, null, 2)}`;
  const first = parseReviewReply(await runClaude(prompt, opts.model));
  if (first.keep) return { doc, revised: false };
  const res = parseSurface(first.candidate);
  return res.doc ? { doc: res.doc, revised: true } : { doc, revised: false };
}
