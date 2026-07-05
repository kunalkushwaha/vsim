import { describe, it, expect } from "vitest";
import { scene } from "./index.js";
import { evaluateTrack } from "@vsim/core";

describe("lipsync()", () => {
  const build = (beats: number[], opts?: Parameters<ReturnType<typeof scene>["lipsync"]>[3]) =>
    scene({ fps: 30, duration: 90, width: 8, height: 8 })
      .mesh("face", { geometry: { kind: "box" } })
      .lipsync("face", "mouthOpen", beats, opts)
      .camera({ position: [0, 0, 5], lookAt: [0, 0, 0] })
      .build();

  it("emits a morph track that peaks on each beat and returns to zero between them", () => {
    const doc = build([10, 40], { attack: 2, hold: 3, release: 5 });
    const track = doc.animation.find((t) => t.target.path === "morph.mouthOpen")!;
    expect(track.target.nodeId).toBe("face");
    expect(evaluateTrack(track, 9)).toBe(0); // before the beat
    expect(evaluateTrack(track, 12)).toBe(1); // attack complete
    expect(evaluateTrack(track, 15)).toBe(1); // holding
    expect(evaluateTrack(track, 20)).toBe(0); // released
    expect(evaluateTrack(track, 30)).toBe(0); // silence between beats
    expect(evaluateTrack(track, 42)).toBe(1); // second beat peaks too
  });

  it("overlapping beats merge instead of fluttering shut", () => {
    const doc = build([10, 13], { attack: 2, hold: 2, release: 6 });
    const track = doc.animation.find((t) => t.target.path === "morph.mouthOpen")!;
    // Between the two beats the mouth must stay open (max of both envelopes), never dip to 0.
    for (let f = 12; f <= 17; f++) {
      expect(evaluateTrack(track, f) as number).toBeGreaterThan(0.5);
    }
  });

  it("scales by weight and stays deterministic", () => {
    const doc = build([5], { weight: 0.6 });
    const track = doc.animation.find((t) => t.target.path === "morph.mouthOpen")!;
    expect(evaluateTrack(track, 7)).toBeCloseTo(0.6, 10);
    expect(build([5], { weight: 0.6 })).toEqual(doc);
  });
});
