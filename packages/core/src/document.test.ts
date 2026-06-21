import { describe, it, expect } from "vitest";
import { parseDocument } from "./document.js";

describe("parseDocument", () => {
  it("applies defaults for a minimal document", () => {
    const doc = parseDocument({
      meta: { durationFrames: 60 },
      camera: { nodeId: "cam" },
      nodes: [{ id: "cam" }],
    });
    expect(doc.meta.fps).toBe(30);
    expect(doc.meta.width).toBe(1920);
    expect(doc.meta.seed).toBe(0);
    expect(doc.nodes[0]!.position).toEqual([0, 0, 0]);
    expect(doc.nodes[0]!.scale).toEqual([1, 1, 1]);
    expect(doc.camera.fov).toBe(50);
  });

  it("throws a readable error on invalid input", () => {
    expect(() => parseDocument({ meta: {}, camera: { nodeId: "c" } })).toThrow(/durationFrames/);
  });

  it("parses a mesh node with a discriminated geometry", () => {
    const doc = parseDocument({
      meta: { durationFrames: 10 },
      camera: { nodeId: "cam" },
      materials: [{ id: "red", color: [1, 0, 0] }],
      nodes: [
        { id: "cam", position: [0, 0, 5] },
        { id: "cube", mesh: { geometry: { kind: "box" }, materialId: "red" } },
      ],
    });
    const cube = doc.nodes.find((n) => n.id === "cube")!;
    expect(cube.mesh!.geometry.kind).toBe("box");
    expect(doc.materials[0]!.color).toEqual([1, 0, 0]);
  });
});
