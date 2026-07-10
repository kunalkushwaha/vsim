// Render a vsim scene document to a PHOTOREAL MP4 via Cycles: bake every frame (one tsx run) →
// path-trace them in one Blender session (a manifest) → ffmpeg into an MP4. The Studio backend
// calls renderCycles(); also runnable as a CLI. Needs a Blender binary (VSIM_BLENDER or `blender`).
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url)); // apps/studio/
const ROOT = join(HERE, "..", "..");

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });

/** Resolve how to run Blender: an explicit binary, PATH `blender`, or the pip `bpy` module. */
async function resolveBlenderRunner(explicit) {
  const candidate = explicit || process.env.VSIM_BLENDER;
  if (candidate) return (script, args) => run(candidate, ["--background", "--python", script, "--", ...args]);
  const which = await new Promise((res) => {
    const p = spawn("blender", ["--version"], { stdio: "ignore" });
    p.on("error", () => res(false));
    p.on("exit", (code) => res(code === 0));
  });
  if (which) return (script, args) => run("blender", ["--background", "--python", script, "--", ...args]);
  // Fallback: Blender as a Python module (pip install bpy) — same script, plain python3.
  const hasBpy = await new Promise((res) => {
    const p = spawn("python3", ["-c", "import bpy"], { stdio: "ignore" });
    p.on("error", () => res(false));
    p.on("exit", (code) => res(code === 0));
  });
  if (hasBpy) return (script, args) => run("python3", [script, "--", ...args]);
  throw new Error("Cycles rendering needs Blender: set VSIM_BLENDER, put `blender` on PATH, or `pip install bpy`.");
}

/**
 * @param scenePath path to a scene-document .json, a *.film3d.json screenplay, OR a scene .ts module.
 * opts: { output, samples, step, fps, blender, from, to, audio } — from/to select a frame range
 * (an excerpt); audio muxes a WAV/MP3, offset by `from` so film-time narration stays in sync.
 */
export async function renderCycles(scenePath, { output, samples = 40, step = 1, fps, blender, from = 0, to, audio } = {}) {
  const runBlender = await resolveBlenderRunner(blender);
  const dir = await mkdtemp(join(tmpdir(), "vsim-cycles-"));
  const framesDir = join(dir, "frames"), pngDir = join(dir, "png");
  await mkdir(pngDir, { recursive: true });
  try {
    // 1) bake all frames (one tsx process reuses the runtime). A big `to` is clamped to the last
    //    frame by the baker — so .ts scenes (with inline textures that can't round-trip JSON) work too.
    await run("pnpm", ["exec", "tsx", join(HERE, "cycles-bake.ts"), scenePath, framesDir, String(from), String(to ?? 1000000000), String(step)], { cwd: ROOT });
    const man = JSON.parse(await readFile(join(framesDir, "manifest.json"), "utf8"));
    const srcFps = man.fps ?? 30;
    // 2) path-trace every frame in a single Blender session
    const items = man.frames.map((f, i) => ({ in: join(framesDir, f), out: join(pngDir, `f_${String(i).padStart(4, "0")}.png`) }));
    const renderManifest = join(dir, "render.json");
    await writeFile(renderManifest, JSON.stringify({ items }));
    await runBlender(join(ROOT, "scripts/blender/render-scene-cycles.py"), [`manifest=${renderManifest}`, `samples=${samples}`]);
    // 2b) composite screen-space text overlays onto the path-traced PNGs (same compositor as draft)
    await run("pnpm", ["exec", "tsx", join(HERE, "cycles-overlay.ts"), framesDir, pngDir], { cwd: ROOT });
    // 3) ffmpeg → MP4. The frame rate is the exact rational srcFps/step (integer rounding
    //    would drift the clip's duration — and desync any audio). Audio is padded with
    //    silence and the output cut at the VIDEO's length: narration shorter than the film
    //    must never truncate rendered frames.
    const rate = fps ? String(fps) : `${srcFps}/${step}`;
    const durSecs = fps ? items.length / fps : (items.length * step) / srcFps;
    await run("ffmpeg", ["-y", "-framerate", rate, "-i", join(pngDir, "f_%04d.png"),
      ...(audio ? ["-ss", String(from / srcFps), "-i", audio] : []),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      ...(audio ? ["-af", "apad", "-t", String(durSecs), "-c:a", "aac", "-b:a", "192k"] : []),
      output]);
    return output;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// CLI: node apps/studio/cycles-render.mjs <doc.json|film.film3d.json> <out.mp4>
//        [samples] [step] [--from N] [--to N] [--audio narration.wav]
if (process.argv[1] && process.argv[1].endsWith("cycles-render.mjs")) {
  const pos = [];
  const flags = {};
  for (let i = 2; i < process.argv.length; i++) {
    const t = process.argv[i];
    if (t.startsWith("--")) flags[t.slice(2)] = process.argv[++i];
    else pos.push(t);
  }
  const [doc, out, samples, step] = pos;
  const num = (v) => (v === undefined ? undefined : Number(v)); // undefined → signature default
  renderCycles(doc, {
    output: out,
    samples: num(flags.samples ?? samples),
    step: num(flags.step ?? step),
    from: num(flags.from),
    to: num(flags.to),
    audio: flags.audio,
  })
    .then((p) => console.log("rendered", p))
    .catch((e) => { console.error(e); process.exit(1); });
}
