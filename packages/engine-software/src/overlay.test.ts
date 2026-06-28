import { describe, it, expect } from "vitest";
import { parseDocument, SceneRuntime } from "@vsim/core";
import { SoftwareEngine } from "./index.js";

// Render a frame of a doc (no 3D unless added) and return the RGBA buffer + a pixel accessor.
function render(input: Parameters<typeof parseDocument>[0], frame = 0) {
  const doc = parseDocument(input);
  const eng = new SoftwareEngine(doc.meta.width, doc.meta.height);
  eng.init(doc);
  eng.renderFrame(new SceneRuntime(doc).computeFrameState(frame));
  const px = eng.readPixels();
  const w = doc.meta.width;
  const lum = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    return px[p]! + px[p + 1]! + px[p + 2]!;
  };
  return { px, lum, w, h: doc.meta.height };
}

const base = {
  meta: { durationFrames: 30, width: 200, height: 80, background: [0, 0, 0] as [number, number, number] },
  camera: { nodeId: "__camera", lookAt: [0, 0, 0] as [number, number, number] },
  nodes: [{ id: "__camera", position: [0, 0, 5] as [number, number, number] }],
};

describe("text overlays", () => {
  it("paints white text over a black background (some pixels light up)", () => {
    const { lum, w, h } = render({ ...base, overlays: [{ id: "t", text: "HELLO", size: 48, color: [1, 1, 1] }] });
    // Scan the central band where the centered title sits.
    let lit = 0, maxL = 0;
    for (let y = Math.floor(h * 0.25); y < Math.floor(h * 0.75); y++)
      for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++) {
        const l = lum(x, y);
        if (l > 200) lit++;
        if (l > maxL) maxL = l;
      }
    expect(maxL).toBeGreaterThan(700); // near-white glyph pixels (3×~255)
    expect(lit).toBeGreaterThan(50); // a meaningful number of covered pixels
    expect(lum(0, 0)).toBe(0); // a corner stays background
  });

  it("opacity 0 draws nothing; a background box darkens-to-fills behind text", () => {
    const blank = render({ ...base, overlays: [{ id: "t", text: "HELLO", size: 48, opacity: 0 }] });
    let any = 0;
    for (let i = 0; i < blank.px.length; i += 4) any += blank.px[i]!;
    expect(any).toBe(0); // fully transparent overlay → untouched black frame

    // An opaque box over a black bg lifts a wide region above pure black.
    const boxed = render({
      ...base,
      overlays: [{ id: "t", text: ".", size: 30, color: [1, 1, 1], box: { color: [0.5, 0.5, 0.5], opacity: 1, padding: 20 } }],
    });
    expect(boxed.lum(boxed.w >> 1, boxed.h >> 1)).toBeGreaterThan(300); // gray box present at center
  });

  it("resolves and animates overlay properties (opacity track) via the runtime", () => {
    const doc = parseDocument({
      ...base,
      overlays: [{ id: "title", text: "Hi", opacity: 0 }],
      animation: [
        { target: { overlayId: "title", path: "opacity" }, keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 1 }] },
      ],
    });
    const rt = new SceneRuntime(doc);
    expect(rt.computeFrameState(0).overlays[0]!.opacity).toBeCloseTo(0);
    expect(rt.computeFrameState(5).overlays[0]!.opacity).toBeCloseTo(0.5);
    expect(rt.computeFrameState(10).overlays[0]!.opacity).toBeCloseTo(1);
  });
});
