import { describe, it, expect } from "vitest";
import { parseDocument } from "./document.js";
import { SceneRuntime } from "./runtime.js";

/**
 * The Studio keyframes whole-vector transform tracks (path "position"/"rotation"/"scale" with a vec3
 * value per key). Lock in that the runtime animates them — this is what `vsim render` replays from a
 * scene the editor produced.
 */
const tx = (rt: SceneRuntime, frame: number, id: string) => {
  const m = rt.computeFrameState(frame).nodes.find((n) => n.id === id)!.worldMatrix;
  return [m[12]!, m[13]!, m[14]!];
};

describe("whole-vector transform tracks (studio keyframing)", () => {
  it("animates a node's position from a 'position' track with vec3 keyframes", () => {
    const doc = parseDocument({
      meta: { durationFrames: 11, width: 16, height: 16 },
      nodes: [{ id: "box", mesh: { geometry: { kind: "box" } } }, { id: "__camera", position: [0, 0, 5] }],
      animation: [{ target: { nodeId: "box", path: "position" }, keyframes: [{ frame: 0, value: [-2, 0, 0] }, { frame: 10, value: [2, 0, 0] }] }],
      camera: { nodeId: "__camera" },
    });
    const rt = new SceneRuntime(doc);
    expect(tx(rt, 0, "box")[0]).toBeCloseTo(-2); // first key
    expect(tx(rt, 5, "box")[0]).toBeCloseTo(0); // interpolated
    expect(tx(rt, 10, "box")[0]).toBeCloseTo(2); // last key
  });
});
