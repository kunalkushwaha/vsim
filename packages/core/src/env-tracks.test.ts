import { describe, it, expect } from "vitest";
import { parseDocument, SceneRuntime } from "./index.js";

// Environment tracks: sky/fog/background animate per frame without touching the doc.
const doc = parseDocument({
  meta: { durationFrames: 60, width: 8, height: 8, background: [0, 0, 0] },
  environment: {
    sky: { type: "gradient", top: [0.2, 0.4, 0.9], bottom: [0.9, 0.8, 0.6], ambient: 0.5 },
    fog: { color: [0.8, 0.8, 0.8], near: 5, far: 30 },
  },
  nodes: [{ id: "cam", position: [0, 1, 3] }],
  camera: { nodeId: "cam", lookAt: [0, 0, 0], fov: 60 },
  animation: [
    { target: { environment: true, path: "sky.top" }, keyframes: [{ frame: 0, value: [0.2, 0.4, 0.9] }, { frame: 60, value: [0.02, 0.03, 0.09] }] },
    { target: { environment: true, path: "fog.near" }, keyframes: [{ frame: 0, value: 5 }, { frame: 60, value: 9 }] },
    { target: { environment: true, path: "sky.ambient" }, keyframes: [{ frame: 0, value: 0.5 }, { frame: 60, value: 0.1 }] },
    { target: { environment: true, path: "background" }, keyframes: [{ frame: 0, value: [0, 0, 0] }, { frame: 60, value: [0.5, 0.5, 0.5] }] },
  ],
});

describe("environment tracks", () => {
  it("lerps sky/fog/background per frame and re-derives the sky ambient", () => {
    const rt = new SceneRuntime(doc);
    const f0 = rt.computeFrameState(0);
    const f30 = rt.computeFrameState(30);
    const f60 = rt.computeFrameState(60);
    expect(f0.sky!.top).toEqual([0.2, 0.4, 0.9]);
    expect(f30.sky!.top[0]).toBeCloseTo(0.11, 5); // halfway
    expect(f60.sky!.top).toEqual([0.02, 0.03, 0.09]);
    expect(f30.fog!.near).toBeCloseTo(7, 5);
    expect(f60.background).toEqual([0.5, 0.5, 0.5]);
    // The synthetic sky-derived hemisphere follows the ANIMATED gradient + ambient.
    const hemi = (s: typeof f30) => s.lights.find((l) => l.type === "hemisphere")!;
    expect(hemi(f30).intensity).toBeCloseTo(0.3, 5);
    expect(hemi(f30).skyColor![0]).toBeCloseTo(0.11, 5);
    // The doc itself is untouched: frame 60 twice is identical (no accumulation).
    expect(rt.computeFrameState(60).sky!.top).toEqual([0.02, 0.03, 0.09]);
    expect(doc.environment!.sky!.type === "gradient" && doc.environment!.sky!.top).toEqual([0.2, 0.4, 0.9]);
  });
});
