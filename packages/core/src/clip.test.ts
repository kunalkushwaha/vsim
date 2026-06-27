import { describe, it, expect } from "vitest";
import { sampleChannel } from "./clip.js";
import { quatFromEuler } from "./math.js";
import type { ClipChannel } from "./document.js";

describe("sampleChannel", () => {
  it("step holds the previous key", () => {
    const ch: ClipChannel = {
      jointNodeId: "j",
      path: "translation",
      interpolation: "step",
      times: [0, 10],
      values: [0, 0, 0, 10, 0, 0],
    };
    expect(sampleChannel(ch, 0)).toEqual([0, 0, 0]);
    expect(sampleChannel(ch, 9)).toEqual([0, 0, 0]); // still the first key
    expect(sampleChannel(ch, 10)).toEqual([10, 0, 0]);
  });

  it("linear interpolates translation and clamps outside the range", () => {
    const ch: ClipChannel = {
      jointNodeId: "j",
      path: "translation",
      interpolation: "linear",
      times: [0, 10],
      values: [0, 0, 0, 10, 0, 0],
    };
    expect(sampleChannel(ch, -5)).toEqual([0, 0, 0]); // clamped to first
    expect(sampleChannel(ch, 5)).toEqual([5, 0, 0]); // midpoint
    expect(sampleChannel(ch, 99)).toEqual([10, 0, 0]); // clamped to last
  });

  it("linear rotation uses shortest-path slerp", () => {
    const q0 = quatFromEuler(0, 0, 0); // identity
    const q1 = quatFromEuler(0, 0, Math.PI / 2); // 90° about Z
    const ch: ClipChannel = {
      jointNodeId: "j",
      path: "rotation",
      interpolation: "linear",
      times: [0, 10],
      values: [...q0, ...q1],
    };
    const mid = sampleChannel(ch, 5); // should be ~45° about Z
    const q45 = quatFromEuler(0, 0, Math.PI / 4);
    for (let k = 0; k < 4; k++) expect(mid[k]!).toBeCloseTo(q45[k]!, 5);
  });

  it("cubicspline hermite-interpolates with tangents (flat tangents ≈ smoothstep)", () => {
    // Per glTF: each key is [inTangent, value, outTangent]. Zero tangents → Hermite with m=0.
    const ch: ClipChannel = {
      jointNodeId: "j",
      path: "translation",
      interpolation: "cubicspline",
      times: [0, 10],
      values: [
        0, 0, 0, /*in*/ 0, 0, 0 /*value*/, 0, 0, 0 /*out*/,
        0, 0, 0 /*in*/, 10, 0, 0 /*value*/, 0, 0, 0 /*out*/,
      ],
    };
    // Endpoints exact; midpoint = smoothstep(0.5)*10 = 5 with zero tangents.
    expect(sampleChannel(ch, 0)[0]!).toBeCloseTo(0, 6);
    expect(sampleChannel(ch, 10)[0]!).toBeCloseTo(10, 6);
    expect(sampleChannel(ch, 5)[0]!).toBeCloseTo(5, 6);
  });
});
