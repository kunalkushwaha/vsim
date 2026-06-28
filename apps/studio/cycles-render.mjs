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

/** @param scenePath path to a scene-document .json OR a scene .ts module. opts: { output, samples, step, fps, blender } */
export async function renderCycles(scenePath, { output, samples = 40, step = 1, fps, blender } = {}) {
  blender = blender || process.env.VSIM_BLENDER || "blender";
  const dir = await mkdtemp(join(tmpdir(), "vsim-cycles-"));
  const framesDir = join(dir, "frames"), pngDir = join(dir, "png");
  await mkdir(pngDir, { recursive: true });
  try {
    // 1) bake all frames (one tsx process reuses the runtime). A big `to` is clamped to the last
    //    frame by the baker — so .ts scenes (with inline textures that can't round-trip JSON) work too.
    await run("pnpm", ["exec", "tsx", join(HERE, "cycles-bake.ts"), scenePath, framesDir, "0", "1000000000", String(step)], { cwd: ROOT });
    const man = JSON.parse(await readFile(join(framesDir, "manifest.json"), "utf8"));
    const srcFps = man.fps ?? 30;
    // 2) path-trace every frame in a single Blender session
    const items = man.frames.map((f, i) => ({ in: join(framesDir, f), out: join(pngDir, `f_${String(i).padStart(4, "0")}.png`) }));
    const renderManifest = join(dir, "render.json");
    await writeFile(renderManifest, JSON.stringify({ items }));
    await run(blender, ["--background", "--python", join(ROOT, "scripts/blender/render-scene-cycles.py"), "--", `manifest=${renderManifest}`, `samples=${samples}`]);
    // 3) ffmpeg → MP4 (play at srcFps/step so the clip keeps real-time duration)
    const outFps = fps ?? Math.max(1, Math.round(srcFps / step));
    await run("ffmpeg", ["-y", "-framerate", String(outFps), "-i", join(pngDir, "f_%04d.png"),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", output]);
    return output;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// CLI: node apps/studio/cycles-render.mjs <doc.json> <out.mp4> [samples] [step]
if (process.argv[1] && process.argv[1].endsWith("cycles-render.mjs")) {
  const [doc, out, samples, step] = process.argv.slice(2);
  renderCycles(doc, { output: out, samples: Number(samples ?? 40), step: Number(step ?? 1) })
    .then((p) => console.log("rendered", p))
    .catch((e) => { console.error(e); process.exit(1); });
}
