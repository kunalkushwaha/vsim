import { describe, it, expect } from "vitest";
import { parseDocument, type SceneDocument } from "./document.js";
import { SceneRuntime } from "./runtime.js";

/**
 * The graphics→animation transition and clip-to-clip crossfade. Test rig: joint "j" whose bind
 * pose is identity; clips hold constant rotations about Z, so `worldMatrix[0]` = cos(angle)
 * reads the blended angle directly (1 at bind/identity, 0 at 90°).
 */
const HALF = Math.SQRT1_2; // sin/cos 45°
const ROT90 = [0, 0, HALF, HALF]; // quat: 90° about Z
const IDENT = [0, 0, 0, 1];

type NodeInput = Record<string, unknown>;

/** A 30-frame doc with joint "j", the given host-node clip fields, and the given clips. */
function docWith(host: NodeInput, clips: { id: string; values: number[] }[]): SceneDocument {
  return parseDocument({
    meta: { durationFrames: 30, width: 8, height: 8 },
    nodes: [{ id: "j" }, { id: "host", ...host }, { id: "__camera", position: [0, 0, 5] }],
    clips: clips.map((c) => ({
      id: c.id,
      durationFrames: 30,
      channels: [{ jointNodeId: "j", path: "rotation", times: [0], values: c.values }],
    })),
    camera: { nodeId: "__camera", lookAt: [0, 0, 0] },
  });
}

/** worldMatrix[0] of joint "j" at `frame` (forward-stepped) = cos(blended Z angle). */
function m0At(doc: SceneDocument, frame: number): number {
  const rt = new SceneRuntime(doc);
  let m0 = NaN;
  for (let f = 0; f <= frame; f++) {
    m0 = rt.computeFrameState(f).nodes.find((n) => n.id === "j")!.worldMatrix[0]!;
  }
  return m0;
}

const legacyBlendDoc = (blendInFrames: number) =>
  docWith({ clip: { clipId: "c", startFrame: 10, blendInFrames } }, [{ id: "c", values: ROT90 }]);

describe("clip blend-in (graphics → animation transition)", () => {
  it("holds the static bind pose before the clip starts", () => {
    expect(m0At(legacyBlendDoc(10), 9)).toBeCloseTo(1, 6);
  });

  it("without blendInFrames the pose snaps at startFrame", () => {
    expect(m0At(legacyBlendDoc(0), 10)).toBeCloseTo(0, 6); // instantly the clip's 90° pose
  });

  it("starts the blend at the bind pose and eases through the midpoint", () => {
    expect(m0At(legacyBlendDoc(10), 10)).toBeCloseTo(1, 6); // w=0 → still bind pose
    // Halfway (frame 15): smoothstep(0.5)=0.5 → slerp midpoint → 45°.
    expect(m0At(legacyBlendDoc(10), 15)).toBeCloseTo(Math.cos(Math.PI / 4), 5);
    // Early (frame 12): raw=0.2 → smoothstep≈0.104 → still close to the bind pose.
    expect(m0At(legacyBlendDoc(10), 12)).toBeGreaterThan(Math.cos(Math.PI / 8));
  });

  it("reaches the full clip pose when the blend completes", () => {
    expect(m0At(legacyBlendDoc(10), 20)).toBeCloseTo(0, 6);
    expect(m0At(legacyBlendDoc(10), 25)).toBeCloseTo(0, 6);
  });

  it("is deterministic: two runs produce identical matrices mid-blend", () => {
    expect(m0At(legacyBlendDoc(10), 13)).toBe(m0At(legacyBlendDoc(10), 13));
  });
});

describe("clip-to-clip crossfade (clips[])", () => {
  // Clip A holds 90° from frame 0; clip B holds identity, starting at 10 with a 10-frame fade.
  const AB = [
    { id: "A", values: ROT90 },
    { id: "B", values: IDENT },
  ];
  const crossDoc = () =>
    docWith(
      { clips: [{ clipId: "A", startFrame: 0 }, { clipId: "B", startFrame: 10, blendInFrames: 10 }] },
      AB,
    );

  it("plays the first clip alone before the second starts", () => {
    expect(m0At(crossDoc(), 5)).toBeCloseTo(0, 6); // full 90° from clip A
    expect(m0At(crossDoc(), 10)).toBeCloseTo(0, 6); // B at w=0 contributes nothing
  });

  it("passes through the slerp midpoint at the eased halfway frame", () => {
    expect(m0At(crossDoc(), 15)).toBeCloseTo(Math.cos(Math.PI / 4), 5); // 45°
  });

  it("lands fully on the second clip when the fade completes", () => {
    expect(m0At(crossDoc(), 20)).toBeCloseTo(1, 6); // back to identity
    expect(m0At(crossDoc(), 28)).toBeCloseTo(1, 6);
  });

  it("a single-entry clips[] behaves exactly like the legacy clip field", () => {
    const listDoc = docWith(
      { clips: [{ clipId: "c", startFrame: 10, blendInFrames: 10 }] },
      [{ id: "c", values: ROT90 }],
    );
    for (const f of [9, 10, 15, 20]) expect(m0At(listDoc, f)).toBeCloseTo(m0At(legacyBlendDoc(10), f), 10);
  });

  it("an EMPTY clips[] falls back to the legacy clip field instead of silencing it", () => {
    const doc = docWith(
      { clip: { clipId: "c", startFrame: 0 }, clips: [] },
      [{ id: "c", values: ROT90 }],
    );
    expect(m0At(doc, 5)).toBeCloseTo(0, 6); // the legacy clip plays
  });

  it("composites by startFrame order, not array order", () => {
    const shuffled = docWith(
      // B (the later clip) listed FIRST — must still fade in over A, not be buried under it.
      { clips: [{ clipId: "B", startFrame: 10, blendInFrames: 10 }, { clipId: "A", startFrame: 0 }] },
      AB,
    );
    for (const f of [5, 15, 20]) expect(m0At(shuffled, f)).toBeCloseTo(m0At(crossDoc(), f), 10);
  });

  it("skips fully-masked earlier playbacks without changing the result", () => {
    // After frame 20, B is at w=1 and covers A's only channel — the masked-skip fast path.
    // Behavior must be identical to the naive layering (B's pose, exactly).
    expect(m0At(crossDoc(), 24)).toBeCloseTo(1, 10);
  });
});
