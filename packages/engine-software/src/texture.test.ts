import { describe, it, expect } from "vitest";
import { parseDocument, SceneRuntime, type MeshData } from "@vsim/core";
import { SoftwareEngine } from "./index.js";

// 2×2 texture: TL red, TR green, BL blue, BR white (row 0 = top).
const TEX = {
  width: 2,
  height: 2,
  data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
};

// A camera-facing quad (XY plane, +Z normal) with UVs mapping the texture across it.
const QUAD: MeshData = {
  positions: [-1, 1, 0, 1, 1, 0, 1, -1, 0, -1, -1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  uvs: [0, 0, 1, 0, 1, 1, 0, 1],
  indices: [0, 1, 2, 0, 2, 3],
  texture: TEX,
};

function render(withTexture: boolean): Uint8ClampedArray {
  const doc = parseDocument({
    meta: { durationFrames: 1, width: 64, height: 64, background: [0, 0, 0] },
    materials: [{ id: "m", color: [0.9, 0.1, 0.6] }], // magenta — used only when untextured
    nodes: [
      { id: "q", mesh: { geometry: { kind: "box", size: [1, 1, 1] }, materialId: "m" } },
      { id: "amb", light: { type: "ambient", intensity: 1 } }, // full white fill → albedo shows directly
      { id: "__camera", position: [0, 0, 3] },
    ],
    camera: { nodeId: "__camera", lookAt: [0, 0, 0], fov: 45 },
  });
  const eng = new SoftwareEngine(doc.meta.width, doc.meta.height);
  eng.init(doc);
  eng.loadMesh("q", withTexture ? QUAD : { ...QUAD, uvs: undefined, texture: undefined });
  eng.renderFrame(new SceneRuntime(doc).computeFrameState(0));
  return eng.readPixels();
}

/** Is there a pixel matching a predicate? (Tolerance, since bilinear blends near texel edges.) */
function any(px: Uint8ClampedArray, pred: (r: number, g: number, b: number) => boolean): boolean {
  for (let i = 0; i < px.length; i += 4) if (pred(px[i]!, px[i + 1]!, px[i + 2]!)) return true;
  return false;
}
const redish = (r: number, g: number, b: number) => r > 180 && g < 80 && b < 80;
const greenish = (r: number, g: number, b: number) => g > 180 && r < 80 && b < 80;
const bluish = (r: number, g: number, b: number) => b > 180 && r < 80 && g < 80;
const whitish = (r: number, g: number, b: number) => r > 200 && g > 200 && b > 200;

describe("textured rasterization", () => {
  it("samples the texture: all four texel colors appear on the quad", () => {
    const px = render(true);
    expect(any(px, redish)).toBe(true);
    expect(any(px, greenish)).toBe(true);
    expect(any(px, bluish)).toBe(true);
    expect(any(px, whitish)).toBe(true);
  });

  it("without a texture the same quad is the flat material color (no texel colors)", () => {
    const px = render(false);
    expect(any(px, redish)).toBe(false);
    expect(any(px, greenish)).toBe(false);
    expect(any(px, bluish)).toBe(false);
  });

  it("is deterministic", () => {
    expect(Buffer.from(render(true)).equals(Buffer.from(render(true)))).toBe(true);
  });
});
