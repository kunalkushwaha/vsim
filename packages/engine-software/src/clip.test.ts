import { describe, it, expect } from "vitest";
import { parseDocument, SceneRuntime } from "@vsim/core";
import { SoftwareEngine } from "./index.js";

/**
 * Near-plane clipping. The camera sits inside a long box ("tunnel"). Each side wall is a single
 * quad spanning from well behind the camera to well in front, so all four straddle the near
 * plane. The old renderer dropped any triangle with a vertex behind the camera, so the tunnel
 * walls vanished and most of the frame stayed background; with clipping the walls enclose the
 * frustum and fill it.
 */
function tunnelDoc() {
  return parseDocument({
    meta: { fps: 30, durationFrames: 1, width: 96, height: 64, background: [0, 0, 0] },
    materials: [{ id: "wall", color: [0.8, 0.8, 0.8] }],
    // Ambient light only, so every wall is lit regardless of which way it faces.
    nodes: [
      { id: "lt", light: { type: "ambient", intensity: 0.7 } },
      { id: "tunnel", mesh: { geometry: { kind: "box", size: [8, 8, 40] }, materialId: "wall" }, position: [0, 0, 0] },
      { id: "__camera", position: [0, 0, 0] },
    ],
    camera: { nodeId: "__camera", lookAt: [0, 0, 1], fov: 60 },
  });
}

function backgroundFraction(px: Uint8ClampedArray): number {
  let bg = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) bg++;
  }
  return bg / (px.length / 4);
}

describe("near-plane clipping", () => {
  it("renders walls that straddle the near plane instead of dropping them", () => {
    const doc = tunnelDoc();
    const eng = new SoftwareEngine(doc.meta.width, doc.meta.height);
    eng.init(doc);
    const rt = new SceneRuntime(doc);
    eng.renderFrame(rt.computeFrameState(0));

    // Enclosed by the tunnel, essentially every pixel should hit a wall. Without near-plane
    // clipping the straddling side walls would be dropped, leaving the frame mostly background.
    expect(backgroundFraction(eng.readPixels())).toBeLessThan(0.02);
    eng.dispose();
  });
});
