import { describe, it, expect } from "vitest";
import { parseDocument } from "./document.js";
import { SceneRuntime } from "./runtime.js";

/**
 * Spring bones: a "tail" whose animated target snaps 0 → 90° about Z at frame 3 (step track).
 * With smoothing the rendered rotation chases the target exponentially instead of snapping.
 */
function makeDoc(smoothing?: number) {
  return parseDocument({
    meta: { durationFrames: 30, width: 8, height: 8 },
    nodes: [
      { id: "tail", ...(smoothing !== undefined ? { spring: { smoothing } } : {}) },
      { id: "__camera", position: [0, 0, 5] },
    ],
    animation: [{
      target: { nodeId: "tail", path: "rotation.z" },
      keyframes: [
        { frame: 0, value: 0 },
        { frame: 3, value: Math.PI / 2, easing: "step" },
      ],
    }],
    camera: { nodeId: "__camera", lookAt: [0, 0, 0] },
  });
}

/** Rendered z-angle of the tail at each frame, stepping one runtime forward. */
function angles(doc: ReturnType<typeof parseDocument>, upTo: number): number[] {
  const rt = new SceneRuntime(doc);
  const out: number[] = [];
  for (let f = 0; f <= upTo; f++) {
    const m = rt.computeFrameState(f).nodes.find((n) => n.id === "tail")!.worldMatrix;
    out.push(Math.acos(Math.max(-1, Math.min(1, m[0]!))));
  }
  return out;
}

describe("spring bones", () => {
  it("lags the target and converges monotonically instead of snapping", () => {
    const a = angles(makeDoc(0.5), 12);
    expect(a[2]!).toBeCloseTo(0, 6); // before the step
    expect(a[3]!).toBeCloseTo(Math.PI / 4, 5); // halfway after one frame (smoothing 0.5)
    expect(a[3]!).toBeLessThan(Math.PI / 2 - 0.1); // definitely not snapped
    for (let f = 4; f <= 12; f++) {
      expect(a[f]!).toBeGreaterThan(a[f - 1]! - 1e-9); // monotone approach
    }
    expect(a[12]!).toBeGreaterThan(Math.PI / 2 - 0.01); // converged
  });

  it("without spring the rotation snaps at the keyframe", () => {
    const a = angles(makeDoc(), 4);
    expect(a[2]!).toBeCloseTo(0, 6);
    expect(a[3]!).toBeCloseTo(Math.PI / 2, 6);
  });

  it("smoothing 0 is rigid (follows the target exactly)", () => {
    const a = angles(makeDoc(0), 4);
    expect(a[3]!).toBeCloseTo(Math.PI / 2, 6);
  });

  it("is deterministic across runs, and recomputing the same frame doesn't double-advance", () => {
    expect(angles(makeDoc(0.5), 8)).toEqual(angles(makeDoc(0.5), 8));
    const rt = new SceneRuntime(makeDoc(0.5));
    for (let f = 0; f <= 3; f++) rt.computeFrameState(f);
    const once = rt.computeFrameState(3).nodes.find((n) => n.id === "tail")!.worldMatrix[0];
    const twice = rt.computeFrameState(3).nodes.find((n) => n.id === "tail")!.worldMatrix[0];
    expect(twice).toBe(once);
    expect(once).toBeCloseTo(Math.cos(Math.PI / 4), 5); // still the frame-3 value
  });

  it("reset() clears the spring state for an identical replay", () => {
    const rt = new SceneRuntime(makeDoc(0.5));
    const run = () => {
      const out: number[] = [];
      for (let f = 0; f <= 6; f++) out.push(rt.computeFrameState(f).nodes.find((n) => n.id === "tail")!.worldMatrix[0]!);
      return out;
    };
    const first = run();
    return rt.reset().then(() => {
      rt.clock.reset();
      expect(run()).toEqual(first);
    });
  });
});
