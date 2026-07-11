// SVG → 3D geometry (docs/plan-surface-pack.md stage 2). The shape language of the surface
// pack: AI (or a human) authors plain vector art, and this module turns it into render-ready
// `kind:"mesh"` data — flat or extruded, one mesh per fill color, standing upright like stage
// scenery. Everything is a pure function: same SVG bytes → same triangles → same pixels.
// Promoted from examples/25-weather/landmarks.ts (polygons) and extended with a path-d
// subset (M/L/H/V/C/Q/Z, absolute + relative; curves flattened at a FIXED segment count so
// tessellation is deterministic) and side-wall extrusion.

type Pt = [number, number];

export interface SvgMesh {
  /** Linear-space RGB from the shape's fill. */
  color: [number, number, number];
  positions: number[];
  normals: number[];
  indices: number[];
}

/** sRGB "#rrggbb" (or "#rgb") → linear RGB. */
function hexToLinear(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  const s = (v: number) => Math.pow(v / 255, 2.2);
  return [s((n >> 16) & 255), s((n >> 8) & 255), s(n & 255)];
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function pointInTri(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Ear-clipping triangulation of a simple (possibly concave) polygon → index triples. */
export function earClip(pts: Pt[]): number[] {
  const idx = pts.map((_, i) => i);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % pts.length]!;
    area += x1 * y2 - x2 * y1;
  }
  if (area < 0) idx.reverse(); // normalize to counter-clockwise

  const tris: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length]!, ib = idx[i]!, ic = idx[(i + 1) % idx.length]!;
      const a = pts[ia]!, b = pts[ib]!, c = pts[ic]!;
      if (cross(a, b, c) <= 0) continue; // reflex vertex — not an ear
      let inside = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (pointInTri(pts[j]!, a, b, c)) { inside = true; break; }
      }
      if (inside) continue;
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

/** Fixed flattening resolution for C/Q curves — a constant so meshes never drift. */
const CURVE_SEGS = 12;

/** Parse an SVG path `d` (M/L/H/V/C/Q/Z subset, absolute + relative) → closed contours. */
export function parsePathD(d: string): Pt[][] {
  // Tokenize EVERY letter (not just supported ones) so unknown commands like "A" reach the
  // switch and throw — silently dropping them would misparse their numbers as linetos.
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const contours: Pt[][] = [];
  let cur: Pt[] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  let i = 0;
  const num = () => Number(tokens[i++]);
  let cmd = "";
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/[A-Za-z]/.test(t)) { cmd = t; i++; }
    const rel = cmd === cmd.toLowerCase();
    const push = (px: number, py: number) => { cur.push([px, py]); x = px; y = py; };
    switch (cmd.toUpperCase()) {
      case "M": {
        const nx = (rel ? x : 0) + num(), ny = (rel ? y : 0) + num();
        if (cur.length > 1) contours.push(cur);
        cur = [];
        push(nx, ny); sx = nx; sy = ny;
        cmd = rel ? "l" : "L"; // subsequent coordinate pairs are implicit lineto
        break;
      }
      case "L": push((rel ? x : 0) + num(), (rel ? y : 0) + num()); break;
      case "H": push((rel ? x : 0) + num(), y); break;
      case "V": push(x, (rel ? y : 0) + num()); break;
      case "C": {
        const x1 = (rel ? x : 0) + num(), y1 = (rel ? y : 0) + num();
        const x2 = (rel ? x : 0) + num(), y2 = (rel ? y : 0) + num();
        const x3 = (rel ? x : 0) + num(), y3 = (rel ? y : 0) + num();
        const [ox, oy] = [x, y];
        for (let s = 1; s <= CURVE_SEGS; s++) {
          const t2 = s / CURVE_SEGS, u = 1 - t2;
          cur.push([
            u * u * u * ox + 3 * u * u * t2 * x1 + 3 * u * t2 * t2 * x2 + t2 * t2 * t2 * x3,
            u * u * u * oy + 3 * u * u * t2 * y1 + 3 * u * t2 * t2 * y2 + t2 * t2 * t2 * y3,
          ]);
        }
        x = x3; y = y3;
        break;
      }
      case "Q": {
        const x1 = (rel ? x : 0) + num(), y1 = (rel ? y : 0) + num();
        const x2 = (rel ? x : 0) + num(), y2 = (rel ? y : 0) + num();
        const [ox, oy] = [x, y];
        for (let s = 1; s <= CURVE_SEGS; s++) {
          const t2 = s / CURVE_SEGS, u = 1 - t2;
          cur.push([u * u * ox + 2 * u * t2 * x1 + t2 * t2 * x2, u * u * oy + 2 * u * t2 * y1 + t2 * t2 * y2]);
        }
        x = x2; y = y2;
        break;
      }
      case "Z":
        if (cur.length > 1) contours.push(cur);
        cur = [];
        x = sx; y = sy;
        break;
      default:
        throw new Error(`svgToMesh: unsupported path command "${cmd}" (supported: M L H V C Q Z)`);
    }
  }
  if (cur.length > 2) contours.push(cur);
  // Drop consecutive duplicate points (Z after an explicit return to start, etc.).
  return contours
    .map((c) => c.filter((p, j) => j === 0 || Math.hypot(p[0] - c[j - 1]![0], p[1] - c[j - 1]![1]) > 1e-9))
    .filter((c) => c.length >= 3);
}

