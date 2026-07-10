// Narration-aware 2D-film build: voice the film (when it opts in) and mux the audio, otherwise
// record it silently. One build path for every 2D film — hand-authored or AI-generated.
//
//   node packages/motion/build-film.mjs <film-dir> <out.mp4> [record flags…]
//
// A film opts into narration in one of two ways:
//   • an explicit narration.json — { fps, engine, lines:[{at,text}] } — a scripted voice-over
//     (used by character films like pip-hello, which also lip-sync from the generated track.json)
//   • a "voice" block on its screenplay.json / filmdoc.json — the voice-over is derived from the
//     beats' captions (spoken at each beat's start), so an explainer needs no duplicated text:
//       "voice": { "engine": "espeak", "espeak": {…}, "elevenlabs": {…}, "leadIn": 0.15 }
// With neither present the film records silent (the previous behavior, unchanged).
//
// Engine/key handling belongs to the narration pipeline (espeak-ng→espeak offline, or elevenlabs
// via env). Run under `node --env-file-if-exists=.env …` to pick up an ElevenLabs key from a
// local .env, and set NARRATE_ENGINE=elevenlabs to voice a caption-derived film with it.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { narrate, narrateSpec } from "./tools/narrate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * How a film opts into narration, or null if it doesn't.
 *   { file: "narration.json" }           → narrate that file directly (explicit lines)
 *   { file, spec }                       → narrate a spec derived from a doc's captions
 * @param {string} dir absolute film directory
 */
export function narrationFor(dir) {
  // 1 · explicit scripted voice-over
  if (existsSync(join(dir, "narration.json"))) return { file: "narration.json" };
  // 2 · derive from a captioned screenplay/filmdoc that turns narration on via "voice"
  for (const name of ["screenplay.json", "filmdoc.json"]) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const doc = JSON.parse(readFileSync(path, "utf8"));
    if (!doc.voice) continue;
    const v = doc.voice === true ? {} : doc.voice;
    const leadIn = v.leadIn ?? 0.15;
    // One caption spoken per beat, at the beat's start. Captions are one sentence and beats run
    // several seconds, so they fit; a caption longer than its beat would be clipped by the next.
    const lines = (doc.beats ?? [])
      .filter((b) => b?.caption && String(b.caption).trim())
      .map((b) => ({ at: Math.max(0, (b.start ?? 0) + leadIn), text: String(b.caption).trim() }));
    if (!lines.length) continue;
    return { file: name, spec: { fps: doc.fps ?? 30, engine: v.engine, espeak: v.espeak, elevenlabs: v.elevenlabs, lines } };
  }
  return null;
}

/**
 * Voice the film if it opts in, then record its page to `out`, muxing the narration when present.
 * @param {string} dir film directory @param {string} out output mp4 @param {string[]} recordArgs extra record.mjs flags
 * @returns {Promise<string>} resolved output path
 */
export async function buildFilm(dir, out, recordArgs = []) {
  const abs = resolve(dir);
  const narr = narrationFor(abs);
  let voiced = false;
  if (narr) {
    try {
      const r = narr.spec ? await narrateSpec(narr.spec, abs) : await narrate(join(abs, "narration.json"), abs);
      console.log(`  ♪ narration (${narr.file}) — ${r.lines} lines, ${r.seconds.toFixed(1)}s`);
      voiced = true;
    } catch (err) {
      // A missing narrator should soften the film, not fail the render — same contract as the
      // film3d voice-over path (no espeak/espeak-ng, a bad ElevenLabs key, or blocked network
      // records the film silent with a warning rather than aborting the build).
      console.warn(`  ⚠ narration skipped — recording silent (${err instanceof Error ? err.message : err})`);
    }
  }
  const audio = join(abs, "narration.wav");
  const args = [
    join(HERE, "record.mjs"), join(abs, "index.html"), resolve(out),
    // only mux when this run actually voiced the film (never a stale narration.wav from before)
    ...(voiced && existsSync(audio) ? ["--audio", audio] : []),
    ...recordArgs,
  ];
  const code = await new Promise((res) => spawn("node", args, { stdio: "inherit" }).on("exit", res));
  if (code !== 0) throw new Error(`recorder exited ${code}`);
  return resolve(out);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, out, ...rest] = process.argv.slice(2);
  if (!dir || !out) {
    console.log("Usage: node packages/motion/build-film.mjs <film-dir> <out.mp4> [--width 1280] [--height 720] [--audio file] …");
    process.exit(1);
  }
  buildFilm(dir, out, rest).then((p) => console.log(`✓ ${p}`));
}
