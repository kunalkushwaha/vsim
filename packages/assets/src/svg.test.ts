import { describe, it, expect } from "vitest";
import { svgToMesh, parsePathD } from "./svg.js";

const STAR = `<svg viewBox="0 0 100 100"><path fill="#e5b34a" d="M50 5 L61 38 L95 38 L67 59 L78 92 L50 71 L22 92 L33 59 L5 38 L39 38 Z"/></svg>`;
const CURVED = `<svg viewBox="0 0 10 10"><path fill="#336699" d="M1 9 C 1 1, 9 1, 9 9 Z"/></svg>`;

describe("svgToMesh", () => {
  it("triangulates a concave star and extrudes front/back/sides", () => {
    const [m] = svgToMesh(STAR, { depth: 0.1 });
    expect(m!.color[0]).toBeGreaterThan(m!.color[2]); // gold: red > blue (linearized)
    const front = 10, wall = 4 * 10;
    expect(m!.positions.length / 3).toBe(front * 2 + wall); // outline twice + 4 verts per edge wall
    expect(m!.indices.length).toBe(8 * 3 * 2 + 10 * 6); // 8 ear-clipped tris per face + 2 tris per wall
    // Front-face normals all +z, back all -z.
    expect(m!.normals.slice(0, 3)).toEqual([0, 0, 1]);
    expect(m!.normals.slice(front * 3, front * 3 + 3)).toEqual([0, 0, -1]);
  });

  it("stands art upright on y=0 with viewBox-normalized height", () => {
    const [m] = svgToMesh(STAR, { depth: 0, height: 2 });
    const ys = m!.positions.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(2);
    expect(Math.max(...ys)).toBeGreaterThan(1.8); // top of the star reaches near `height`
  });

  it("flattens curves at a fixed resolution — deterministic across calls", () => {
    const a = JSON.stringify(svgToMesh(CURVED));
    const b = JSON.stringify(svgToMesh(CURVED));
    expect(a).toBe(b);
    expect(svgToMesh(CURVED)[0]!.positions.length / 3).toBeGreaterThan(12); // curve got segments
  });

  it("parses relative commands and implicit lineto after moveto", () => {
    const contours = parsePathD("m 1 1 2 0 0 2 h -2 z");
    expect(contours).toHaveLength(1);
    expect(contours[0]).toEqual([[1, 1], [3, 1], [3, 3], [1, 3]]);
  });

  it("rejects unsupported commands and shapeless SVGs with clear errors", () => {
    expect(() => parsePathD("M0 0 A 5 5 0 0 1 10 10")).toThrow(/unsupported path command "A"/);
    expect(() => svgToMesh(`<svg viewBox="0 0 1 1"></svg>`)).toThrow(/no fillable/);
    expect(() => svgToMesh(`<svg><path fill="#fff" d="M0 0 L1 0 L1 1 Z"/></svg>`)).toThrow(/viewBox/);
  });
});

describe("review-pass regressions", () => {
  it("side walls face outward regardless of authored winding (CW star == CCW star)", () => {
    const CW = `<svg viewBox="0 0 100 100"><path fill="#e5b34a" d="M50 5 L61 38 L95 38 L67 59 L78 92 L50 71 L22 92 L33 59 L5 38 L39 38 Z"/></svg>`;
    const [m] = svgToMesh(CW, { depth: 0.1 });
    // Centroid of the outline; every wall normal must point away from it.
    const n = 10, front = m!.positions.slice(0, n * 3);
    const cx = front.filter((_, i) => i % 3 === 0).reduce((a, b) => a + b, 0) / n;
    const cy = front.filter((_, i) => i % 3 === 1).reduce((a, b) => a + b, 0) / n;
    for (let w = 0; w < n; w++) {
      const base = (n * 2 + w * 4) * 3; // first wall vertex of edge w
      const [px, py] = [m!.positions[base]!, m!.positions[base + 1]!];
      const [nx, ny] = [m!.normals[base]!, m!.normals[base + 1]!];
      expect(nx * (px - cx) + ny * (py - cy), `wall ${w} points inward`).toBeGreaterThan(0);
    }
  });
});
