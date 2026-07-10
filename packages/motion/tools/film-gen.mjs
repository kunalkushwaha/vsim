// Prompt → film: the AI writes a FilmDoc (data), zod validates it, the explainer template
// interprets it, the recorder renders it. `vsim film -p "explain http caching"` end to end.
//
//   node packages/motion/tools/film-gen.mjs "<topic prompt>" [--name slug] [--record]
//        [--duration 45] [--model id] [--out out/<name>.mp4]
//
// The model runs at AUTHORING time only (via the `claude` CLI in headless print mode — a
// Claude Code login; same pattern as @vsim/ai). Invalid documents are rejected by the schema
// and retried once with the validation errors quoted back. The committed filmdoc.json is the
// deterministic artifact: re-rendering it needs no AI and produces identical bytes.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFilmDoc, ACTION_KINDS } from "../src/filmdoc.mjs";
import { buildFilm } from "../build-film.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));

const INSTRUCTIONS = `You are the screenwriter for vsim motion/ — a deterministic SVG animation studio. Turn the topic into a FilmDoc: a short technical explainer film as PURE JSON (no prose, no markdown fences — output ONLY the JSON object).

THE STAGE is 1280 wide x 600 tall (y grows downward). Compose left→right in reading order; keep entities inside x 60..1220, y 40..560; leave the bottom ~40px clear of small text (captions render below the stage).

ENTITY KINDS (the "stage" array):
- {kind:"title", id, text, x, y, size?, color?("ink"|"accent"|"accent2")} — kinetic headline; y is the BASELINE
- {kind:"browser", id, x, y, w?, h?, url?} — browser window
- {kind:"server", id, x, y, label} — 84x64 rack unit with a status LED
- {kind:"database", id, x, y, label} — 60x60 cylinder
- {kind:"queue", id, x, y, slots?, label} — slot rail, ~18px per slot
- {kind:"cloud", id, x, y, w, h, label} — dashed boundary box
- {kind:"connector", id, from:[x,y], to:[x,y], via?:[x,y], dashed?} — a wire; via bends it
- {kind:"packets", id, along:<connector id>, reverse?, count?, color?("accent"|"accent2"|"ok"|"warn"|"hot")} — dots that travel the wire (reverse:true rides it backwards — use for responses)
- {kind:"code", id, x, y, w?, lines:[...]} — monospace panel (≤6 short lines)
- {kind:"callout", id, x, y, text, anchor:[x,y]} — label pill with a leader line to anchor
- {kind:"chart", id, x, y, w?, h?, values:[0..1,...]} — bar chart

BEATS (the "beats" array): contiguous story chapters. {id, start, end, caption, actions[]} — start/end in SECONDS, each beat starts where the previous ended, first at 0. Captions are one spoken-style sentence (they karaoke-highlight). 4-7 beats, 6-12s each, total 35-60s.

ACTIONS inside a beat: {target, do, at, dur, value?} — at/dur in seconds relative to the beat.
Allowed per kind: ${Object.entries(ACTION_KINDS).map(([k, v]) => `${k}: ${v.join("/")}`).join(" · ")}
- value: state→"ok"|"busy"|"err"|"idle"; fill→level 0..1; highlight→line index; flow/pulse/shake/flash→repeat cycles (integer ≥1)
- entities you fadeIn start invisible; connectors are visible from frame 0 unless faded; callouts appear via pop and leave via unpop
- choreograph cause-and-effect: packets flow → server state flips busy → database flash → response packets (reverse:true) → result

CAMERA (optional "camera" array): [{at, dur, view:[x,y,w,h]}] — viewBox moves; keep w:h at 32:15 (e.g. 1280x600, 800x375); start wide, push in on the action, return wide to close.

CRAFT RULES: every beat needs 2-5 actions (never a static beat); reuse entities across beats; put the title beat first (reveal, then fadeOut before beat 2); end with a recap beat that leaves steady-state motion running. Output strictly valid JSON for the FilmDoc schema with top-level keys: title, fps:30, stage, beats, camera.`;

