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

describe("shadow mapping", () => {
  // A box floating above a large ground plane, sun slanted so its shadow falls BESIDE the box
  // in the top-down view: box at world x=-2, height 2 → shadow lands around world x=0 (screen
  // center), while world x=+3 is open sunlit ground.
  const doc = () =>
    parseDocument({
      meta: { durationFrames: 1, width: 64, height: 64, background: [0, 0, 0] },
      materials: [{ id: "g", color: [0.6, 0.6, 0.6] }, { id: "b", color: [0.6, 0.2, 0.2] }],
      nodes: [
        { id: "ground", mesh: { geometry: { kind: "plane", size: [20, 20] }, materialId: "g" } },
        { id: "box", mesh: { geometry: { kind: "box", size: [1.5, 0.3, 1.5] }, materialId: "b" }, position: [-2, 2, 0] },
        { id: "sun", light: { type: "directional", intensity: 1, direction: [1, -1, 0] } },
        { id: "amb", light: { type: "ambient", intensity: 0.15 } },
        { id: "__camera", position: [0, 14, 0.01] },
      ],
      camera: { nodeId: "__camera", lookAt: [0, 0, 0], fov: 45 },
    });

  const SHADOWED: [number, number] = [32, 32]; // world x≈0 — inside the cast shadow
  const LIT: [number, number] = [48, 32]; // world x≈+3 — open ground

  it("darkens ground where the occluder blocks the sun; open ground stays lit", () => {
    const eng = new SoftwareEngine(64, 64);
    eng.init(doc());
    eng.renderFrame(new SceneRuntime(doc()).computeFrameState(0));
    const px = eng.readPixels();
    expect(lumAt(px, 64, ...LIT)).toBeGreaterThan(lumAt(px, 64, ...SHADOWED) + 60);
  });

  it("can be disabled via the option", () => {
    const on = new SoftwareEngine(64, 64);
    on.init(doc());
    on.renderFrame(new SceneRuntime(doc()).computeFrameState(0));
    const off = new SoftwareEngine(64, 64, { shadows: false });
    off.init(doc());
    off.renderFrame(new SceneRuntime(doc()).computeFrameState(0));
    expect(Buffer.from(on.readPixels()).equals(Buffer.from(off.readPixels()))).toBe(false);
    // Without shadows the two ground samples match (both fully sunlit).
    const px = off.readPixels();
    expect(Math.abs(lumAt(px, 64, ...SHADOWED) - lumAt(px, 64, ...LIT))).toBeLessThan(6);
  });

  it("is deterministic across independent renders", () => {
    const r = () => {
      const eng = new SoftwareEngine(64, 64);
      eng.init(doc());
      eng.renderFrame(new SceneRuntime(doc()).computeFrameState(0));
      return Buffer.from(eng.readPixels());
    };
    expect(r().equals(r())).toBe(true);
  });

  it("bilinear PCF: the shadow edge ramps smoothly and monotonically into the light", () => {
    // Single-sample engine (so supersampling can't be the source of the smoothness) and a
    // deliberately tiny shadow map, making one shadow texel span multiple output pixels.
    // Scanning the center row from inside the cast shadow (world x≈0) toward open ground (+x):
    // luminance must never decrease, and the transition must pass through intermediate values
    // (a hard binary comparison would quantize to texel-sized steps).
    const eng = new SoftwareEngine(64, 64, { supersample: 1, shadowMapSize: 8 });
    eng.init(doc());
    eng.renderFrame(new SceneRuntime(doc()).computeFrameState(0));
    const px = eng.readPixels();
    const scan: number[] = [];
    for (let x = 30; x <= 52; x++) scan.push(lumAt(px, 64, x, 32));
    for (let i = 1; i < scan.length; i++) expect(scan[i]!).toBeGreaterThanOrEqual(scan[i - 1]! - 1);
    const dark = scan[0]!, lit = scan[scan.length - 1]!;
    const mid = scan.filter((v) => v > dark + 20 && v < lit - 20).length;
    expect(lit).toBeGreaterThan(dark + 60);
    expect(mid).toBeGreaterThanOrEqual(2); // a real penumbra, not a binary step
  });
});

