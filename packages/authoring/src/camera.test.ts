import { describe, it, expect } from "vitest";
import { SceneRuntime } from "@vsim/core";
import { scene } from "./index.js";

describe("authoring cinematography sugar", () => {
  it("addCamera + shot cut between cameras over the timeline", () => {
    const doc = scene({ fps: 30, duration: 30, width: 100, height: 100 })
      .addCamera("wide", { position: [0, 2, 10], lookAt: [0, 0, 0] })
      .addCamera("close", { position: [0, 1, 3], lookAt: [0, 0, 0] })
      .shot("wide", 0, 14)
      .shot("close", 15, 29)
      .camera({ position: [0, 0, 5], lookAt: [0, 0, 0] })
      .build();
    const rt = new SceneRuntime(doc);
    expect(rt.computeFrameState(5).camera.position).toEqual([0, 2, 10]); // wide
    expect(rt.computeFrameState(20).camera.position).toEqual([0, 1, 3]); // close
  });

  it("orbit preset circles the target", () => {
    const doc = scene({ fps: 30, duration: 30, width: 100, height: 100 })
      .orbit("orb", { target: [0, 0, 0], radius: 5, height: 2, startFrame: 0, endFrame: 30 })
      .shot("orb", 0, 30)
      .camera({ position: [0, 0, 5] })
      .build();
    const rt = new SceneRuntime(doc);
    const p0 = rt.computeFrameState(0).camera.position;
    const pHalf = rt.computeFrameState(15).camera.position;
    expect(p0[0]).toBeCloseTo(5, 4); // starts at +radius on X
    expect(p0[2]).toBeCloseTo(0, 4);
    expect(p0[1]).toBeCloseTo(2, 4); // at the requested height
    expect(pHalf[0]).toBeLessThan(0); // half a revolution → swung to the far side
  });
});
