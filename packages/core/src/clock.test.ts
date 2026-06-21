import { describe, it, expect } from "vitest";
import { Clock } from "./clock.js";

describe("Clock", () => {
  it("derives dt and subDt from fps and substeps", () => {
    const c = new Clock({ fps: 30, substeps: 4 });
    expect(c.dt).toBeCloseTo(1 / 30);
    expect(c.subDt).toBeCloseTo(1 / 120);
  });

  it("calls onStep substeps*frames times", () => {
    const c = new Clock({ fps: 30, substeps: 4 });
    let steps = 0;
    c.advanceTo(10, () => steps++);
    expect(steps).toBe(10 * 4);
    expect(c.frame).toBe(10);
  });

  it("computes time from the current frame", () => {
    const c = new Clock({ fps: 60 });
    c.advanceTo(30, () => {});
    expect(c.time).toBeCloseTo(0.5);
  });

  it("refuses to advance backwards", () => {
    const c = new Clock({ fps: 30 });
    c.advanceTo(5, () => {});
    expect(() => c.advanceTo(2, () => {})).toThrow(/forward/);
  });

  it("resets to replay", () => {
    const c = new Clock({ fps: 30 });
    c.advanceTo(5, () => {});
    c.reset();
    expect(c.frame).toBe(0);
    let steps = 0;
    c.advanceTo(5, () => steps++);
    expect(steps).toBe(5);
  });
});
