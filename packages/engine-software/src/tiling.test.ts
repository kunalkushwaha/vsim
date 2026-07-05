import { describe, it, expect } from "vitest";
import { parseDocument, SceneRuntime, type SceneDocument } from "@vsim/core";
import { SoftwareEngine } from "./index.js";

/**
 * Tiled rendering (R5.3 core): N band engines, each restricted to a row region, must stitch to
 * a frame BYTE-IDENTICAL to a single full-frame engine — across shadows, textures, particles,
 * transparency, the sun disc, and manga outlines (the seam-sensitive one).
 */
function fullRender(doc: SceneDocument): Uint8ClampedArray {
  const eng = new SoftwareEngine(doc.meta.width, doc.meta.height);
  eng.init(doc);
  eng.renderFrame(new SceneRuntime(doc).computeFrameState(0));
  return eng.readPixels();
}

function tiledRender(doc: SceneDocument, bands: number): Uint8ClampedArray {
  const { width, height } = doc.meta;
  const out = new Uint8ClampedArray(width * height * 4);
  const step = Math.ceil(height / bands);
  for (let b = 0; b < bands; b++) {
    const y0 = b * step, y1 = Math.min(height, y0 + step);
    if (y0 >= y1) break;
    const eng = new SoftwareEngine(width, height, { region: { y0, y1 } });
    eng.init(doc);
    eng.renderFrame(new SceneRuntime(doc).computeFrameState(0));
    out.set(eng.readPixels().subarray(y0 * width * 4, y1 * width * 4), y0 * width * 4);
  }
  return out;
}

const baseDoc = (style: "realistic" | "manga") =>
  parseDocument({
    meta: { durationFrames: 1, width: 64, height: 64, style },
    environment: { sky: { type: "gradient", sun: { size: 0.1 } } },
    materials: [
      { id: "g", color: [0.5, 0.6, 0.4] },
      { id: "b", color: [0.7, 0.3, 0.2] },
      { id: "glass", color: [0.2, 0.4, 0.9], opacity: 0.5 },
    ],
    nodes: [
      { id: "ground", mesh: { geometry: { kind: "plane", size: [20, 20] }, materialId: "g" } },
      { id: "box", mesh: { geometry: { kind: "box", size: [1.2, 1.2, 1.2] }, materialId: "b" }, position: [-0.5, 0.6, 0] },
      { id: "pane", mesh: { geometry: { kind: "box", size: [1, 1.4, 0.1] }, materialId: "glass" }, position: [0.9, 0.7, 0.8] },
      { id: "sun", light: { type: "directional", intensity: 1, direction: [0.4, -0.8, 0.45] } },
      { id: "amb", light: { type: "ambient", intensity: 0.25 } },
      { id: "__camera", position: [2.5, 2, 3.5] },
    ],
    particles: [{ id: "dust", position: [0, 1.5, 0], spread: [1.5, 1, 1.5], count: 40, velocity: [0, -0.2, 0], gravity: [0, 0, 0], lifeFrames: 50, size: 0.04, seed: 5 }],
    camera: { nodeId: "__camera", lookAt: [0, 0.5, 0], fov: 45 },
  });

describe("banded tiled rendering (R5.3)", () => {
  for (const style of ["realistic", "manga"] as const) {
    for (const bands of [2, 4]) {
      it(`${bands} bands stitch byte-identical to a full render (${style})`, () => {
        const doc = baseDoc(style);
        expect(Buffer.from(tiledRender(doc, bands)).equals(Buffer.from(fullRender(doc)))).toBe(true);
      });
    }
  }
});