function runClaude(prompt, model) {
  return new Promise((resolvePromise, reject) => {
    const args = ["-p", "--output-format", "json"];
    if (model) args.push("--model", model);
    const child = spawn("claude", args);
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(e.code === "ENOENT" ? new Error("`claude` CLI not found — install Claude Code") : e));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.trim().slice(0, 300)}`));
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

function extractJson(text) {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  const start = stripped.indexOf("{"), end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
  throw new Error(`expected JSON, got: ${text.slice(0, 200)}`);
}

/** Generate a validated FilmDoc for `topic`; retries once with schema errors quoted back. */
export async function generateFilmDoc(topic, { model, duration = 45 } = {}) {
  const base = `${INSTRUCTIONS}\n\nTarget total length: about ${duration} seconds.\n\nTOPIC: ${topic}`;
  let text = await runClaude(base, model);
  let candidate = extractJson(text);
  let { doc, errors } = parseFilmDoc(candidate);
  if (doc) return { doc, attempts: 1 };
  // one retry with the validator's messages — the same loop a human would run
  const retry = `${base}\n\nYour previous attempt was INVALID. Fix ALL of these problems and output the corrected FilmDoc JSON only:\n- ${errors.join("\n- ")}\n\nPrevious attempt:\n${JSON.stringify(candidate)}`;
  text = await runClaude(retry, model);
  candidate = extractJson(text);
  ({ doc, errors } = parseFilmDoc(candidate));
  if (doc) return { doc, attempts: 2 };
  throw new Error(`FilmDoc still invalid after retry:\n- ${errors.join("\n- ")}`);
}

const PAGE = (title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title} — a generated motion/ film</title>
<link rel="stylesheet" href="../../tokens.css">
<link rel="stylesheet" href="../../templates/film.css">
</head>
<body>
<svg id="stage" viewBox="0 0 1280 600"></svg>
<div id="caption"></div>
<script type="module">
  import { bootFilm } from "../../templates/explainer.mjs";
  import doc from "./filmdoc.json" with { type: "json" };
  bootFilm(doc);
</script>
</body>
</html>
`;

/** Write films/<name>/{filmdoc.json,index.html}. Returns the film directory. */
export function writeFilm(doc, name) {
  const dir = join(HERE, "..", "films", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "filmdoc.json"), JSON.stringify(doc, null, 2) + "\n");
  writeFileSync(join(dir, "index.html"), PAGE(doc.title));
  return dir;
}

/** Record a written film folder to MP4 via the shared narration-aware builder (silent unless the
 *  film opts into narration — e.g. a "voice" block on its filmdoc.json). */
export async function recordFilm(dir, out) {
  return buildFilm(dir, out);
}

async function main() {
  const argv = process.argv.slice(2);
  const pos = argv.filter((a, i) => !a.startsWith("--") && !(argv[i - 1] ?? "").startsWith("--"));
  const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const topic = pos[0];
  if (!topic) {
    console.log('Usage: node packages/motion/tools/film-gen.mjs "<topic>" [--name slug] [--record] [--duration 45] [--model id] [--out out/<name>.mp4]');
    process.exit(1);
  }
  const name = flag("name", topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40));

  console.log(`✎ writing the screenplay for "${topic}" …`);
  const { doc, attempts } = await generateFilmDoc(topic, { model: flag("model", undefined), duration: Number(flag("duration", "45")) });
  const dir = writeFilm(doc, name);
  const secs = doc.beats[doc.beats.length - 1].end;
  console.log(`✓ FilmDoc "${doc.title}" — ${doc.beats.length} beats, ${secs}s, ${doc.stage.length} entities (${attempts} attempt${attempts > 1 ? "s" : ""}) → ${dir}`);

  if (argv.includes("--record")) {
    await recordFilm(dir, flag("out", `out/${name}.mp4`));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
