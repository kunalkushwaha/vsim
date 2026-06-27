import { describe, it, expect } from "vitest";
import { listCharacters, loadCharacter } from "./index.js";

describe("character library", () => {
  it("lists the bundled characters", async () => {
    const ids = (await listCharacters()).map((c) => c.id).sort();
    expect(ids).toEqual(["figure", "fox", "person"]);
  });

  it("loads the Blender-generated figure (rigged + walk clip)", async () => {
    const { rig, meta } = await loadCharacter("figure", 30);
    expect(meta.defaultClip).toBe("walk");
    expect(rig.joints.length).toBeGreaterThan(0);
    expect(rig.clips.some((c) => c.id === "walk")).toBe(true);
  });

  it("loads a character by id with its rig + placement metadata", async () => {
    const { rig, meta } = await loadCharacter("person", 30);
    expect(meta.defaultClip).toBe("clip0");
    expect(meta.rotation).toEqual([-1.5708, 0, 0]); // stands the Z-up model upright
    expect(rig.joints.length).toBeGreaterThan(0);
    expect(rig.clips.length).toBeGreaterThan(0);
    expect(rig.mesh.joints).toBeDefined();
  });

  it("throws a helpful error on an unknown id", async () => {
    await expect(loadCharacter("nobody", 30)).rejects.toThrow(/Unknown character/);
  });

  it("decodes the base-color texture and UVs (PNG: fox, JPEG: person)", async () => {
    for (const id of ["fox", "person"]) {
      const { rig } = await loadCharacter(id, 30);
      const verts = rig.mesh.positions.length / 3;
      expect(rig.mesh.uvs).toHaveLength(verts * 2); // a (u,v) per vertex
      const tex = rig.mesh.texture!;
      expect(tex.width).toBeGreaterThan(0);
      expect(tex.height).toBeGreaterThan(0);
      expect(tex.data).toHaveLength(tex.width * tex.height * 4); // RGBA
    }
  });
});
