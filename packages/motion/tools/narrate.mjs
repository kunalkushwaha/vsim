// Narration builder: a script of timed lines → one WAV + a per-frame mouth envelope.
//
//   node packages/motion/tools/narrate.mjs <narration.json> <out-dir>
//
// narration.json:
//   { "fps": 30, "engine": "espeak" | "elevenlabs",
//     "espeak":     { "voice": "en+f4", "pitch": 75, "speed": 155 },
//     "elevenlabs": { "voiceId": "...", "modelId": "eleven_multilingual_v2" },
//     "lines": [ { "at": 1.0, "text": "Hi! I'm Pip." }, … ] }
//
// Output: narration.wav (22050 Hz mono) + track.json { fps, frames, envelope[0..1 per frame],
// lines[{at, dur, text}] } — the film imports track.json and drives the puppet's mouth from
// envelope[frame]: deterministic lip-sync with no runtime audio analysis.
//
// Engines: `espeak` (espeak-ng if present, else classic espeak — offline, deterministic, the
// in-repo default) or
// `elevenlabs` (needs ELEVENLABS_API_KEY + network; same WAV/envelope contract, so swapping
// engines upgrades the voice without touching the film).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const RATE = 22050;

/** @param {string} cmd @param {string[]} args */
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

/** Prefer espeak-ng; fall back to classic espeak (same -v/-p/-s/-w flags). Memoized. */
let _espeakBin;
function espeakBin() {
  if (_espeakBin) return _espeakBin;
  for (const bin of ["espeak-ng", "espeak"]) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return (_espeakBin = bin);
    } catch (e) {
      if (e.code === "ENOENT") continue; // not installed — try the next candidate
      return (_espeakBin = bin); // present, just unhappy with --version
    }
  }
  throw new Error("no speech engine found: install espeak-ng (apt install espeak-ng) or espeak");
}

/** Decode any audio file to raw mono s16le PCM at RATE via ffmpeg. @param {string} file */
function decodePcm(file) {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", String(RATE), "-"], { maxBuffer: 1 << 28 });
  // Copy into a fresh, even-length ArrayBuffer: Node's pooled Buffers can sit at odd byte
  // offsets, and an Int16Array view over an odd offset throws.
  const ab = new ArrayBuffer(buf.byteLength - (buf.byteLength % 2));
  new Uint8Array(ab).set(buf.subarray(0, ab.byteLength));
  return new Int16Array(ab);
}

/** @param {{text: string}} line @param {any} cfg @param {string} tmp @returns {string} wav path */
function synthEspeak(line, cfg, tmp, i) {
  const out = join(tmp, `line_${i}.wav`);
  run(espeakBin(), ["-v", cfg?.voice ?? "en+f4", "-p", String(cfg?.pitch ?? 75), "-s", String(cfg?.speed ?? 155), "-w", out, line.text]);
  return out;
}

/** @param {{text: string}} line @param {any} cfg @param {string} tmp */
async function synthElevenLabs(line, cfg, tmp, i) {
  const key = process.env.ELEVENLABS_API_KEY ?? process.env.ELEVEN_LABS_API_KEY;
  if (!key) throw new Error("elevenlabs engine needs ELEVENLABS_API_KEY (or ELEVEN_LABS_API_KEY)");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cfg.voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text: line.text, model_id: cfg.modelId ?? "eleven_multilingual_v2" }),
  });
  if (!res.ok) throw new Error(`elevenlabs: HTTP ${res.status} — ${await res.text()}`);
  const out = join(tmp, `line_${i}.mp3`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

/** Minimal WAV writer (PCM s16le mono @ RATE). @param {Int16Array} pcm @param {string} path */
function writeWav(pcm, path) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

export async function narrate(scriptPath, outDir) {
  const spec = JSON.parse(readFileSync(scriptPath, "utf8"));
  const fps = spec.fps ?? 30;
  const engine = process.env.NARRATE_ENGINE ?? spec.engine ?? "espeak";
  mkdirSync(outDir, { recursive: true });
  const tmp = join(outDir, ".narrate-tmp");
  mkdirSync(tmp, { recursive: true });

  // 1 · synth each line, decode to PCM, note real durations
  const lines = [];
  const pcms = [];
  for (let i = 0; i < spec.lines.length; i++) {
    const line = spec.lines[i];
    const file = engine === "elevenlabs"
      ? await synthElevenLabs(line, spec.elevenlabs, tmp, i)
      : synthEspeak(line, spec.espeak, tmp, i);
    const pcm = decodePcm(file);
    pcms.push(pcm);
    lines.push({ at: line.at, dur: pcm.length / RATE, text: line.text });
  }

  // 2 · place lines on one master track (samples at `at` seconds; last line decides length)
  const last = lines[lines.length - 1];
  const total = Math.ceil((last.at + last.dur + 0.6) * RATE);
  const master = new Int16Array(total);
  lines.forEach((l, i) => {
    const off = Math.round(l.at * RATE);
    master.set(pcms[i].subarray(0, Math.min(pcms[i].length, total - off)), off);
  });
  writeWav(master, join(outDir, "narration.wav"));

  // 3 · per-video-frame mouth envelope: RMS → p95-normalize → quick-attack/slow-decay smooth
  const frames = Math.ceil((total / RATE) * fps);
  const per = RATE / fps;
  const rms = new Array(frames).fill(0);
  for (let f = 0; f < frames; f++) {
    const a = Math.floor(f * per), b = Math.min(total, Math.floor((f + 1) * per));
    let acc = 0;
    for (let s = a; s < b; s++) acc += master[s] * master[s];
    rms[f] = Math.sqrt(acc / Math.max(1, b - a)) / 32768;
  }
  const sorted = [...rms].sort((x, y) => x - y);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const envelope = [];
  let prev = 0;
  for (const r of rms) {
    const n = Math.min(1, r / p95);
    prev = n > prev ? n : Math.max(n, prev * 0.72); // open fast, close smoothly
    envelope.push(Math.round(prev * 1000) / 1000);
  }

  writeFileSync(join(outDir, "track.json"),
    JSON.stringify({ fps, frames, engine, lines: lines.map((l) => ({ at: l.at, dur: Math.round(l.dur * 100) / 100, text: l.text })), envelope }));
  rmSync(tmp, { recursive: true, force: true });
  return { frames, seconds: total / RATE, lines: lines.length };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [scriptPath, outDir] = process.argv.slice(2);
  if (!scriptPath || !outDir) {
    console.log("Usage: node packages/motion/tools/narrate.mjs <narration.json> <out-dir>");
    process.exit(1);
  }
  narrate(scriptPath, outDir).then((r) =>
    console.log(`✓ narration.wav + track.json — ${r.lines} lines, ${r.seconds.toFixed(1)}s, ${r.frames} frames`));
}
