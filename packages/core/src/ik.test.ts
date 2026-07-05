import { describe, it, expect } from "vitest";
import { parseDocument } from "./document.js";
import { SceneRuntime } from "./runtime.js";
import { mat4 } from "./math.js";

/**
 * Ground-contact IK v1: a root with two "foot" joints; a clip drives one foot below the ground
 * plane, and the runtime must lift the root so the deepest foot lands exactly on it.
 */
function makeDoc(over: { withIk?: boolean; footDrop?: number } = {}) {
  const drop = over.footDrop ?? -0.4; // clip pushes footA to local y = -1.4 → world -0.4 below ground
  return parseDocument({
    meta: { durationFrames: 10, width: 8, height: 8 },
    nodes: [
      {
        id: "root",
        position: [0, 1, 0],
        clip: { clipId: "step", startFrame: 0 },
        ...(over.withIk === false ? {} : { ik: { feet: ["footA", "footB"], ground: 0 } }),
      },
      { id: "footA", parent: "root", position: [0.2, -1, 0] },
      { id: "footB", parent: "root", position: [-0.2, -1, 0] },
      { id: "__camera", position: [0, 1, 5] },
    ],
    clips: [{
      id: "step",
      durationFrames: 10,
      channels: [{ jointNodeId: "footA", path: "translation", times: [0], values: [0.2, -1 + drop, 0] }],
    }],
    camera: { nodeId: "__camera", lookAt: [0, 0, 0] },
  });
}

const footY = (doc: ReturnType<typeof parseDocument>, id: string, frame = 0) => {
  const st = new SceneRuntime(doc).computeFrameState(frame);
  return mat4.getTranslation(st.nodes.find((n) => n.id === id)!.worldMatrix)[1];
};

describe("ground-contact IK", () => {
  it("lifts the root so the deepest foot lands exactly on the ground", () => {
    const doc = makeDoc();
    expect(footY(doc, "footA")).toBeCloseTo(0, 10); // was -0.4 → clamped to ground
    expect(footY(doc, "footB")).toBeCloseTo(0.4, 10); // rode up with the root
    expect(footY(doc, "root")).toBeCloseTo(1.4, 10);
  });

  it("without ik the foot penetrates", () => {
    expect(footY(makeDoc({ withIk: false }), "footA")).toBeCloseTo(-0.4, 10);
  });

  it("does nothing when all feet are above ground", () => {
    const doc = makeDoc({ footDrop: 0.3 }); // clip keeps footA above ground
    expect(footY(doc, "root")).toBeCloseTo(1, 10); // untouched
    expect(footY(doc, "footA")).toBeCloseTo(0.3, 10);
  });

  it("is deterministic", () => {
    expect(footY(makeDoc(), "footA", 5)).toBe(footY(makeDoc(), "footA", 5));
  });
});