/** Extract fillable shapes (path d / polygon points) with their fills from an SVG string. */
function shapesOf(svg: string): { fill: string; contours: Pt[][] }[] {
  const out: { fill: string; contours: Pt[][] }[] = [];
  for (const m of svg.matchAll(/<(path|polygon)\b[^>]*>/g)) {
    const tag = m[0];
    const fill = /fill="(#[0-9a-fA-F]{3,6})"/.exec(tag)?.[1] ?? "#888888";
    if (/fill="none"/.test(tag)) continue;
    if (m[1] === "path") {
      const d = /\bd="([^"]+)"/.exec(tag)?.[1];
      if (d) out.push({ fill, contours: parsePathD(d) });
    } else {
      const pts = /points="([^"]+)"/.exec(tag)?.[1];
      if (pts) {
        const nums = pts.trim().split(/[\s,]+/).map(Number);
        const c: Pt[] = [];
        for (let j = 0; j + 1 < nums.length; j += 2) c.push([nums[j]!, nums[j + 1]!]);
        if (c.length >= 3) out.push({ fill, contours: [c] });
      }
    }
  }
  return out;
}

/**
 * SVG string → upright 3D meshes, one per shape (grouped by fill). The art is normalized by
 * its viewBox to `height` world units (default 1), centered at x=0 standing on y=0, facing
 * +z; `depth` extrudes front/back faces plus side walls (0 = flat single-sided front face).
 */
export function svgToMesh(svg: string, opts: { depth?: number; height?: number } = {}): SvgMesh[] {
  const depth = opts.depth ?? 0.08;
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1]?.trim().split(/[\s,]+/).map(Number);
  if (!vb || vb.length !== 4) throw new Error("svgToMesh: the SVG needs a viewBox");
  const [minX, minY, vbW, vbH] = vb as [number, number, number, number];
  const scale = (opts.height ?? 1) / vbH;
  // SVG y grows downward; world y grows up. Center x on the viewBox, stand on y=0.
  const X = (px: number) => (px - minX - vbW / 2) * scale;
  const Y = (py: number) => (vbH - (py - minY)) * scale;

  const meshes: SvgMesh[] = [];
  for (const shape of shapesOf(svg)) {
    for (const contour of shape.contours) {
      const pts: Pt[] = contour.map(([px, py]) => [X(px), Y(py)]);
      // Normalize the OUTLINE to counter-clockwise before triangulating: earClip only fixes
      // its internal index order, but the side walls below iterate `pts` directly — a
      // clockwise-authored path would get inward normals and inside-out wall winding.
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % pts.length]!;
        area += x1 * y2 - x2 * y1;
      }
      if (area < 0) pts.reverse();
      const tris = earClip(pts);
      if (tris.length === 0) continue;
      const n = pts.length;
      const positions: number[] = [];
      const normals: number[] = [];
      const indices: number[] = [];
      const zF = depth / 2;
      // Front face (+z normal). earClip returns CCW triangles in our y-up frame.
      for (const [px, py] of pts) { positions.push(px, py, zF); normals.push(0, 0, 1); }
      indices.push(...tris);
      if (depth > 0) {
        // Back face — same outline at -z, reversed winding.
        for (const [px, py] of pts) { positions.push(px, py, -zF); normals.push(0, 0, -1); }
        for (let t = 0; t < tris.length; t += 3) indices.push(n + tris[t]!, n + tris[t + 2]!, n + tris[t + 1]!);
        // Side walls: one quad per outline edge, flat normals per edge.
        for (let e = 0; e < n; e++) {
          const a = pts[e]!, b = pts[(e + 1) % n]!;
          const ex = b[0] - a[0], ey = b[1] - a[1];
          const len = Math.hypot(ex, ey) || 1;
          const nx = ey / len, ny = -ex / len; // outward for CCW outlines
          const base = positions.length / 3;
          positions.push(a[0], a[1], zF, b[0], b[1], zF, b[0], b[1], -zF, a[0], a[1], -zF);
          for (let k = 0; k < 4; k++) normals.push(nx, ny, 0);
          indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
      }
      meshes.push({ color: hexToLinear(shape.fill), positions, normals, indices });
    }
  }
  if (meshes.length === 0) throw new Error("svgToMesh: no fillable <path>/<polygon> shapes found");
  return meshes;
}
