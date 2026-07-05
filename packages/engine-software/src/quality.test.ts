import { describe, it, expect } from "vitest";
import { parseDocument, SceneRuntime, type SceneDocument } from "@vsim/core";
import { SoftwareEngine } from "./index.js";

function render(doc: SceneDocument, supersample?: number): Uint8ClampedArray {
  const eng = new SoftwareEngine(doc.meta.width, doc.meta.height, supersample ? { supersample } : {});
  eng.init(doc);
  eng.renderFrame(new SceneRuntime(doc).computeFrameState(0));
  return eng.readPixels();
}

function distinctColors(px: Uint8ClampedArray): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < px.length; i += 4) s.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
  return s;
}

const lumAt = (px: Uint8ClampedArray, w: number, x: number, y: number): number => {
  const p = (y * w + x) * 4;
  return px[p]! + px[p + 1]! + px[p + 2]!;
};

describe("supersampled anti-aliasing", () => {
  // Ambient-only cube on a black background: every face shades to the same flat color, so a
  // single-sample render has exactly two colors. Supersampling must add intermediate edge
  // blends without changing the two base colors.
  const doc = () =>
    parseDocument({
      meta: { durationFrames: 1, width: 64, height: 64, background: [0, 0, 0] },
      materials: [{ id: "m", color: [0.8, 0.4, 0.3] }],
      nodes: [
        { id: "cube", mesh: { geometry: { kind: "box", size: [1, 1, 1] }, materialId: "m" }, rotation: [0.5, 0.7, 0.2] },
        { id: "amb", light: { type: "ambient", intensity: 0.9 } },
        { id: "__camera", position: [0, 0, 4] },
      ],
      camera: { nodeId: "__camera", lookAt: [0, 0, 0] },
    });

  it("blends silhouette edges: base colors survive, intermediate colors appear", () => {
    const one = distinctColors(render(doc(), 1));
    const two = distinctColors(render(doc(), 2));
    expect(one.size).toBe(2); // background + flat ambient-lit cube
    expect(two.size).toBeGreaterThan(2); // plus edge blends
    for (const c of one) expect(two.has(c)).toBe(true); // interiors unchanged
  });

  it("defaults to 2× supersampling", () => {
    const eng = new SoftwareEngine(8, 8);
    expect(eng.supersample).toBe(2);
    expect(Buffer.from(render(doc())).equals(Buffer.from(render(doc(), 2)))).toBe(true);
  });
});

describe("per-pixel specular shading", () => {
  // A glossy ground plane lit by a point light directly above its center, seen from above. The
  // specular highlight falls in the plane's interior — under per-vertex (Gouraud) shading the
  // interior can never exceed the corner-interpolated brightness, so a bright center proves
  // both per-pixel evaluation and the specular lobe.
  const planeDoc = (roughness: number) =>
    parseDocument({
      meta: { durationFrames: 1, width: 48, height: 48, background: [0, 0, 0] },
      materials: [{ id: "m", color: [0.5, 0.5, 0.5], roughness }],
      nodes: [
        { id: "ground", mesh: { geometry: { kind: "plane", size: [10, 10] }, materialId: "m" } },
        { id: "lamp", position: [0, 3, 0], light: { type: "point", intensity: 0.35 } },
        { id: "__camera", position: [0, 8, 0.01] },
      ],
      camera: { nodeId: "__camera", lookAt: [0, 0, 0], fov: 50 },
    });

  it("shows an interior highlight brighter than every plane corner region", () => {
    const px = render(planeDoc(0.25));
    const center = lumAt(px, 48, 24, 24);
    for (const [x, y] of [[6, 6], [41, 6], [6, 41], [41, 41]] as const) {
      expect(center).toBeGreaterThan(lumAt(px, 48, x, y) + 30);
    }
  });

  it("rough surfaces get a dimmer peak highlight than glossy ones", () => {
    const glossy = render(planeDoc(0.2));
    const rough = render(planeDoc(0.9));
    const peak = (px: Uint8ClampedArray) => {
      let m = 0;
      for (let i = 0; i < px.length; i += 4) m = Math.max(m, px[i]! + px[i + 1]! + px[i + 2]!);
      return m;
    };
    expect(peak(glossy)).toBeGreaterThan(peak(rough) + 30);
  });

  it("is deterministic across independent renders", () => {
    expect(Buffer.from(render(planeDoc(0.3))).equals(Buffer.from(render(planeDoc(0.3))))).toBe(true);
  });
});
