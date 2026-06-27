import { describe, it, expect } from "vitest";
import { parseDocument } from "./document.js";
import { SceneRuntime } from "./runtime.js";

/**
 * Morph targets (blend shapes). An inline mesh carries one target "open" that lifts vertex 2 by +1
 * in Y; a "morph.open" track animates its weight 0→1 over frames 0→10. The runtime should resolve a
 * per-frame morph weight on the node (which the engine then uses to displace vertices before skinning).
 */
function doc() {
  return parseDocument({
    meta: { durationFrames: 11, width: 16, height: 16 },
    nodes: [
      {
        id: "face",
        mesh: {
          geometry: {
            kind: "mesh",
            data: {
              positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
              normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
              indices: [0, 1, 2],
              morphTargets: [{ name: "open", deltas: [0, 0, 0, 0, 0, 0, 0, 1, 0] }],
            },
          },
          morphWeights: { open: 0 },
        },
      },
      { id: "__camera", position: [0, 0, 5] },
    ],
    animation: [
      { target: { nodeId: "face", path: "morph.open" }, keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 1 }] },
    ],
    camera: { nodeId: "__camera" },
  });
}

const weight = (rt: SceneRuntime, f: number) =>
  rt.computeFrameState(f).nodes.find((n) => n.id === "face")!.morphWeights![0]!;

describe("morph targets", () => {
  it("resolves a morph weight from a morph.<name> track", () => {
    const rt = new SceneRuntime(doc());
    expect(weight(rt, 0)).toBeCloseTo(0);
    expect(weight(rt, 5)).toBeCloseTo(0.5);
    expect(weight(rt, 10)).toBeCloseTo(1);
  });

  it("is deterministic across runtimes", () => {
    expect(weight(new SceneRuntime(doc()), 7)).toBe(weight(new SceneRuntime(doc()), 7));
  });
});
