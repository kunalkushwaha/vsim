import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { listSurfaces, loadSurface } from "./index.js";

const dir = fileURLToPath(new URL("../surfaces/", import.meta.url));

describe("surface library", () => {
  it("lists the bundled surfaces", async () => {
    // Generated surfaces join the library over time — assert the hand-written proofs are
    // present rather than pinning a closed list.
    const names = (await listSurfaces()).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["festival-poster", "star-cutout", "trail-sign"]));
  });

  it("every surface folder has source + bake + metadata, and the manifest matches", async () => {
    const folders = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const manifest = (await listSurfaces()).map((s) => s.name).sort();
    expect(folders).toEqual(manifest); // no orphan folders, no phantom entries
    for (const meta of await listSurfaces()) {
      const files = meta.type === "svg"
        ? ["source.svg", "surface.json"] // svg surfaces are consumed as geometry — no bake
        : ["source.html", "art.png", "surface.json"];
      for (const f of files) {
        await expect(readFile(join(dir, meta.name, f)), `${meta.name}/${f}`).resolves.toBeDefined();
      }
    }
  });

  it("loads a bake as RGBA at the declared size", async () => {
    const meta = (await listSurfaces()).find((s) => s.name === "trail-sign")!;
    const s = await loadSurface("trail-sign");
    expect([s.width, s.height]).toEqual(meta.size);
    expect(s.data.length).toBe(s.width * s.height * 4);
    // The wood board is unmistakably brown: red channel well above blue at the center.
    const i = (Math.floor(s.height / 2) * s.width + Math.floor(s.width / 2)) * 4;
    expect(s.data[i]!).toBeGreaterThan(s.data[i + 2]!);
  });

  it("names the available surfaces in the unknown-surface error", async () => {
    await expect(loadSurface("nope")).rejects.toThrow(/unknown surface "nope" \(available: .*trail-sign/);
  });
});
