import { describe, it, expect } from "vitest";
import { parseDocument } from "./document.js";
import { SceneRuntime } from "./runtime.js";
import { mat4 } from "./math.js";

/**
 * Stance locking (ik.lock): an in-place "walk" — during stance the foot sweeps BACKWARD at
 * ground height (frames 0..10: local x 0 → −0.5), then lifts and swings forward. With lock,
 * the root must advance so the planted foot's WORLD position stays fixed; the accumulated
 * offset persists after the foot lifts (root-motion extraction).
 */
function makeDoc(lock: boolean) {
  return parseDocument({
    meta: { durationFrames: 40, width: 8, height: 8 },
    nodes: [
      { id: "root", position: [0, 1, 0], clip: { clipId: "step", startFrame: 0, loop: true }, ik: { feet: ["foot"], ground: 0, lock } },
      { id: "foot", parent: "root", position: [0, -1, 0] },
      { id: "__camera", position: [0, 1, 5] },
    ],
    clips: [{
      id: "step",
      durationFrames: 30,
      channels: [{
        jointNodeId: "foot",
        path: "translation",
        // stance: sweep back on the ground; swing: lift and return forward
        times: [0, 10, 12, 20, 30],
        values: [
          0, -1, 0, // f0: under the root, on the ground
          -0.5, -1, 0, // f10: swept back (still on the ground)
          -0.5, -0.6, 0, // f12: lifted
          0.5, -0.6, 0, // f20: swung forward in the air
          0.5, -1, 0, // f30: planted forward
        ],
      }],
    }],
    camera: { nodeId: "__camera", lookAt: [0, 0, 0] },
  });
}

function track(lock: boolean, frames: number[]): { footX: number[]; rootX: number[] } {
  const rt = new SceneRuntime(makeDoc(lock));
  const footX: number[] = [];
  const rootX: number[] = [];
  const maxF = Math.max(...frames);
  for (let f = 0; f <= maxF; f++) {
    const st = rt.computeFrameState(f);
    if (frames.includes(f)) {
      footX.push(mat4.getTranslation(st.nodes.find((n) => n.id === "foot")!.worldMatrix)[0]);
      rootX.push(mat4.getTranslation(st.nodes.find((n) => n.id === "root")!.worldMatrix)[0]);
    }
  }
  return { footX, rootX };
}

describe("stance locking (ik.lock)", () => {
  it("pins the planted foot's world position while the clip sweeps it back", () => {
    const { footX, rootX } = track(true, [0, 5, 10]);
    // Foot world X stays at its plant position (0) throughout stance…
    for (const x of footX) expect(x).toBeCloseTo(0, 6);
    // …which forces the root to advance by the swept amount.
    expect(rootX[2]!).toBeCloseTo(0.5, 6);
  });

  it("without lock the foot slides backward instead", () => {
    const { footX, rootX } = track(false, [10]);
    expect(footX[0]!).toBeCloseTo(-0.5, 6); // full slide
    expect(rootX[0]!).toBeCloseTo(0, 6); // root never moves
  });

  it("keeps the accumulated offset after the foot lifts (no snap-back)", () => {
    const { rootX } = track(true, [10, 16]);
    // At f16 the foot is airborne and the clip has moved it forward — the root must NOT return.
    expect(rootX[1]!).toBeCloseTo(rootX[0]!, 6);
  });

  it("keeps walking forward across loop wraps (stride accumulates per cycle)", () => {
    const { rootX } = track(true, [10, 39]);
    // The looping clip re-enters stance each cycle; the offset keeps growing stride by stride.
    expect(rootX[1]!).toBeGreaterThan(rootX[0]! + 0.2);
  });

  it("is deterministic on replay", () => {
    expect(track(true, [7, 23, 35])).toEqual(track(true, [7, 23, 35]));
  });
});
