import { describe, it, expect } from "vitest";
import { evaluateTrack } from "./animation.js";
import type { Track } from "./document.js";

const track = (kfs: Track["keyframes"]): Track => ({ target: { path: "x" }, keyframes: kfs });

describe("evaluateTrack", () => {
  it("clamps before the first and after the last keyframe", () => {
    const t = track([
      { frame: 10, value: 5, easing: "linear" },
      { frame: 20, value: 15, easing: "linear" },
    ]);
    expect(evaluateTrack(t, 0)).toBe(5);
    expect(evaluateTrack(t, 100)).toBe(15);
  });

  it("interpolates linearly at the midpoint", () => {
    const t = track([
      { frame: 0, value: 0, easing: "linear" },
      { frame: 10, value: 100, easing: "linear" },
    ]);
    expect(evaluateTrack(t, 5)).toBeCloseTo(50);
  });

  it("applies easing from the arriving keyframe", () => {
    const t = track([
      { frame: 0, value: 0, easing: "linear" },
      { frame: 10, value: 100, easing: "easeIn" },
    ]);
    // easeIn at t=0.5 → 0.25 → 25
    expect(evaluateTrack(t, 5)).toBeCloseTo(25);
  });

  it("interpolates vectors component-wise", () => {
    const t = track([
      { frame: 0, value: [0, 0, 0], easing: "linear" },
      { frame: 10, value: [10, 20, 30], easing: "linear" },
    ]);
    expect(evaluateTrack(t, 5)).toEqual([5, 10, 15]);
  });

  it("supports cubic-bezier easing", () => {
    const t = track([
      { frame: 0, value: 0, easing: "linear" },
      { frame: 10, value: 1, easing: [0.42, 0, 0.58, 1] },
    ]);
    const mid = evaluateTrack(t, 5) as number;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});
