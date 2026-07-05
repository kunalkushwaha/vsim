import { describe, it, expect } from "vitest";
import { parseDocument } from "./document.js";
import { SceneRuntime } from "./runtime.js";

/**
 * The graphics→animation transition: `blendInFrames` eases a skeleton from its static bind pose
 * into a playing clip instead of snapping. The clip here holds a constant 90°-about-Z rotation
 * on joint "j" (bind pose = identity), starting at frame 10 with a 10-frame blend.
 */
const HALF = Math.SQRT1_2; // sin/cos 45°

function makeDoc(blendInFrames: number) {
  return parseDocument({
    meta: { durationFrames: 30, width: 8, height: 8 },
    nodes: [
      { id: "j" },
      { id: "host", clip: { clipId: "c", startFrame: 10, blendInFrames } },
      { id: "__camera", position: [0, 0, 5] },
    ],
    clips: [
      {
        id: "c",
        durationFrames: 10,
        channels: [{ jointNodeId: "j", path: "rotation", times: [0], values: [0, 0, HALF, HALF] }],
      },
    ],
    camera: { nodeId: "__camera", lookAt: [0, 0, 0] },
  });
}

/** m[0] of the joint's world matrix = cos(angle about Z): 1 at bind, cos45° halfway, 0 at 90°. */
function cosAtFrame(blendInFrames: number, frame: number): number {
  const rt = new SceneRuntime(makeDoc(blendInFrames));
  let m0 = NaN;
  for (let f = 0; f <= frame; f++) {
    const state = rt.computeFrameState(f);
    m0 = state.nodes.find((n) => n.id === "j")!.worldMatrix[0]!;
  }
  return m0;
}

describe("clip blend-in (graphics → animation transition)", () => {
  it("holds the static bind pose before the clip starts", () => {
    expect(cosAtFrame(10, 9)).toBeCloseTo(1, 6);
  });

  it("without blendInFrames the pose snaps at startFrame", () => {
    expect(cosAtFrame(0, 10)).toBeCloseTo(0, 6); // instantly the clip's 90° pose
  });

  it("starts the blend at the bind pose and eases through the midpoint", () => {
    expect(cosAtFrame(10, 10)).toBeCloseTo(1, 6); // w=0 → still bind pose
    // Halfway (frame 15): smoothstep(0.5)=0.5 → slerp midpoint → 45°.
    expect(cosAtFrame(10, 15)).toBeCloseTo(Math.cos(Math.PI / 4), 5);
    // Quarter (frame 12.5 isn't a frame; frame 12: raw=0.2 → smoothstep=0.104 → ~9.4°).
    expect(cosAtFrame(10, 12)).toBeGreaterThan(Math.cos(Math.PI / 8)); // eased: still close to bind
  });

  it("reaches the full clip pose when the blend completes", () => {
    expect(cosAtFrame(10, 20)).toBeCloseTo(0, 6);
    expect(cosAtFrame(10, 25)).toBeCloseTo(0, 6);
  });

  it("is deterministic: two runs produce identical matrices mid-blend", () => {
    expect(cosAtFrame(10, 13)).toBe(cosAtFrame(10, 13));
  });
});

/**
 * Clip-to-clip crossfade via `clips[]`: clip A holds 90° about Z from frame 0; clip B holds the
 * identity pose and starts at frame 10 with a 10-frame blend — so the joint swings 90° → 0°.
 */
function crossfadeDoc() {
  return parseDocument({
    meta: { durationFrames: 30, width: 8, height: 8 },
    nodes: [
      { id: "j" },
      {
        id: "host",
        clips: [
          { clipId: "A", startFrame: 0 },
          { clipId: "B", startFrame: 10, blendInFrames: 10 },
        ],
      },
      { id: "__camera", position: [0, 0, 5] },
    ],
    clips: [
      { id: "A", durationFrames: 30, channels: [{ jointNodeId: "j", path: "rotation", times: [0], values: [0, 0, HALF, HALF] }] },
      { id: "B", durationFrames: 30, channels: [{ jointNodeId: "j", path: "rotation", times: [0], values: [0, 0, 0, 1] }] },
    ],
    camera: { nodeId: "__camera", lookAt: [0, 0, 0] },
  });
}

function crossCosAt(frame: number): number {
  const rt = new SceneRuntime(crossfadeDoc());
  let m0 = NaN;
  for (let f = 0; f <= frame; f++) {
    m0 = rt.computeFrameState(f).nodes.find((n) => n.id === "j")!.worldMatrix[0]!;
  }
  return m0;
}

describe("clip-to-clip crossfade (clips[])", () => {
  it("plays the first clip alone before the second starts", () => {
    expect(crossCosAt(5)).toBeCloseTo(0, 6); // full 90° from clip A
    expect(crossCosAt(10)).toBeCloseTo(0, 6); // B at w=0 still contributes nothing
  });

  it("passes through the slerp midpoint at the eased halfway frame", () => {
    expect(crossCosAt(15)).toBeCloseTo(Math.cos(Math.PI / 4), 5); // 45°
  });

  it("lands fully on the second clip when the fade completes", () => {
    expect(crossCosAt(20)).toBeCloseTo(1, 6); // back to identity
    expect(crossCosAt(28)).toBeCloseTo(1, 6);
  });

  it("a single-entry clips[] behaves exactly like the legacy clip field", () => {
    const legacy = makeDoc(10);
    const listDoc = parseDocument({
      ...JSON.parse(JSON.stringify({ ...legacy, nodes: undefined })),
      nodes: legacy.nodes.map((n) =>
        n.id === "host" ? { id: "host", clips: [{ clipId: "c", startFrame: 10, blendInFrames: 10 }] } : { id: n.id, position: n.position },
      ),
    });
    const at = (doc: ReturnType<typeof parseDocument>, frame: number) => {
      const rt = new SceneRuntime(doc);
      let m0 = NaN;
      for (let f = 0; f <= frame; f++) m0 = rt.computeFrameState(f).nodes.find((n) => n.id === "j")!.worldMatrix[0]!;
      return m0;
    };
    for (const f of [9, 10, 15, 20]) expect(at(listDoc, f)).toBeCloseTo(at(legacy, f), 10);
  });
});
