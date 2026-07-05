// SVG landmark → flat 3D mesh. The .svg files in ./landmarks are the BASE ARTIFACTS —
// plain vector art you can open, edit, or replace in any editor. This module parses their
// <polygon> elements, triangulates each (ear clipping — handles the concave silhouettes),
// and emits one inline mesh per fill color, standing upright like stage scenery.
// Everything is deterministic: same SVG bytes → same triangles → same pixels.
import { readFileSync } from "node:fs";

export interface LandmarkMesh {
  /** Linear-space RGB from the polygon's fill. */
  color: [number, number, number];
  positions: number[];
  normals: number[];
  indices: number[];
}

type Pt = [number, number];

/** sRGB "#rrggbb" → linear RGB. */
function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const s = (v: number) => Math.pow(v / 255, 2.2);
  return [s((n >> 16) & 255), s((n >> 8) & 255), s(n & 255)];
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function pointInTri(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Ear-clipping triangulation of a simple (possibly concave) polygon. Returns index triples. */
function earClip(pts: Pt[]): number[] {
  const idx = pts.map((_, i) => i);
  // Normalize to counter-clockwise (positive signed area).
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % pts.length]!;
    area += x1 * y2 - x2 * y1;
  }
  if (area < 0) idx.reverse();

  const tris: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!, ib = idx[i]!, ic = idx[(i + 1) % idx.length]!;
      const a = pts[ia]!, b = pts[ib]!, c = pts[ic]!;
      if (cross(a, b, c) <= 0) continue; // reflex corner — not an ear
      let contains = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (pointInTri(pts[j]!, a, b, c)) { contains = true; break; }
      }
      if (contains) continue;
      tris.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate input — emit what we have
  }
  if (idx.length === 3) tris.push(idx[0]!, idx[1]!, idx[2]!);
  return tris;
}

/**
 * Load a landmark SVG and build meshes scaled so the artwork stands `height` world units
 * tall, centered on x, feet at y=0, facing +z. Polygons are layered with tiny z offsets
 * (SVG paint order) to avoid z-fighting.
 */
export function loadLandmark(name: string, height: number): LandmarkMesh[] {
  const svg = readFileSync(new URL(`./landmarks/${name}.svg`, import.meta.url), "utf8");
  const [, , , vw, vh] = /viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)!.map(Number) as number[];
  const scale = height / vh!;

  const byColor = new Map<string, LandmarkMesh>();
  const polyRe = /<polygon fill="(#[0-9a-fA-F]{6})" points="([^"]+)"\/>/g;
  let m: RegExpExecArray | null;
  let layer = 0;
  while ((m = polyRe.exec(svg))) {
    const fill = m[1]!;
    const pts: Pt[] = m[2]!.trim().split(/\s+/).map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      // SVG y grows downward; world y grows up. Center x, put the baseline at y=0.
      return [(x! - vw! / 2) * scale, (vh! - y!) * scale];
    });
    const tris = earClip(pts);
    const mesh = byColor.get(fill) ?? { color: hexToLinear(fill), positions: [], normals: [], indices: [] };
    const base = mesh.positions.length / 3;
    const z = layer * 0.015; // paint order → depth order
    for (const [x, y] of pts) mesh.positions.push(x, y, z);
    for (let i = 0; i < pts.length; i++) mesh.normals.push(0, 0, 1);
    for (const t of tris) mesh.indices.push(base + t);
    byColor.set(fill, mesh);
    layer++;
  }
  return [...byColor.values()];
}
