import { describe, it, expect } from "vitest";
import { parseDocument, SceneRuntime } from "@vsim/core";
import { SoftwareEngine } from "./index.js";

// Linear [0,1] → gamma-encoded 8-bit, matching the framebuffer's encoding.
const enc = (c: number) => Math.round(Math.pow(Math.min(Math.max(c, 0), 1), 1 / 2.2) * 255);

describe("environment", () => {
  it("renders a vertical gradient sky (top color at the top row, bottom at the bottom)", () => {
    const doc = parseDocument({
      meta: { durationFrames: 1, width: 8, height: 16 },
      environment: { sky: { type: "gradient", top: [0, 0, 1], bottom: [1, 0, 0] } }, // blue → red
      camera: { nodeId: "__camera", lookAt: [0, 0, 0] },
      nodes: [{ id: "__camera", position: [0, 0, 5] }],
    });
    const eng = new SoftwareEngine(doc.meta.width, doc.meta.height);
    eng.init(doc);
    eng.renderFrame(new SceneRuntime(doc).computeFrameState(0));
    const px = eng.readPixels();
    const at = (x: number, y: number) => [px[(y * 8 + x) * 4]!, px[(y * 8 + x) * 4 + 1]!, px[(y * 8 + x) * 4 + 2]!];

    expect(at(0, 0)).toEqual([enc(0), 0, enc(1)]); // top row = blue
    expect(at(0, 15)).toEqual([enc(1), 0, enc(0)]); // bottom row = red
    // Middle row is a blend of the two (red rising, blue falling).
    const mid = at(0, 8);
    expect(mid[0]).toBeGreaterThan(0);
    expect(mid[2]).toBeGreaterThan(0);
  });

  it("hemisphere light tints up- vs down-facing surfaces differently", () => {
    // A flat ground (normal +Y) lit only by a hemisphere light should take the sky tint.
    const doc = parseDocument({
      meta: { durationFrames: 1, width: 16, height: 16, background: [0, 0, 0] },
      materials: [{ id: "white", color: [1, 1, 1] }],
      nodes: [
        { id: "ground", mesh: { geometry: { kind: "plane", size: [20, 20] }, materialId: "white" }, position: [0, 0, 0] },
        { id: "hemi", light: { type: "hemisphere", intensity: 1, skyColor: [0, 1, 0], groundColor: [1, 0, 0] } },
        { id: "__camera", position: [0, 6, 0.01] },
      ],
      camera: { nodeId: "__camera", lookAt: [0, 0, 0] },
    });
    const eng = new SoftwareEngine(doc.meta.width, doc.meta.height);
    eng.init(doc);
    eng.renderFrame(new SceneRuntime(doc).computeFrameState(0));
    const px = eng.readPixels();
    const c = (px.length / 2) & ~3; // a center-ish pixel
    // Up-facing ground → sky tint (green) dominates over ground tint (red).
    expect(px[c + 1]!).toBeGreaterThan(px[c]!);
  });
});