describe("transparency (material opacity)", () => {
  // A half-transparent red panel in front of a white panel; ambient light only.
  const doc = (opacity: number) =>
    parseDocument({
      meta: { durationFrames: 1, width: 32, height: 32, background: [0, 0, 0] },
      materials: [
        { id: "glass", color: [1, 0, 0], opacity },
        { id: "wall", color: [1, 1, 1] },
      ],
      nodes: [
        { id: "wall", mesh: { geometry: { kind: "plane", size: [4, 4] }, materialId: "wall" }, position: [0, 0, -1], rotation: [Math.PI / 2, 0, 0] },
        { id: "glass", mesh: { geometry: { kind: "plane", size: [2, 2] }, materialId: "glass" }, rotation: [Math.PI / 2, 0, 0] },
        { id: "amb", light: { type: "ambient", intensity: 1 } },
        { id: "__camera", position: [0, 0, 3] },
      ],
      camera: { nodeId: "__camera", lookAt: [0, 0, 0], fov: 45 },
    });

  it("blends the surface over what's behind it instead of occluding", () => {
    const px = render(doc(0.5));
    const p = (16 * 32 + 16) * 4;
    // Linear blend 0.5·red(1,0,0) + 0.5·white(1,1,1) → (1, .5, .5) → gamma ≈ (255, 186, 186).
    expect(px[p]!).toBe(255);
    expect(Math.abs(px[p + 1]! - 186)).toBeLessThanOrEqual(3);
    expect(px[p + 1]).toBe(px[p + 2]);
  });

  it("opacity 1 stays fully opaque (red only, wall hidden)", () => {
    const px = render(doc(1));
    const p = (16 * 32 + 16) * 4;
    expect(px[p]!).toBe(255);
    expect(px[p + 1]!).toBe(0);
  });

  it("transparent surfaces don't cast shadows (opaque ones do)", () => {
    // Slanted sun throws the panel's would-be shadow to +x, clear of the panel itself in the
    // top-down view — so the sampled ground region is never seen THROUGH the glass.
    const shadowDoc = (opacity: number) =>
      parseDocument({
        meta: { durationFrames: 1, width: 64, height: 64, background: [0, 0, 0] },
        materials: [{ id: "g", color: [0.6, 0.6, 0.6] }, { id: "glass", color: [1, 0, 0], opacity }],
        nodes: [
          { id: "ground", mesh: { geometry: { kind: "plane", size: [20, 20] }, materialId: "g" } },
          { id: "panel", mesh: { geometry: { kind: "box", size: [1.5, 0.3, 1.5] }, materialId: "glass" }, position: [-2, 2, 0] },
          { id: "sun", light: { type: "directional", intensity: 1, direction: [1, -1, 0] } },
          { id: "amb", light: { type: "ambient", intensity: 0.15 } },
          { id: "__camera", position: [0, 14, 0.01] },
        ],
        camera: { nodeId: "__camera", lookAt: [0, 0, 0], fov: 45 },
      });
    const shadowSpot = (px: Uint8ClampedArray) => px[(32 * 64 + 32) * 4]!; // world x≈0
    const openSpot = (px: Uint8ClampedArray) => px[(32 * 64 + 48) * 4]!; // world x≈+3
    const glass = render(shadowDoc(0.4));
    const solid = render(shadowDoc(1));
    expect(openSpot(solid) - shadowSpot(solid)).toBeGreaterThan(40); // opaque panel casts
    expect(Math.abs(openSpot(glass) - shadowSpot(glass))).toBeLessThan(6); // glass doesn't
  });

  it("is deterministic", () => {
    expect(Buffer.from(render(doc(0.5))).equals(Buffer.from(render(doc(0.5))))).toBe(true);
  });
});

