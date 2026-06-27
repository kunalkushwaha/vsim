import { describe, it, expect } from "vitest";
import { tessellate } from "./geometry.js";

/** Bounding box of a flat positions array. */
function bounds(p: number[]) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[i + k]!);
      hi[k] = Math.max(hi[k]!, p[i + k]!);
    }
  return { lo, hi };
}

const validIndices = (m: { positions: number[]; indices: number[] }) =>
  m.indices.length % 3 === 0 && m.indices.every((i) => i >= 0 && i < m.positions.length / 3);

describe("cylinder geometry", () => {
  it("tessellates to a capped cylinder with the right extent", () => {
    const m = tessellate({ kind: "cylinder", radius: 0.5, height: 2, segments: 16 });
    expect(m.indices.length).toBeGreaterThan(0);
    expect(validIndices(m)).toBe(true);
    const { lo, hi } = bounds(m.positions);
    expect(hi[1]).toBeCloseTo(1); // height/2
    expect(lo[1]).toBeCloseTo(-1);
    expect(hi[0]).toBeCloseTo(0.5); // radius
    expect(lo[0]).toBeCloseTo(-0.5);
    expect(m.normals.length).toBe(m.positions.length);
  });
});

describe("cone geometry", () => {
  it("tessellates to a cone: apex at +h/2, base ring at radius", () => {
    const m = tessellate({ kind: "cone", radius: 1, height: 3, segments: 24 });
    expect(validIndices(m)).toBe(true);
    const { lo, hi } = bounds(m.positions);
    expect(hi[1]).toBeCloseTo(1.5); // apex (height/2)
    expect(lo[1]).toBeCloseTo(-1.5); // base
    expect(hi[0]).toBeCloseTo(1); // base radius
  });

  it("is deterministic", () => {
    const a = tessellate({ kind: "cone", radius: 1, height: 2, segments: 12 });
    const b = tessellate({ kind: "cone", radius: 1, height: 2, segments: 12 });
    expect(a.positions).toEqual(b.positions);
  });
});
