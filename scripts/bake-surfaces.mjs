// Bake every surface source into its committed canonical PNG + rebuild the manifest.
// Surfaces are HTML/CSS artifacts (packages/assets/surfaces/<name>/source.html) rendered
// once by the motion recorder's pinned Chromium; films consume ONLY the committed art.png
// (Chromium rasterization is not cross-platform byte-stable — the PNG is the asset, the
// HTML is its regeneration recipe). See docs/plan-surface-pack.md.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captureStill } from "../packages/motion/record.mjs";

const root = new URL("../packages/assets/surfaces/", import.meta.url).pathname;
const entries = [];
for (const dir of (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory())) {
  const base = join(root, dir.name);
  const meta = JSON.parse(await readFile(join(base, "surface.json"), "utf8"));
  const [width, height] = meta.size;
  const png = await captureStill(join(base, "source.html"), { width, height });
  await writeFile(join(base, "art.png"), png);
  entries.push({ name: meta.name, size: meta.size, license: meta.license, ...(meta.prompt ? { prompt: meta.prompt } : {}) });
  console.log(`✓ ${meta.name} (${width}x${height}, ${png.length} bytes)`);
}
entries.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(join(root, "manifest.json"), JSON.stringify({ surfaces: entries }, null, 2) + "\n");
console.log(`✓ manifest — ${entries.length} surfaces`);
