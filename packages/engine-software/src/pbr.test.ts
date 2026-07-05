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
