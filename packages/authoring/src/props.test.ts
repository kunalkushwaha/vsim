import { describe, it, expect } from "vitest";
import { scene } from "./index.js";

describe("prop builders", () => {
  it("tree() adds a trunk + foliage parented to a group, with shared materials", () => {
    const doc = scene({ fps: 30, duration: 1, width: 16, height: 16 })
      .tree("t0", { position: [1, 0, 2], height: 3 })
      .tree("t1", { position: [-1, 0, 0] })
      .camera({ position: [0, 1, 5], lookAt: [0, 0, 0] })
      .build();
    const ids = doc.nodes.map((n) => n.id);
    for (const id of ["t0", "t0__trunk", "t0__leaves", "t1", "t1__trunk", "t1__leaves"]) expect(ids).toContain(id);
    // parts are parented to the group handle and use the cylinder/cone primitives
    const trunk = doc.nodes.find((n) => n.id === "t0__trunk")!;
    const leaves = doc.nodes.find((n) => n.id === "t0__leaves")!;
    expect(trunk.parent).toBe("t0");
    expect(trunk.mesh!.geometry.kind).toBe("cylinder");
    expect(leaves.mesh!.geometry.kind).toBe("cone");
    // shared prop materials are added once, not per tree
    expect(doc.materials.filter((m) => m.id === "prop_bark")).toHaveLength(1);
    expect(doc.materials.filter((m) => m.id === "prop_leaves")).toHaveLength(1);
  });

  it("rock() sits on the ground (lifted by its squashed radius)", () => {
    const doc = scene({ fps: 30, duration: 1, width: 16, height: 16 })
      .rock("r0", { position: [0, 0, 0], radius: 0.5 })
      .camera({ position: [0, 1, 5], lookAt: [0, 0, 0] })
      .build();
    const rock = doc.nodes.find((n) => n.id === "r0")!;
    expect(rock.mesh!.geometry.kind).toBe("sphere");
    expect(rock.position[1]).toBeCloseTo(0.5 * 0.65); // base at y=0 → center lifted by radius*scaleY
    expect(rock.scale[1]).toBeCloseTo(0.65);
  });
});
