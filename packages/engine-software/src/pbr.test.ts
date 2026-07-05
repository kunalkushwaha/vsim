import { describe, it, expect } from "vitest";
import { parseDocument, SceneRuntime, type MeshData, type SceneDocument } from "@vsim/core";
import { SoftwareEngine } from "./index.js";

/** 1×1 RGBA texture. */
const texel = (r: number, g: number, b: number) => ({ width: 1, height: 1, data: new Uint8Array([r, g, b, 255]) });

/** A camera-facing quad (XY plane, +Z normal), UV-mapped, carrying the given PBR maps. */
function quad(maps: Partial<MeshData>): MeshData {
  return {
    positions: [-1, 1, 0, 1, 1, 0, 1, -1, 0, -1, -1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    indices: [0, 1, 2, 0, 2, 3],
    ...maps,
  };
}

function renderQuad(maps: Partial<MeshData>, doc: Partial<SceneDocument["meta"]> & { nodes?: unknown[] } = {}): Uint8ClampedArray {
  const parsed = parseDocument({
    meta: { durationFrames: 1, width: 32, height: 32, background: [0, 0, 0] },
    materials: [{ id: "m", color: [0.5, 0.5, 0.5], roughness: 1, metalness: 1 }],
    nodes: [
      { id: "q", mesh: { geometry: { kind: "box" }, materialId: "m" } },
      ...(doc.nodes ?? []),
    ],
    camera: { nodeId: "__camera", lookAt: [0, 0, 0], fov: 45 },
  });
  const eng = new SoftwareEngine(32, 32);
  eng.init(parsed);
  eng.loadMesh("q", quad(maps));
  eng.renderFrame(new SceneRuntime(parsed).computeFrameState(0));
  return eng.readPixels();
}

const center = (px: Uint8ClampedArray) => {
  const p = (16 * 32 + 16) * 4;
  return [px[p]!, px[p + 1]!, px[p + 2]!] as const;
};

describe("PBR texture maps (software renderer)", () => {
  it("normal map: a sideways-pointing normal turns a lit quad dark and vice versa", () => {
    // Light shines straight at the quad (+Z normal). Flat map (128,128,255) keeps it lit;
    // a map pointing hard +X (255,128,128) swings the normal ~90° away from the light.
    const light = [{ id: "sun", light: { type: "directional", intensity: 1, direction: [0, 0, -1] } }, { id: "__camera", position: [0, 0, 3] }];
    const flat = center(renderQuad({ normalMap: texel(128, 128, 255) }, { nodes: light }));
    const bent = center(renderQuad({ normalMap: texel(255, 128, 128) }, { nodes: light }));
    expect(flat[0]).toBeGreaterThan(bent[0] + 60);
  });

  it("metallic-roughness map: low-roughness texel produces a hotter specular peak", () => {
    // Point light + glancing view; roughness comes from the map's G channel (factor 1).
    const nodes = [
      { id: "lamp", position: [0, 0, 2.5], light: { type: "point", intensity: 0.5 } },
      { id: "__camera", position: [0, 0, 3] },
    ];
    const peak = (px: Uint8ClampedArray) => {
      let m = 0;
      for (let i = 0; i < px.length; i += 4) m = Math.max(m, px[i]! + px[i + 1]! + px[i + 2]!);
      return m;
    };
    const glossy = peak(renderQuad({ metallicRoughnessMap: texel(0, 40, 0) }, { nodes }));
    const rough = peak(renderQuad({ metallicRoughnessMap: texel(0, 235, 0) }, { nodes }));
    expect(glossy).toBeGreaterThan(rough + 30);
  });

  it("occlusion map: darkens ambient light by its R channel", () => {
    const nodes = [{ id: "amb", light: { type: "ambient", intensity: 1 } }, { id: "__camera", position: [0, 0, 3] }];
    const open = center(renderQuad({ occlusionMap: texel(255, 255, 255) }, { nodes }));
    const occluded = center(renderQuad({ occlusionMap: texel(64, 64, 64) }, { nodes }));
    expect(open[0]).toBeGreaterThan(occluded[0] + 40);
  });

  it("emissive map: glows with no lights at all", () => {
    const nodes = [{ id: "__camera", position: [0, 0, 3] }];
    const px = renderQuad({ emissiveMap: texel(255, 40, 40) }, { nodes });
    const [r, g] = center(px);
    expect(r).toBeGreaterThan(180);
    expect(r).toBeGreaterThan(g + 100);
  });

  it("perspective-correct UVs: stripe spacing compresses toward the horizon on a tilted quad", () => {
    // A deep floor quad (two triangles) receding from the camera, textured with regular stripes
    // along v. Affine (screen-space) interpolation spaces the stripes evenly per triangle; true
    // perspective mapping compresses them hyperbolically with distance. We scan a screen column
    // and require each successive stripe interval (walking toward the horizon) to be no wider
    // than the previous one, with real compression overall.
    const stripes = { width: 1, height: 64, data: new Uint8Array(64 * 4) };
    for (let y = 0; y < 64; y++) {
      const on = y % 8 < 4 ? 255 : 0;
      stripes.data.set([on, on, on, 255], y * 4);
    }
    const floor: MeshData = {
      positions: [-4, 0, 0, 4, 0, 0, 4, 0, -30, -4, 0, -30],
      normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      indices: [0, 1, 2, 0, 2, 3],
      texture: stripes,
    };
    const doc = parseDocument({
      meta: { durationFrames: 1, width: 48, height: 64, background: [0, 0, 1] },
      materials: [{ id: "m", color: [1, 1, 1] }],
      nodes: [
        { id: "floor", mesh: { geometry: { kind: "box" }, materialId: "m" } },
        { id: "amb", light: { type: "ambient", intensity: 1 } },
        { id: "__camera", position: [0, 1.2, 2.5] },
      ],
      camera: { nodeId: "__camera", lookAt: [0, 0, -6], fov: 50 },
    });
    const eng = new SoftwareEngine(48, 64, { supersample: 1 });
    eng.init(doc);
    eng.loadMesh("floor", floor);
    eng.renderFrame(new SceneRuntime(doc).computeFrameState(0));
    const px = eng.readPixels();
    // Walk up the center column, collecting stripe boundaries (black↔white transitions on the
    // floor). The quad doesn't reach the bottom of frame, so first seek its near edge, then
    // scan toward the horizon until the background reappears.
    const isBg = (y: number) => {
      const p = (y * 48 + 24) * 4;
      return px[p + 2] === 255 && px[p]! < 40; // blue background
    };
    let y = 63;
    while (y >= 0 && isBg(y)) y--;
    const boundaries: number[] = [];
    let prev = -1;
    for (; y >= 0 && !isBg(y); y--) {
      const on = px[(y * 48 + 24) * 4]! > 127 ? 1 : 0;
      if (prev !== -1 && on !== prev) boundaries.push(y);
      prev = on;
    }
    expect(boundaries.length).toBeGreaterThanOrEqual(4);
    const gaps: number[] = [];
    for (let i = 1; i < boundaries.length; i++) gaps.push(boundaries[i - 1]! - boundaries[i]!);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeLessThanOrEqual(gaps[i - 1]! + 1);
    expect(gaps[gaps.length - 1]!).toBeLessThan(gaps[0]!); // genuine hyperbolic compression
  });

  it("mipmaps: a distant high-frequency checker converges to grey instead of aliasing", () => {
    // A deep floor tiled with a fine checker (uv wraps 16×). Near the camera the pattern shows
    // real contrast (base mip); far away, one pixel spans many texels — with trilinear mips the
    // samples average toward mid-grey, without them adjacent pixels alias to random extremes.
    const checker = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4) };
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const on = (x + y) % 2 ? 255 : 0;
        checker.data.set([on, on, on, 255], (y * 32 + x) * 4);
      }
    const floor: MeshData = {
      positions: [-6, 0, 0, 6, 0, 0, 6, 0, -60, -6, 0, -60],
      normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      uvs: [0, 0, 3, 0, 3, 16, 0, 16], // ≈isotropic texel density on the 12×60 quad
      indices: [0, 1, 2, 0, 2, 3],
      texture: checker,
    };
    const doc = parseDocument({
      meta: { durationFrames: 1, width: 48, height: 64, background: [0, 0, 1] },
      materials: [{ id: "m", color: [1, 1, 1] }],
      nodes: [
        { id: "floor", mesh: { geometry: { kind: "box" }, materialId: "m" } },
        { id: "amb", light: { type: "ambient", intensity: 1 } },
        { id: "__camera", position: [0, 1.2, 2.5] },
      ],
      camera: { nodeId: "__camera", lookAt: [0, 0, -8], fov: 50 },
    });
    const eng = new SoftwareEngine(48, 64, { supersample: 1 });
    eng.init(doc);
    eng.loadMesh("floor", floor);
    eng.renderFrame(new SceneRuntime(doc).computeFrameState(0));
    const px = eng.readPixels();
    const row = (y: number) => {
      const vals: number[] = [];
      for (let x = 12; x < 36; x++) {
        const p = (y * 48 + x) * 4;
        if (!(px[p + 2] === 255 && px[p]! < 40)) vals.push(px[p]!);
      }
      return vals;
    };
    // Find the topmost (farthest) floor row and a near row.
    let farY = 0;
    while (farY < 64 && row(farY).length < 12) farY++;
    const far = row(farY + 1);
    const near = row(60).length ? row(60) : row(50);
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    // Far band: heavy minification → mips average the checker out; spread collapses.
    expect(spread(far)).toBeLessThan(80);
    // Near band: base mip keeps real black↔white contrast.
    expect(spread(near)).toBeGreaterThan(150);
  });

  it("is deterministic with all maps active", () => {
    const maps = {
      texture: texel(200, 150, 100),
      normalMap: texel(180, 128, 220),
      metallicRoughnessMap: texel(0, 120, 60),
      occlusionMap: texel(200, 200, 200),
      emissiveMap: texel(30, 10, 10),
    };
    const nodes = [
      { id: "sun", light: { type: "directional", intensity: 0.8, direction: [-0.3, -0.4, -1] } },
      { id: "amb", light: { type: "ambient", intensity: 0.3 } },
      { id: "__camera", position: [0, 0, 3] },
    ];
    const a = renderQuad(maps, { nodes });
    const b = renderQuad(maps, { nodes });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
