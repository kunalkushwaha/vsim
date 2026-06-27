import { describe, it, expect } from "vitest";
import { listCharacters, loadCharacter, loadVrm } from "./index.js";

describe("character library", () => {
  it("lists the bundled characters", async () => {
    const ids = (await listCharacters()).map((c) => c.id).sort();
    expect(ids).toEqual(["avatar", "figure", "fox", "human", "kid", "man", "person", "speaker", "suited"]);
  });

  it("loads the MakeHuman-generated human (realistic rig + clip library + skin texture)", async () => {
    const { rig, meta } = await loadCharacter("human", 30);
    expect(meta.defaultClip).toBe("walk");
    expect(rig.joints.length).toBeGreaterThan(20); // full humanoid skeleton
    const clipIds = rig.clips.map((c) => c.id).sort();
    expect(clipIds).toEqual(["idle", "run", "walk", "wave"]); // the authored clip library
    // real skin: a base-color texture sampled over per-vertex UVs
    const verts = rig.mesh.positions.length / 3;
    expect(rig.mesh.uvs).toHaveLength(verts * 2);
    const tex = rig.mesh.texture!;
    expect(tex.width).toBeGreaterThan(0);
    expect(tex.data).toHaveLength(tex.width * tex.height * 4);
  });

  it("provides distinct MakeHuman bodies (man taller than woman taller than child)", async () => {
    const height = async (id: string) => {
      const { rig } = await loadCharacter(id, 30);
      let lo = Infinity, hi = -Infinity;
      for (let i = 1; i < rig.mesh.positions.length; i += 3) {
        const y = rig.mesh.positions[i]!;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      return hi - lo;
    };
    const [man, woman, kid] = await Promise.all([height("man"), height("human"), height("kid")]);
    expect(man).toBeGreaterThan(woman); // gender/height/muscle macros baked into the mesh
    expect(woman).toBeGreaterThan(kid); // age macro → child proportions
  });

  it("loads a clothed character as multiple skinned meshes (body + garments)", async () => {
    const { rig } = await loadCharacter("suited", 30);
    expect(rig.meshes.length).toBeGreaterThan(1); // body + suit + shoes
    expect(rig.mesh).toBe(rig.meshes[0]); // primary mesh is the first
    for (const m of rig.meshes) {
      expect(m.joints!.length).toBe((m.positions.length / 3) * 4); // every garment is skinned
      expect(m.texture).toBeDefined(); // each carries its own base-color texture
    }
  });

  it("loads a VRM avatar (humanoid bone map + license parsed)", async () => {
    const { rig } = await loadCharacter("avatar", 30); // .vrm → dispatched to loadVrm
    const vrm = rig as Awaited<ReturnType<typeof loadVrm>>;
    expect(vrm.meta.spec).toBe("1.0");
    expect(vrm.meta.license).toMatch(/creativecommons/);
    expect(vrm.humanoidBones.leftUpperArm).toBeDefined();
    expect(vrm.joints).toContain(vrm.humanoidBones.hips!); // humanoid roles map to real joints
    expect(Object.keys(vrm.humanoidBones).length).toBeGreaterThanOrEqual(15);
    expect(vrm.clips.some((c) => c.id === "walk")).toBe(true);
  });

  it("loads the speaker's mouth-open morph target (blend shape)", async () => {
    const { rig } = await loadCharacter("speaker", 30);
    const mt = rig.mesh.morphTargets!;
    expect(mt.length).toBe(1);
    expect(mt[0]!.name).toBe("mouthOpen");
    expect(mt[0]!.deltas).toHaveLength(rig.mesh.positions.length); // one xyz delta per vertex
    // a morph that does something: at least one vertex is actually displaced
    expect(mt[0]!.deltas.some((d) => Math.abs(d) > 1e-4)).toBe(true);
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
