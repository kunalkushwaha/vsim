import { describe, it, expect } from "vitest";
import { parseDocument } from "./document.js";
import { SceneRuntime } from "./runtime.js";

/** Snow-like system: spawns above, falls under gravity; one-burst variant for lifecycle tests. */
function makeDoc(over: Record<string, unknown> = {}) {
  return parseDocument({
    meta: { durationFrames: 120, width: 8, height: 8 },
    particles: [{
      id: "snow",
      position: [0, 5, 0],
      spread: [2, 0, 2],
      count: 50,
      velocity: [0, -1, 0],
      velocitySpread: [0.2, 0.2, 0.2],
      gravity: [0, -2, 0],
      lifeFrames: 40,
      seed: 7,
      ...over,
    }],
    nodes: [{ id: "__camera", position: [0, 2, 10] }],
    camera: { nodeId: "__camera", lookAt: [0, 2, 0] },
  });
}

const at = (doc: ReturnType<typeof parseDocument>, frame: number) => {
  const rt = new SceneRuntime(doc);
  let out;
  for (let f = 0; f <= frame; f++) out = rt.computeFrameState(f).particles;
  return out!;
};

describe("deterministic particles", () => {
  it("is a pure function of the frame: identical across runs AND scrub-safe", () => {
    const a = at(makeDoc(), 25);
    const b = at(makeDoc(), 25);
    expect(a).toEqual(b);
    // Closed form: evaluating frame 25 directly (fresh runtime) matches forward-stepping.
    const direct = new SceneRuntime(makeDoc()).computeFrameState(25).particles;
    expect(direct).toEqual(a);
  });

  it("particles fall: tracking one particle across frames shows monotonically decreasing y", () => {
    // A zero-spread, zero-velocity-spread system so particle 0 is identifiable by index order.
    const doc = makeDoc({ spread: [0, 0, 0], velocitySpread: [0, 0, 0], count: 1, loop: false, lifeFrames: 30 });
    const ys: number[] = [];
    for (const f of [2, 8, 14, 20]) {
      const ps = at(doc, f);
      if (ps.length) ys.push(ps[0]!.position[1]);
    }
    expect(ys.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeLessThan(ys[i - 1]!);
  });

  it("one-burst systems die after their lifetime; looping systems keep a steady population", () => {
    const burst = makeDoc({ loop: false });
    expect(at(burst, 100).length).toBe(0); // startFrame 0 + life 40 + max stagger 40 < 100
    const loop = makeDoc({ loop: true });
    expect(at(loop, 100).length).toBeGreaterThan(30); // most of the 50 are alive at any time
  });

  it("nothing exists before startFrame", () => {
    expect(at(makeDoc({ startFrame: 60 }), 30).length).toBe(0);
  });

  it("fades out at end of life", () => {
    const doc = makeDoc({ spread: [0, 0, 0], velocitySpread: [0, 0, 0], count: 1, loop: false, lifeFrames: 40 });
    const early = at(doc, 10)[0]!;
    const late = at(doc, 38)[0]!;
    expect(early.opacity).toBe(1);
    expect(late.opacity).toBeLessThan(0.5);
  });
});

describe("streak particles", () => {
  it("emits velocity + streak only when configured", async () => {
    const { parseDocument, SceneRuntime } = await import("./index.js");
    const mk = (streak: number) => parseDocument({
      meta: { durationFrames: 30, width: 8, height: 8 },
      nodes: [{ id: "cam", position: [0, 0, 5] }],
      camera: { nodeId: "cam", lookAt: [0, 0, 0], fov: 60 },
      particles: [{ id: "p", count: 4, velocity: [0, -6, 0], gravity: [0, -2, 0], lifeFrames: 30, size: 0.05, seed: 3, ...(streak ? { streak } : {}) }],
    });
    const plain = new SceneRuntime(mk(0)).computeFrameState(15).particles;
    expect(plain.every((p) => p.velocity === undefined && p.streak === undefined)).toBe(true);
    const streaked = new SceneRuntime(mk(0.05)).computeFrameState(15).particles;
    expect(streaked.length).toBeGreaterThan(0);
    for (const p of streaked) {
      expect(p.streak).toBe(0.05);
      // Instantaneous velocity includes gravity·t: strictly faster downward than the initial mean ± spread(0.5 default… none set: velocitySpread default [0.5,0.5,0.5]).
      expect(p.velocity![1]).toBeLessThan(0);
    }
  });
});
