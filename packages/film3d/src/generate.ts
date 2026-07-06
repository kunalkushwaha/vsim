// The 3D film director: prompt → Film3DDoc via the `claude` CLI in headless print mode,
// with ONE retry that quotes the validator's messages back — the same loop that made the
// 2D generator land valid screenplays on the first or second attempt. The AI only ever
// authors the document; the compiler and renderer never see the model.
import { spawn } from "node:child_process";
import { CHARACTERS, CHARACTER_IDS, parseFilm3D, type Film3DDoc } from "./schema.js";

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
    { "kind": "campfire", "id", "x", "z" }                   // a full lit fire: stones, logs, flames, sparks, warm light
  ],
  "actors": [                                                // ≤3
    { "id", "character": one of the list below, "x", "z", "facing": [x, z] (optional point to face) }
  ],
  "beats": [                                                 // contiguous: each start == previous end; total ≤45s
    { "id", "start", "end", "caption": string ≤110 (optional, one sentence of story),
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
- Compose in depth: put trees BEHIND the action (more negative z if the camera angle is near 0°), rocks near the path. 5–10 props is plenty.
- Captions are narration, not stage directions: "Something in the grass makes it stop." not "The fox plays Survey."
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

/** Extract a JSON object from model text, tolerating ```json fences or surrounding prose. */
function extractJson(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new Error(`expected a JSON object, got: ${text.slice(0, 200)}`);
  }
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
