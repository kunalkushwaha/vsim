import { describe, it, expect } from "vitest";
import { listModels, loadModel } from "./index.js";

describe("bundled static models (KayKit medieval)", () => {
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
      // Grounded at y=0 (props sit on the film's ground plane without offsets).
      let minY = Infinity;
      for (let i = 1; i < md.positions.length; i += 3) minY = Math.min(minY, md.positions[i]!);
      expect(minY, `${m.name} rests on the ground`).toBeGreaterThan(-0.05);
    }
  });

  it("caches: two loads of the same model share one MeshData", async () => {
    expect(await loadModel("barrel")).toBe(await loadModel("barrel"));
  });

  it("names the available models in the unknown-model error", async () => {
    await expect(loadModel("dragon")).rejects.toThrow(/unknown model "dragon" \(available: .*barrel/);
  });
});
