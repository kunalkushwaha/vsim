import { describe, it, expect } from "vitest";
import { listModels, loadModel } from "./index.js";

describe("bundled static models (KayKit medieval + assetkit)", () => {
  it("loads every manifest entry with uvs and the embedded palette texture", async () => {
    const metas = await listModels();
    expect(metas.map((m) => m.name)).toEqual(
      expect.arrayContaining(["hut", "tavern", "windmill", "well", "tower", "barrel", "crate", "tent", "wheelbarrow", "sack"]),
    );
    for (const m of metas) {
      const md = await loadModel(m.name);
      const verts = md.positions.length / 3;
      expect(verts, m.name).toBeGreaterThan(50);
      expect(md.uvs?.length, `${m.name} uvs`).toBe(verts * 2);
      expect(md.texture, `${m.name} texture`).toBeDefined();
      expect(md.texture!.data.length).toBe(md.texture!.width * md.texture!.height * 4);
      // Grounded at y=0 (props sit on the film's ground plane without offsets) — except
      // sub-node parts re-rooted at their pivot (the windmill fan is centered on its hub).
      if (m.name !== "windmill-fan" && m.grounded !== false) {
        let minY = Infinity;
        for (let i = 1; i < md.positions.length; i += 3) minY = Math.min(minY, md.positions[i]!);
        expect(minY, `${m.name} rests on the ground`).toBeGreaterThan(-0.05);
      }
    }
  });

  it("model names are unique across packs and assetkit sizes match the loaded geometry", async () => {
    const metas = await listModels();
    expect(new Set(metas.map((m) => m.name)).size).toBe(metas.length);
    for (const m of metas.filter((x) => x.pack === "assetkit")) {
      const md = await loadModel(m.name);
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < md.positions.length; i += 3)
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, md.positions[i + k]!); hi[k] = Math.max(hi[k]!, md.positions[i + k]!); }
      const size = hi.map((h, k) => h - lo[k]!);
      for (let k = 0; k < 3; k++) expect(size[k], `${m.name} size_m[${k}] (x, y-up, z)`).toBeCloseTo(m.size_m![k]!, 1);
    }
  });

  it("carries a baked emissive map exactly when the manifest says the model glows", async () => {
    const assetkit = (await listModels()).filter((x) => x.pack === "assetkit");
    expect(assetkit.some((m) => m.emissive)).toBe(true);
    for (const m of assetkit) {
      const md = await loadModel(m.name);
      if (!m.emissive) { expect(md.emissiveMap, m.name).toBeUndefined(); continue; }
      const em = md.emissiveMap!;
      expect(em, `${m.name} emissiveMap`).toBeDefined();
      expect(em.data.length).toBe(em.width * em.height * 4);
      let lit = 0;
      for (let i = 0; i < em.data.length; i += 4) if (em.data[i]! + em.data[i + 1]! + em.data[i + 2]! > 90) lit++;
      expect(lit, `${m.name} has lit texels`).toBeGreaterThan(0);
    }
    // KayKit models never glow.
    expect((await loadModel("tavern")).emissiveMap).toBeUndefined();
  });

  it("caches: two loads of the same model share one MeshData", async () => {
    expect(await loadModel("barrel")).toBe(await loadModel("barrel"));
  });

  it("names the available models in the unknown-model error", async () => {
    await expect(loadModel("dragon")).rejects.toThrow(/unknown model "dragon" \(available: .*barrel/);
  });
});
