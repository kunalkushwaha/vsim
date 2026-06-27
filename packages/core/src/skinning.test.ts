import { describe, it, expect } from "vitest";
import { parseDocument } from "./document.js";
import { SceneRuntime } from "./runtime.js";
import { mat4, quatFromEuler } from "./math.js";

/**
 * A synthetic 2-joint rig (the de-risking spike, no external assets). j0 at the origin, j1 its
 * child one unit up. A clip rotates j1 90° about Z over frames 0→10. We verify the runtime's
 * computed skin matrices deform a tip vertex exactly as the rig should — and do so deterministically.
 */
function rigDoc() {
  const bindTipWorld = mat4.compose([0, 1, 0], [0, 0, 0, 1], [1, 1, 1]); // j1 bind world (j0 = identity)
  const rotZ90 = quatFromEuler(0, 0, Math.PI / 2);
  return parseDocument({
    meta: { durationFrames: 11, width: 16, height: 16 },
    nodes: [
      { id: "j0", position: [0, 0, 0] },
      { id: "j1", parent: "j0", position: [0, 1, 0] },
      { id: "char", mesh: { geometry: { kind: "box", size: [0.2, 0.2, 0.2] }, skinId: "s" }, clip: { clipId: "c" } },
      { id: "__camera", position: [0, 1, 5] },
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
    camera: { nodeId: "__camera", lookAt: [0, 1, 0] },
  });
}

/** Skin a single tip vertex (bound 100% to joint 1) by the resolved joint matrices. */
function tipVertex(rt: SceneRuntime, frame: number) {
  const node = rt.computeFrameState(frame).nodes.find((n) => n.id === "char")!;
  const jm = node.skin!.jointMatrices;
  return mat4.transformPoint(jm[1]!, [0, 2, 0]); // tip bind position is (0,2,0)
}

describe("skeletal skinning (runtime)", () => {
  it("at rest (frame 0) the tip stays at its bind position", () => {
    const tip = tipVertex(new SceneRuntime(rigDoc()), 0);
    expect(tip[0]).toBeCloseTo(0, 5);
    expect(tip[1]).toBeCloseTo(2, 5);
    expect(tip[2]).toBeCloseTo(0, 5);
  });

  it("after a 90° joint rotation the tip swings to the side (real deformation)", () => {
    const tip = tipVertex(new SceneRuntime(rigDoc()), 10);
    // Rotating (0,1,0) by +90° about Z gives (-1,0,0); plus the joint's (0,1,0) offset → (-1,1,0).
    expect(tip[0]).toBeCloseTo(-1, 4);
    expect(tip[1]).toBeCloseTo(1, 4);
    expect(tip[2]).toBeCloseTo(0, 4);
  });

  it("joint matrices are byte-identical across two independent runs (determinism)", () => {
    const a = new SceneRuntime(rigDoc()).computeFrameState(7).nodes.find((n) => n.id === "char")!.skin!.jointMatrices;
    const b = new SceneRuntime(rigDoc()).computeFrameState(7).nodes.find((n) => n.id === "char")!.skin!.jointMatrices;
    expect(a).toEqual(b);
  });
});
