import { describe, it, expect } from "vitest";
import { parseDocument, SceneRuntime } from "@vsim/core";
import { SoftwareEngine } from "./index.js";

// A small emissive square on a dark field: bloom must leak light past its edges,
// and a banded render must stitch byte-identically to a full-frame one.
const mk = (bloom: boolean) => parseDocument({
  meta: { durationFrames: 2, width: 64, height: 64, background: [0, 0, 0], ...(bloom ? { bloom: { threshold: 0.5, strength: 1, radius: 5 } } : {}) },
  materials: [{ id: "hot", color: [0, 0, 0], emissive: [4, 3, 1] }],
  nodes: [
    { id: "sq", mesh: { geometry: { kind: "plane", size: [1, 1] }, materialId: "hot" }, rotation: [Math.PI / 2, 0, 0] },
    { id: "cam", position: [0, 0, 4] },
    { id: "amb", light: { type: "ambient", intensity: 0.05 } },
  ],
  camera: { nodeId: "cam", lookAt: [0, 0, 0], fov: 40 },
});

const px = (buf: Uint8ClampedArray, x: number, y: number) => buf[(y * 64 + x) * 4]!;

describe("bloom", () => {
  it("bleeds bright pixels into a halo (opt-in only)", () => {
    const render = (bloom: boolean) => {
      const doc = mk(bloom);
      const eng = new SoftwareEngine(64, 64, { supersample: 2, shadows: false });
      eng.init(doc);
      eng.renderFrame(new SceneRuntime(doc).computeFrameState(0));
      return eng.readPixels();
    };
    const off = render(false), on = render(true);
    // Just OUTSIDE the square's edge (square spans y≈22..43): dark without bloom, glowing with it.
    expect(px(off, 32, 16)).toBeLessThan(10);
    expect(px(on, 32, 16)).toBeGreaterThan(px(off, 32, 16) + 30);
    // The square core stays saturated either way.
    expect(px(on, 32, 32)).toBeGreaterThan(200);
  });

  it("banded render with bloom stitches byte-identically to full-frame", () => {
    const doc = mk(true);
    const full = new SoftwareEngine(64, 64, { supersample: 2, shadows: false });
    full.init(doc);
    full.renderFrame(new SceneRuntime(doc).computeFrameState(0));
    const whole = full.readPixels();

    const stitched = new Uint8ClampedArray(whole.length);
    for (const [y0, y1] of [[0, 22], [22, 43], [43, 64]] as const) {
      const band = new SoftwareEngine(64, 64, { supersample: 2, shadows: false, region: { y0, y1 } });
      band.init(doc);
      band.renderFrame(new SceneRuntime(doc).computeFrameState(0));
      stitched.set(band.readPixels().subarray(y0 * 64 * 4, y1 * 64 * 4), y0 * 64 * 4);
    }
    expect(Buffer.from(stitched).equals(Buffer.from(whole))).toBe(true);
  });
});
