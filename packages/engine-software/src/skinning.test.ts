import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { parseDocument, SceneRuntime, mat4, quatFromEuler, type MeshData } from "@vsim/core";
import { SoftwareEngine } from "./index.js";

/** A 2-joint "bar": bottom verts bound to j0, top verts to j1. j1 bends 90° about Z over 0→10. */
function rigDoc() {
  const bindTipWorld = mat4.compose([0, 1, 0], [0, 0, 0, 1], [1, 1, 1]);
  const rotZ90 = quatFromEuler(0, 0, Math.PI / 2);
  return parseDocument({
    meta: { durationFrames: 11, width: 64, height: 64, background: [0, 0, 0] },
    materials: [{ id: "m", color: [0.9, 0.5, 0.3] }],
    nodes: [
      { id: "j0", position: [0, 0, 0] },
      { id: "j1", parent: "j0", position: [0, 1, 0] },
      { id: "lt", light: { type: "ambient", intensity: 0.9 } },
      { id: "bar", mesh: { geometry: { kind: "box", size: [0.2, 0.2, 0.2] }, materialId: "m", skinId: "s" }, clip: { clipId: "c" } },
      { id: "__camera", position: [0, 1, 6] },
    ],
    skins: [{ id: "s", joints: ["j0", "j1"], inverseBindMatrices: [mat4.identity(), mat4.invert(bindTipWorld)] }],
    clips: [
      {
        id: "c",
        durationFrames: 10,
        channels: [
          { jointNodeId: "j1", path: "rotation", interpolation: "linear", times: [0, 10], values: [0, 0, 0, 1, ...rotZ90] },
        ],
      },
    ],
    camera: { nodeId: "__camera", lookAt: [0, 1, 0], fov: 50 },
  });
}

/** A wide bar: bottom edge (y=0) follows j0, top edge (y=2) follows j1. */
const BAR: MeshData = {
  positions: [-0.3, 0, 0, 0.3, 0, 0, 0.3, 2, 0, -0.3, 2, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  indices: [0, 1, 2, 0, 2, 3],
  joints: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  weights: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
};

function renderHash(frame: number): string {
  const doc = rigDoc();
  const eng = new SoftwareEngine(doc.meta.width, doc.meta.height);
  eng.init(doc);
  eng.loadMesh("bar", BAR); // inject the skinned mesh (joints/weights)
  const rt = new SceneRuntime(doc);
  eng.renderFrame(rt.computeFrameState(frame));
  return createHash("sha256").update(Buffer.from(eng.readPixels())).digest("hex");
}

describe("CPU skinning (software engine)", () => {
  it("deforms the mesh: the bent pose renders differently from the rest pose", () => {
    expect(renderHash(0)).not.toBe(renderHash(10));
  });

  it("is deterministic: the bent pose is byte-identical across two runs", () => {
    expect(renderHash(10)).toBe(renderHash(10));
  });
});
