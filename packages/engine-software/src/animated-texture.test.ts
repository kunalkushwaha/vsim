import { describe, it, expect } from "vitest";
import { parseDocument, SceneRuntime } from "@vsim/core";
import { SoftwareEngine } from "./index.js";

// A full-screen quad whose texture is a 1x1 frame sequence: red, then blue. A
// "texture.frame" track must flip the rendered color between frames.
const solid = (r: number, g: number, b: number) => ({ width: 1, height: 1, data: new Uint8Array([r, g, b, 255]) });
const doc = parseDocument({
  meta: { durationFrames: 2, width: 8, height: 8, background: [0, 0, 0] },
  materials: [{ id: "m", color: [1, 1, 1], roughness: 1 }],
  nodes: [
    {
      id: "screen",
      mesh: {
        geometry: {
          kind: "mesh",
          data: {
            positions: [-5, -5, 0, 5, -5, 0, 5, 5, 0, -5, 5, 0],
            normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
            uvs: [0, 1, 1, 1, 1, 0, 0, 0],
            indices: [0, 1, 2, 0, 2, 3],
            texture: solid(0, 255, 0), // fallback (unused when frames exist)
            textureFrames: [solid(255, 0, 0), solid(0, 0, 255)],
          },
        },
        materialId: "m",
      },
    },
    { id: "cam", position: [0, 0, 3], light: undefined },
    { id: "sun", light: { type: "ambient", intensity: 1 } },
  ],
  camera: { nodeId: "cam", lookAt: [0, 0, 0], fov: 60 },
  animation: [{ target: { nodeId: "screen", path: "texture.frame" }, keyframes: [{ frame: 0, value: 0 }, { frame: 1, value: 1 }] }],
});

describe("animated textures (texture.frame track)", () => {
  it("selects the active frame per rendered frame", () => {
    const rt = new SceneRuntime(doc);
    const eng = new SoftwareEngine(8, 8, { supersample: 1, shadows: false });
    eng.init(doc);
    eng.renderFrame(rt.computeFrameState(0));
    const f0 = eng.readPixels().slice(4 * (8 * 4 + 4), 4 * (8 * 4 + 4) + 3); // center pixel
    eng.renderFrame(rt.computeFrameState(1));
    const f1 = eng.readPixels().slice(4 * (8 * 4 + 4), 4 * (8 * 4 + 4) + 3);
    expect(f0[0]!).toBeGreaterThan(f0[2]!); // frame 0: red dominates
    expect(f1[2]!).toBeGreaterThan(f1[0]!); // frame 1: blue dominates
  });

  it("selects the intended frame on interpolated (non-keyframe) frames despite lerp drift", () => {
    // A linear 0→22 ramp evaluates to 14.999999999999998 at frame 15; a bare floor would
    // render stale frame 14. Frame 15 is blue in this strip, frame 14 red.
    const strip = Array.from({ length: 23 }, (_, i) => (i === 15 ? solid(0, 0, 255) : solid(255, 0, 0)));
    const base = structuredClone(doc) as never as typeof doc;
    (base.nodes[0]!.mesh!.geometry as { data: { textureFrames: unknown } }).data.textureFrames = strip;
    const ramped = parseDocument({
      ...base,
      meta: { ...base.meta, durationFrames: 23 },
      animation: [{ target: { nodeId: "screen", path: "texture.frame" }, keyframes: [{ frame: 0, value: 0 }, { frame: 22, value: 22 }] }],
    } as never);
    const rt = new SceneRuntime(ramped);
    const eng = new SoftwareEngine(8, 8, { supersample: 1, shadows: false });
    eng.init(ramped);
    eng.renderFrame(rt.computeFrameState(15));
    const px = eng.readPixels().slice(4 * (8 * 4 + 4), 4 * (8 * 4 + 4) + 3);
    expect(px[2]!).toBeGreaterThan(px[0]!); // frame 15 (blue), not stale frame 14 (red)
  });

  it("clamps out-of-range frame indices instead of crashing", () => {
    const rt = new SceneRuntime(parseDocument({ ...structuredClone(doc), animation: [{ target: { nodeId: "screen", path: "texture.frame" }, keyframes: [{ frame: 0, value: 99 }] }] } as never));
    const eng = new SoftwareEngine(8, 8, { supersample: 1, shadows: false });
    eng.init(doc);
    eng.renderFrame(rt.computeFrameState(0));
    const px = eng.readPixels().slice(4 * (8 * 4 + 4), 4 * (8 * 4 + 4) + 3);
    expect(px[2]!).toBeGreaterThan(px[0]!); // clamped to the LAST frame (blue)
  });
});
