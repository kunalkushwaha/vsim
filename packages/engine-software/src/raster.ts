import { clamp, type Vec3 } from "@vsim/core";

/** A CPU framebuffer with a z-buffer and a barycentric triangle rasterizer. */
export class Framebuffer {
  readonly width: number;
  readonly height: number;
  readonly color: Uint8ClampedArray; // RGBA8, row 0 = top
  readonly depth: Float32Array; // NDC z; smaller = nearer

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.color = new Uint8ClampedArray(width * height * 4);
    this.depth = new Float32Array(width * height);
  }

  clear(bg: Vec3): void {
    const r = encodeGamma(bg[0]);
    const g = encodeGamma(bg[1]);
    const b = encodeGamma(bg[2]);
    const { color, depth } = this;
    for (let i = 0, p = 0; i < depth.length; i++, p += 4) {
      color[p] = r;
      color[p + 1] = g;
      color[p + 2] = b;
      color[p + 3] = 255;
      depth[i] = Infinity;
    }
  }

  /** Clear to a vertical gradient (top color at row 0 → bottom color at the last row). */
  clearGradient(top: Vec3, bottom: Vec3): void {
    const { width, height, color, depth } = this;
    for (let y = 0; y < height; y++) {
      const t = height === 1 ? 0 : y / (height - 1);
      const r = encodeGamma(top[0] + (bottom[0] - top[0]) * t);
      const g = encodeGamma(top[1] + (bottom[1] - top[1]) * t);
      const b = encodeGamma(top[2] + (bottom[2] - top[2]) * t);
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        color[p] = r;
        color[p + 1] = g;
        color[p + 2] = b;
        color[p + 3] = 255;
      }
    }
    depth.fill(Infinity);
  }

  /**
   * Manga-style outline: darken pixels that sit on a depth discontinuity (object silhouettes
   * against the background, and where one part overlaps another). Run as a post-pass after all
   * geometry is drawn. Edges are detected from the z-buffer first, so outline pixels don't seed
   * more edges.
   */
  outline(rgb: Vec3, threshold = 0.002): void {
    const { width, height, color, depth } = this;
    const r = encodeGamma(rgb[0]);
    const g = encodeGamma(rgb[1]);
    const b = encodeGamma(rgb[2]);
    const edge = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const d = depth[i]!;
        if (d === Infinity) continue; // background: the outline sits on the object's near side
        // A neighbor that is farther (or the background) means this pixel is on a silhouette/edge.
        const e =
          (x > 0 && depth[i - 1]! - d > threshold) ||
          (x < width - 1 && depth[i + 1]! - d > threshold) ||
          (y > 0 && depth[i - width]! - d > threshold) ||
          (y < height - 1 && depth[i + width]! - d > threshold);
        if (e) edge[i] = 1;
      }
    }
    for (let i = 0; i < edge.length; i++) {
      if (!edge[i]) continue;
      const p = i * 4;
      color[p] = r;
      color[p + 1] = g;
      color[p + 2] = b;
      color[p + 3] = 255;
    }
  }

  /**
   * Rasterize a screen-space triangle. Each vertex is [x, y, ndcZ] with a linear RGB color;
   * color and depth are interpolated affinely (screen-space) — fine for our scene scale.
   */
  triangle(
    p0: [number, number, number], c0: Vec3,
    p1: [number, number, number], c1: Vec3,
    p2: [number, number, number], c2: Vec3,
  ): void {
    const { width, height, color, depth } = this;
    const area = edge(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]);
    if (area === 0) return;
    const inv = 1 / area;

    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));

    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        let w0 = edge(p1[0], p1[1], p2[0], p2[1], px, py) * inv;
        let w1 = edge(p2[0], p2[1], p0[0], p0[1], px, py) * inv;
        let w2 = edge(p0[0], p0[1], p1[0], p1[1], px, py) * inv;
        // accept either winding
        if (!((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))) continue;

        const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
        const di = y * width + x;
        if (z >= depth[di]!) continue;
        depth[di] = z;

        const pi = di * 4;
        color[pi] = encodeGamma(w0 * c0[0] + w1 * c1[0] + w2 * c2[0]);
        color[pi + 1] = encodeGamma(w0 * c0[1] + w1 * c1[1] + w2 * c2[1]);
        color[pi + 2] = encodeGamma(w0 * c0[2] + w1 * c1[2] + w2 * c2[2]);
        color[pi + 3] = 255;
      }
    }
  }
}

function edge(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
}

/** Linear RGB [0,1] → gamma-encoded 8-bit. */
function encodeGamma(c: number): number {
  return Math.round(clamp(Math.pow(clamp(c, 0, 1), 1 / 2.2), 0, 1) * 255);
}
