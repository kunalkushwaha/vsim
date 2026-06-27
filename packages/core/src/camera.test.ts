import { describe, it, expect } from "vitest";
import { parseDocument } from "./document.js";
import { SceneRuntime } from "./runtime.js";
import { mat4 } from "./math.js";

describe("cinematography (multi-camera, shots, tracking)", () => {
  it("picks the active camera per frame from the shot timeline (else the default)", () => {
    const doc = parseDocument({
      meta: { durationFrames: 30, width: 100, height: 100 },
      nodes: [
        { id: "camA", position: [5, 0, 0] },
        { id: "camB", position: [-5, 0, 0] },
        { id: "camDef", position: [0, 0, 5] },
      ],
      camera: { id: "def", nodeId: "camDef", lookAt: [0, 0, 0] },
      cameras: [
        { id: "a", nodeId: "camA", lookAt: [0, 0, 0] },
        { id: "b", nodeId: "camB", lookAt: [0, 0, 0] },
      ],
      shots: [
        { cameraId: "a", startFrame: 0, endFrame: 10 },
        { cameraId: "b", startFrame: 11, endFrame: 20 },
      ],
    });
    const rt = new SceneRuntime(doc);
    expect(rt.computeFrameState(5).camera.position).toEqual([5, 0, 0]); // shot A → camA
    expect(rt.computeFrameState(15).camera.position).toEqual([-5, 0, 0]); // shot B → camB
    expect(rt.computeFrameState(25).camera.position).toEqual([0, 0, 5]); // no shot → default
  });

  it("tracks a moving node (lookAtNodeId) — the view aims at the node every frame", () => {
    const doc = parseDocument({
      meta: { durationFrames: 30, width: 100, height: 100 },
      nodes: [
        { id: "cam", position: [0, 0, 10] },
        { id: "target", position: [0, 0, 0] },
      ],
      camera: { id: "c", nodeId: "cam", lookAtNodeId: "target" },
      animation: [{ target: { nodeId: "target", path: "position.x" }, keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 5 }] }],
    });
    const rt = new SceneRuntime(doc);
    // At frame 10 the target is at x=5, so the camera at (0,0,10) should look toward (5,0,0).
    expect(rt.computeFrameState(10).camera.viewMatrix).toEqual(mat4.lookAt([0, 0, 10], [5, 0, 0], [0, 1, 0]));
  });

  it("animates a camera's fov via a camera-targeted track", () => {
    const doc = parseDocument({
      meta: { durationFrames: 30, width: 100, height: 100 },
      nodes: [{ id: "cam", position: [0, 0, 5] }],
      camera: { id: "c", nodeId: "cam", lookAt: [0, 0, 0], fov: 50 },
      animation: [{ target: { cameraId: "c", path: "fov" }, keyframes: [{ frame: 0, value: 30 }, { frame: 10, value: 90 }] }],
    });
    const rt = new SceneRuntime(doc);
    const f = (deg: number) => 1 / Math.tan(((deg * Math.PI) / 180) / 2); // projMatrix[5] for aspect 1
    expect(rt.computeFrameState(0).camera.projMatrix[5]!).toBeCloseTo(f(30), 5);
    expect(rt.computeFrameState(10).camera.projMatrix[5]!).toBeCloseTo(f(90), 5);
  });

  it("is deterministic across two runs (shot cut + tracking)", () => {
    const build = () =>
      parseDocument({
        meta: { durationFrames: 30, width: 80, height: 60 },
        nodes: [
          { id: "camA", position: [4, 2, 4] },
          { id: "camB", position: [-3, 1, 5] },
          { id: "hero", position: [0, 0, 0] },
        ],
        camera: { id: "a", nodeId: "camA", lookAtNodeId: "hero" },
        cameras: [{ id: "b", nodeId: "camB", lookAtNodeId: "hero" }],
        shots: [{ cameraId: "a", startFrame: 0, endFrame: 14 }, { cameraId: "b", startFrame: 15, endFrame: 29 }],
        animation: [{ target: { nodeId: "hero", path: "position.x" }, keyframes: [{ frame: 0, value: -2 }, { frame: 29, value: 2 }] }],
      });
    const a = new SceneRuntime(build()).computeFrameState(20).camera;
    const b = new SceneRuntime(build()).computeFrameState(20).camera;
    expect(a).toEqual(b);
  });
});
