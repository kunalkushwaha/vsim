// Composite vsim text overlays onto the path-traced PNG frames, reusing the SAME deterministic
// compositor as the software renderer — so titles/captions/lower-thirds are pixel-identical in the
// draft (rasterized) and photoreal (Cycles) outputs. Runs after Blender, before ffmpeg.
//
//   pnpm exec tsx apps/studio/cycles-overlay.ts <framesDir> <pngDir>
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { Framebuffer, compositeOverlays } from "@vsim/engine-software";

const [framesDir, pngDir] = process.argv.slice(2);
const man = JSON.parse(await readFile(join(framesDir!, "manifest.json"), "utf8")) as { frames: string[] };

let count = 0;
for (let i = 0; i < man.frames.length; i++) {
  const frame = JSON.parse(await readFile(join(framesDir!, man.frames[i]!), "utf8")) as { overlays?: any[] };
  const overlays = frame.overlays ?? [];
  if (!overlays.length) continue;
  const pngPath = join(pngDir!, `f_${String(i).padStart(4, "0")}.png`);
  const png = PNG.sync.read(await readFile(pngPath));
  const fb = new Framebuffer(png.width, png.height);
  fb.color.set(png.data); // PNG is RGBA8, row 0 = top — same layout as the framebuffer
  compositeOverlays(fb, overlays, png.width, png.height);
  png.data.set(fb.color);
  await writeFile(pngPath, PNG.sync.write(png));
  count++;
}
console.log(`composited overlays onto ${count} frame(s)`);
