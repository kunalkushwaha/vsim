import { describe, it, expect } from "vitest";
import "@vsim/text/node"; // load the bundled font into the @vsim/text singleton for rasterizing
import { parseDocument, SceneRuntime } from "@vsim/core";
import { overlayDraw } from "./overlay-canvas.js";

// Resolve overlays through the runtime exactly as the Player does, then lay them out.
function resolved(input: Parameters<typeof parseDocument>[0], frame = 0) {
  const doc = parseDocument(input);
  return { doc, overlays: new SceneRuntime(doc).computeFrameState(frame).overlays };
}

const base = {
  meta: { durationFrames: 10, width: 200, height: 100 },
  camera: { nodeId: "c", lookAt: [0, 0, 0] as [number, number, number] },
  nodes: [{ id: "c", position: [0, 0, 5] as [number, number, number] }],
};

describe("overlayDraw (live-preview layout)", () => {
  it("tints text by color × opacity and centers it by default", () => {
    const { doc, overlays } = resolved({ ...base, overlays: [{ id: "t", text: "Hi", size: 40, color: [1, 1, 1], opacity: 0.5 }] });
    const d = overlayDraw(overlays[0]!, doc.meta.width, doc.meta.height)!;
    expect(d).not.toBeNull();
    // White at half opacity → some texel has alpha ≈ 127 and rgb ≈ 255.
    let maxA = 0, sawWhite = false;
    for (let i = 0; i < d.text.rgba.length; i += 4) {
      maxA = Math.max(maxA, d.text.rgba[i + 3]!);
      if (d.text.rgba[i]! === 255 && d.text.rgba[i + 3]! > 0) sawWhite = true;
    }
    expect(sawWhite).toBe(true);
    expect(maxA).toBeGreaterThan(110);
    expect(maxA).toBeLessThan(145); // capped near 0.5×255
    // Centered: the bitmap straddles the frame center horizontally.
    expect(d.text.dx).toBeLessThan(doc.meta.width / 2);
    expect(d.text.dx + d.text.width).toBeGreaterThan(doc.meta.width / 2);
  });

  it("emits a background box rect with combined alpha for a lower-third", () => {
    const { doc, overlays } = resolved({
      ...base,
      overlays: [{ id: "c", text: "Caption", x: 0.05, y: 0.85, align: "left", opacity: 0.8, box: { color: [0, 0, 0], opacity: 0.5, padding: 10 } }],
    });
    const d = overlayDraw(overlays[0]!, doc.meta.width, doc.meta.height)!;
    expect(d.box).toBeDefined();
    expect(d.box!.a).toBeCloseTo(0.4); // 0.5 box × 0.8 overlay
    expect(d.box!.w).toBeGreaterThan(d.text.width); // padding widens the box
    expect(d.box!.x).toBeLessThan(d.text.dx); // box starts left of the text
  });

  it("returns null for an invisible overlay", () => {
    const { doc, overlays } = resolved({ ...base, overlays: [{ id: "t", text: "x", opacity: 0 }] });
    expect(overlayDraw(overlays[0]!, doc.meta.width, doc.meta.height)).toBeNull();
  });
});
