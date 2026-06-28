// Deterministic vector text rasterizer: parse a bundled font with opentype.js, fill the glyph paths
// (supersampled scanline, nonzero winding) into a coverage bitmap. No platform font engine → the same
// pixels everywhere. Used by the renderers to composite screen-space text overlays (titles/captions).
import opentype from "opentype.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let _font: opentype.Font | undefined;
function font(): opentype.Font {
  if (!_font) {
    const p = fileURLToPath(new URL("../fonts/DejaVuSans-Bold.ttf", import.meta.url));
    const b = readFileSync(p);
    _font = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
  return _font;
}

/** A rasterized text run: `alpha` is row-major coverage (0..255), `width`×`height`. */
export interface TextBitmap {
  width: number;
  height: number;
  alpha: Uint8Array;
}

// Lay out a string as a single glyph path, walking char-by-char with charToGlyph + kerning.
// (We avoid font.getPath / getAdvanceWidth: opentype.js 1.3.5 routes those through GSUB/Bidi
// shaping that throws on DejaVu's ligature tables. Per-glyph layout sidesteps it entirely.)
function layout(text: string, sizePx: number): { commands: any[]; advance: number } {
  const f = font();
  const scale = sizePx / f.unitsPerEm;
  const commands: any[] = [];
  let x = 0;
  let prev: any = null;
  for (const ch of text) {
    const g = f.charToGlyph(ch);
    if (prev) x += f.getKerningValue(prev, g) * scale;
    for (const c of g.getPath(x, 0, sizePx).commands) commands.push(c);
    x += (g.advanceWidth ?? 0) * scale;
    prev = g;
  }
  return { commands, advance: x };
}

/** Advance width of a string at `sizePx` (for layout/alignment). */
export function measureText(text: string, sizePx: number): number {
  return layout(text, sizePx).advance;
}

const SS = 3; // supersample factor for anti-aliasing

/** Rasterize `text` at `sizePx` into a tight coverage bitmap (deterministic). */
export function rasterizeText(text: string, sizePx: number): TextBitmap {
  const hi = Math.max(1, Math.round(sizePx)) * SS;
  // y is baseline; opentype returns screen-space (y down) path commands.
  const { commands } = layout(text || " ", hi);
  const path = new opentype.Path();
  path.commands = commands;
  const bb = path.getBoundingBox();
  const padHi = SS; // a little margin so AA edges aren't clipped
  const x0 = Math.floor(bb.x1) - padHi, y0 = Math.floor(bb.y1) - padHi;
  const wHi = Math.max(SS, Math.ceil(bb.x2) - x0 + padHi);
  const hHi = Math.max(SS, Math.ceil(bb.y2) - y0 + padHi);

  // Flatten path commands into closed contours (lists of points), translated to bitmap space.
  const contours: number[][] = [];
  let cur: number[] = [];
  let px = 0, py = 0, sx = 0, sy = 0;
  const moveTo = (x: number, y: number) => { if (cur.length) contours.push(cur); cur = [x - x0, y - y0]; px = x; py = y; sx = x; sy = y; };
  const lineTo = (x: number, y: number) => { cur.push(x - x0, y - y0); px = x; py = y; };
  const quad = (cx: number, cy: number, x: number, y: number) => {
    const n = 8;
    for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; lineTo(u * u * px + 2 * u * t * cx + t * t * x, u * u * py + 2 * u * t * cy + t * t * y); }
  };
  const cubic = (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => {
    const sxp = px, syp = py, n = 10;
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, d = t * t * t;
      lineTo(a * sxp + b * c1x + cc * c2x + d * x, a * syp + b * c1y + cc * c2y + d * y);
    }
  };
  for (const c of path.commands as any[]) {
    if (c.type === "M") moveTo(c.x, c.y);
    else if (c.type === "L") lineTo(c.x, c.y);
    else if (c.type === "Q") quad(c.x1, c.y1, c.x, c.y);
    else if (c.type === "C") cubic(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
    else if (c.type === "Z") { lineTo(sx, sy); contours.push(cur); cur = []; }
  }
  if (cur.length) contours.push(cur);

  // Scanline nonzero fill at hi-res → 1 byte per hi-res pixel.
  const hiCov = new Uint8Array(wHi * hHi);
  type Edge = { ytop: number; ybot: number; x: number; dxdy: number; dir: number };
  const edges: Edge[] = [];
  for (const ct of contours) {
    for (let i = 0; i + 1 < ct.length / 2; i++) {
      const ax = ct[i * 2]!, ay = ct[i * 2 + 1]!, bx = ct[i * 2 + 2]!, by = ct[i * 2 + 3]!;
      if (ay === by) continue;
      const dir = ay < by ? 1 : -1;
      const [ytop, ybot, xtop] = ay < by ? [ay, by, ax] : [by, ay, bx];
      edges.push({ ytop, ybot, x: xtop, dxdy: (bx - ax) / (by - ay), dir });
    }
  }
  for (let y = 0; y < hHi; y++) {
    const yc = y + 0.5;
    const xs: { x: number; dir: number }[] = [];
    for (const e of edges) if (yc >= e.ytop && yc < e.ybot) xs.push({ x: e.x + (yc - e.ytop) * e.dxdy, dir: e.dir });
    if (xs.length < 2) continue;
    xs.sort((a, b) => a.x - b.x);
    let wind = 0;
    for (let i = 0; i + 1 < xs.length; i++) {
      wind += xs[i]!.dir;
      if (wind !== 0) {
        const xa = Math.max(0, Math.round(xs[i]!.x)), xb = Math.min(wHi, Math.round(xs[i + 1]!.x));
        for (let x = xa; x < xb; x++) hiCov[y * wHi + x] = 1;
      }
    }
  }

  // Box-downsample SS×SS → 0..255 coverage.
  const width = Math.max(1, Math.floor(wHi / SS)), height = Math.max(1, Math.floor(hHi / SS));
  const alpha = new Uint8Array(width * height);
  const norm = 255 / (SS * SS);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) s += hiCov[(y * SS + j) * wHi + (x * SS + i)]!;
      alpha[y * width + x] = Math.round(s * norm);
    }
  }
  return { width, height, alpha };
}
