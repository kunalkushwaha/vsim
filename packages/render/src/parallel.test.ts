import { describe, it, expect } from "vitest";
import { SceneRuntime, parseDocument } from "@vsim/core";
import { SoftwareEngine } from "@vsim/engine-software";
import { scene } from "@vsim/authoring";
import { ParallelRenderer } from "./parallel.js";

const DOC = scene({ fps: 30, duration: 8, width: 96, height: 72, background: [0.05, 0.06, 0.09] })
  .sky([0.3, 0.5, 0.9], [0.7, 0.8, 0.95], { sun: { size: 0.08 } })
  .material("c", { color: [0.9, 0.4, 0.4], roughness: 0.4 })
  .material("floor", { color: [0.15, 0.16, 0.2] })
  .light({ type: "ambient", intensity: 0.35 })
  .light({ type: "directional", intensity: 1.1, direction: [-0.5, -1, -0.4] })
  .mesh("floor", { geometry: { kind: "plane", size: [20, 20] }, material: "floor", position: [0, -1, 0] })
  .mesh("cube", { geometry: { kind: "box", size: [1.4, 1.4, 1.4] }, material: "c" })
  .animate("cube", "rotation.y", [{ frame: 0, value: 0 }, { frame: 8, value: 1.1 }])
  .camera({ position: [3, 2, 4.5], lookAt: [0, 0, 0], fov: 45 })
  .build();

describe("ParallelRenderer (R5.3 worker harness)", () => {
  it("renders frames across workers byte-identical to the sequential engine", async () => {
    const par = new ParallelRenderer();
    await par.init(DOC, 3);
    const seqEngine = new SoftwareEngine(96, 72);
    seqEngine.init(DOC);
    const rt = new SceneRuntime(DOC);
    try {
      for (let f = 0; f < 5; f++) {
        const [parallel] = await Promise.all([par.renderFrame(f)]);
        seqEngine.renderFrame(rt.computeFrameState(f));
        expect(Buffer.from(parallel).equals(Buffer.from(seqEngine.readPixels()))).toBe(true);
      }
    } finally {
      await par.dispose();
    }
  }, 60000);

  it("rejects physics scenes with a clear error", async () => {
    const doc = parseDocument({
      meta: { durationFrames: 2, width: 8, height: 8 },
      physics: { bodies: [{ nodeId: "b", collider: { shape: "sphere" } }] },
      nodes: [{ id: "b" }, { id: "__camera", position: [0, 0, 5] }],
      camera: { nodeId: "__camera", lookAt: [0, 0, 0] },
    });
    const par = new ParallelRenderer();
    await expect(par.init(doc, 2)).rejects.toThrow(/physics/);
  });
});
