import { describe, it, expect } from "vitest";
import { parseDocument, type SceneDocument } from "@vsim/core";
import { applyOperations, type EditOperation } from "./operations.js";
import { toolUseToOperation } from "./tools.js";

function baseDoc(): SceneDocument {
  return parseDocument({
    meta: { durationFrames: 90 },
    materials: [{ id: "cube", color: [0.9, 0.4, 0.4] }],
    nodes: [
      { id: "cube", mesh: { geometry: { kind: "box" } }, position: [0, 0, 0] },
      { id: "__camera", position: [3, 2, 4] },
    ],
    camera: { nodeId: "__camera", fov: 45 },
  });
}

describe("applyOperations", () => {
  it("updates an existing material and leaves others untouched", () => {
    const out = applyOperations(baseDoc(), [{ op: "setMaterial", id: "cube", color: [0, 0, 1] }]);
    expect(out.materials.find((m) => m.id === "cube")?.color).toEqual([0, 0, 1]);
    expect(out.materials).toHaveLength(1);
  });

  it("creates a new material when the id is new", () => {
    const out = applyOperations(baseDoc(), [{ op: "setMaterial", id: "floor", roughness: 0.2 }]);
    const mat = out.materials.find((m) => m.id === "floor");
    expect(mat?.roughness).toBe(0.2);
    expect(mat?.color).toEqual([0.8, 0.8, 0.8]); // default filled by parseDocument
  });

  it("adds a mesh node referencing a material", () => {
    const out = applyOperations(baseDoc(), [
      { op: "addMesh", id: "ball", geometry: { kind: "sphere", radius: 0.5 }, material: "cube", position: [1, 0, 0] },
    ]);
    const node = out.nodes.find((n) => n.id === "ball");
    expect(node?.mesh?.geometry).toEqual({ kind: "sphere", radius: 0.5, segments: 16 });
    expect(node?.mesh?.materialId).toBe("cube");
    expect(node?.position).toEqual([1, 0, 0]);
  });

  it("auto-generates light ids and stacks them", () => {
    const out = applyOperations(baseDoc(), [
      { op: "addLight", type: "ambient", intensity: 0.4 },
      { op: "addLight", type: "directional", direction: [0, -1, 0] },
    ]);
    expect(out.nodes.find((n) => n.id === "__light0")?.light?.type).toBe("ambient");
    expect(out.nodes.find((n) => n.id === "__light1")?.light?.type).toBe("directional");
  });

  it("moves the camera node and sets lookAt/fov", () => {
    const out = applyOperations(baseDoc(), [{ op: "setCamera", position: [10, 10, 10], lookAt: [0, 0, 0], fov: 60 }]);
    expect(out.nodes.find((n) => n.id === "__camera")?.position).toEqual([10, 10, 10]);
    expect(out.camera.lookAt).toEqual([0, 0, 0]);
    expect(out.camera.fov).toBe(60);
  });

  it("adds an animation track in frames", () => {
    const out = applyOperations(baseDoc(), [
      { op: "addAnimation", nodeId: "cube", path: "rotation.y", keyframes: [{ frame: 0, value: 0 }, { frame: 90, value: 6.28 }] },
    ]);
    expect(out.animation).toHaveLength(1);
    expect(out.animation[0]?.target).toEqual({ nodeId: "cube", path: "rotation.y" });
    expect(out.animation[0]?.keyframes[1]?.frame).toBe(90);
  });

  it("removes a node and its animation tracks", () => {
    const withAnim = applyOperations(baseDoc(), [
      { op: "addAnimation", nodeId: "cube", path: "position.y", keyframes: [{ frame: 0, value: 0 }] },
    ]);
    const out = applyOperations(withAnim, [{ op: "removeNode", id: "cube" }]);
    expect(out.nodes.find((n) => n.id === "cube")).toBeUndefined();
    expect(out.animation).toHaveLength(0);
  });

  it("is deterministic: same ops produce identical documents", () => {
    const ops: EditOperation[] = [
      { op: "setMaterial", id: "cube", color: [0.1, 0.2, 0.3] },
      { op: "addLight", type: "point", intensity: 2 },
    ];
    expect(applyOperations(baseDoc(), ops)).toEqual(applyOperations(baseDoc(), ops));
  });
});

describe("toolUseToOperation", () => {
  it("maps a tool_use block to a typed operation and applies end-to-end", () => {
    // Simulate what a Claude tool_use block would carry.
    const op = toolUseToOperation("set_material", { id: "cube", color: [0, 1, 0] });
    expect(op).toEqual({ op: "setMaterial", id: "cube", color: [0, 1, 0] });
    const out = applyOperations(baseDoc(), [op!]);
    expect(out.materials.find((m) => m.id === "cube")?.color).toEqual([0, 1, 0]);
  });

  it("returns null for an unknown tool", () => {
    expect(toolUseToOperation("frobnicate", {})).toBeNull();
  });
});