describe("ACES tone mapping (meta.tone)", () => {
  // An overbright emissive panel (HDR value 4.0) next to a mid-grey panel, no lights.
  const doc = (tone?: "none" | "aces") =>
    parseDocument({
      meta: { durationFrames: 1, width: 32, height: 32, background: [0, 0, 0], ...(tone ? { tone } : {}) },
      materials: [
        { id: "hot", color: [0, 0, 0], emissive: [4, 4, 4] },
        { id: "mid", color: [0, 0, 0], emissive: [0.5, 0.18, 0.18] },
      ],
      nodes: [
        { id: "left", mesh: { geometry: { kind: "box" }, materialId: "hot" }, position: [-0.8, 0, 0] },
        { id: "right", mesh: { geometry: { kind: "box" }, materialId: "mid" }, position: [0.8, 0, 0] },
        { id: "__camera", position: [0, 0, 4] },
      ],
      camera: { nodeId: "__camera", lookAt: [0, 0, 0], fov: 45 },
    });

  it("defaults to none — byte-identical to an explicit tone:'none'", () => {
    expect(Buffer.from(render(doc())).equals(Buffer.from(render(doc("none"))))).toBe(true);
  });

  it("rolls off HDR highlights instead of clipping, and keeps them brighter than mid-tones", () => {
    const raw = render(doc("none"));
    const aces = render(doc("aces"));
    const at = (px: Uint8ClampedArray, x: number) => px[(16 * 32 + x) * 4]!;
    expect(at(raw, 8)).toBe(255); // HDR 4.0 hard-clips without tone mapping
    expect(at(aces, 8)).toBeLessThan(255); // filmic rolloff keeps headroom
    expect(at(aces, 8)).toBeGreaterThan(200); // …but it still reads as very bright
    expect(at(aces, 8)).toBeGreaterThan(at(aces, 24)); // brighter than the mid-grey panel
  });

  it("is deterministic", () => {
    expect(Buffer.from(render(doc("aces"))).equals(Buffer.from(render(doc("aces"))))).toBe(true);
  });
});

describe("distance fog", () => {
  // Two identical boxes, near and far, ambient light only: the far one must be tinted toward
  // the fog color; without fog both shade identically.
  const doc = (fog: boolean) =>
    parseDocument({
      meta: { durationFrames: 1, width: 64, height: 64, background: [0, 0, 0] },
      environment: fog ? { fog: { color: [1, 0, 0], near: 2, far: 20 } } : undefined,
      materials: [{ id: "m", color: [0.2, 0.6, 0.2] }],
      nodes: [
        { id: "near", mesh: { geometry: { kind: "box", size: [1, 1, 1] }, materialId: "m" }, position: [-1.2, 0, 0] },
        { id: "far", mesh: { geometry: { kind: "box", size: [1, 1, 1] }, materialId: "m" }, position: [4, 0, -14] },
        { id: "amb", light: { type: "ambient", intensity: 0.8 } },
        { id: "__camera", position: [0, 0, 4] },
      ],
      camera: { nodeId: "__camera", lookAt: [0, 0, -4], fov: 50 },
    });

  const sample = (px: Uint8ClampedArray, x: number, y: number) =>
    [px[(y * 64 + x) * 4]!, px[(y * 64 + x) * 4 + 1]!] as const;

  it("tints distant geometry toward the fog color", () => {
    const px = render(doc(true));
    // Find one pixel of each box by color signature: near = green-dominant, far = red-shifted.
    let nearGreenRatio = 0, farRedRatio = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const [r, g] = sample(px, x, y);
        if (r === 0 && g === 0) continue; // background
        const ratio = r / Math.max(g, 1);
        if (x < 32) nearGreenRatio = Math.max(nearGreenRatio, g);
        else farRedRatio = Math.max(farRedRatio, ratio);
      }
    }
    expect(nearGreenRatio).toBeGreaterThan(100); // near box still green
    expect(farRedRatio).toBeGreaterThan(1.5); // far box pushed toward red fog
  });

  it("no fog → both boxes shade identically per-face", () => {
    const px = render(doc(false));
    let maxRatio = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 32; x < 64; x++) {
        const [r, g] = sample(px, x, y);
        if (r === 0 && g === 0) continue;
        maxRatio = Math.max(maxRatio, r / Math.max(g, 1));
      }
    }
    expect(maxRatio).toBeLessThan(1); // stays green-dominant with ambient-only shading
  });
});
