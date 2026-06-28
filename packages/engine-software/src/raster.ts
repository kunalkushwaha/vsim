import { clamp, type Texture, type Vec3 } from "@vsim/core";

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

  /** Alpha-blend a filled rectangle (gamma-space src color over dst). For overlay backgrounds. */
  fillRectBlend(x0: number, y0: number, w: number, h: number, rgb: [number, number, number], alpha: number): void {
    if (alpha <= 0) return;
    const { width, height, color } = this;
    const xa = Math.max(0, Math.floor(x0)), xb = Math.min(width, Math.ceil(x0 + w));
    const ya = Math.max(0, Math.floor(y0)), yb = Math.min(height, Math.ceil(y0 + h));
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        const p = (y * width + x) * 4;
        color[p] = rgb[0] * alpha + color[p]! * (1 - alpha);
        color[p + 1] = rgb[1] * alpha + color[p + 1]! * (1 - alpha);
        color[p + 2] = rgb[2] * alpha + color[p + 2]! * (1 - alpha);
      }
    }
  }

  /**
   * Composite a coverage bitmap (`cov`, `cw`×`ch`, 0..255) at top-left (`dx`,`dy`) using a
   * gamma-space color, scaled by `opacity`. Used to paint anti-aliased text over the render.
   */
  blitCoverage(cov: Uint8Array, cw: number, ch: number, dx: number, dy: number, rgb: [number, number, number], opacity: number): void {
    if (opacity <= 0) return;
    const { width, height, color } = this;
    const x0 = Math.round(dx), y0 = Math.round(dy);
    for (let y = 0; y < ch; y++) {
      const ty = y0 + y;
      if (ty < 0 || ty >= height) continue;
      for (let x = 0; x < cw; x++) {
        const tx = x0 + x;
        if (tx < 0 || tx >= width) continue;
        const a = (cov[y * cw + x]! / 255) * opacity;
        if (a <= 0) continue;
        const p = (ty * width + tx) * 4;
        color[p] = rgb[0] * a + color[p]! * (1 - a);
        color[p + 1] = rgb[1] * a + color[p + 1]! * (1 - a);
        color[p + 2] = rgb[2] * a + color[p + 2]! * (1 - a);
      }
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

  /**
   * Textured triangle. Per vertex: screen [x,y,z], incident lighting `l` (white-material), and
   * uv. Per pixel the albedo is sampled (bilinear) from `tex` and combined as
   * `emissive + albedo*lighting`. UV is interpolated affinely (fine for dense meshes).
   */
  triangleTextured(
    p0: [number, number, number], l0: Vec3, uv0: [number, number],
    p1: [number, number, number], l1: Vec3, uv1: [number, number],
    p2: [number, number, number], l2: Vec3, uv2: [number, number],
    tex: Texture, emissive: Vec3,
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
        const w0 = edge(p1[0], p1[1], p2[0], p2[1], px, py) * inv;
        const w1 = edge(p2[0], p2[1], p0[0], p0[1], px, py) * inv;
        const w2 = edge(p0[0], p0[1], p1[0], p1[1], px, py) * inv;
        if (!((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))) continue;

        const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
        const di = y * width + x;
        if (z >= depth[di]!) continue;
        depth[di] = z;

        const u = w0 * uv0[0] + w1 * uv1[0] + w2 * uv2[0];
        const v = w0 * uv0[1] + w1 * uv1[1] + w2 * uv2[1];
        const [ar, ag, ab] = sampleAlbedo(tex, u, v); // linear albedo
        const lr = w0 * l0[0] + w1 * l1[0] + w2 * l2[0];
        const lg = w0 * l0[1] + w1 * l1[1] + w2 * l2[1];
        const lb = w0 * l0[2] + w1 * l1[2] + w2 * l2[2];

        const pi = di * 4;
        color[pi] = encodeGamma(emissive[0] + ar * lr);
        color[pi + 1] = encodeGamma(emissive[1] + ag * lg);
        color[pi + 2] = encodeGamma(emissive[2] + ab * lb);
        color[pi + 3] = 255;
      }
    }
  }
}

/** Bilinear sample of a base-color texture → linear-RGB albedo (sRGB-decoded), repeat-wrapped. */
function sampleAlbedo(tex: Texture, u: number, v: number): [number, number, number] {
  const { width: w, height: h, data } = tex;
  const fx = (u - Math.floor(u)) * w - 0.5;
  const fy = (v - Math.floor(v)) * h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const wrap = (n: number, m: number) => ((n % m) + m) % m;
  const sx0 = wrap(x0, w), sx1 = wrap(x0 + 1, w), sy0 = wrap(y0, h), sy1 = wrap(y0 + 1, h);
  const ch = (o: number): number => {
    const top = data[(sy0 * w + sx0) * 4 + o]! + (data[(sy0 * w + sx1) * 4 + o]! - data[(sy0 * w + sx0) * 4 + o]!) * tx;
    const bot = data[(sy1 * w + sx0) * 4 + o]! + (data[(sy1 * w + sx1) * 4 + o]! - data[(sy1 * w + sx0) * 4 + o]!) * tx;
    return Math.pow((top + (bot - top) * ty) / 255, 2.2); // sRGB → linear
  };
  return [ch(0), ch(1), ch(2)];
}

function edge(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
}

/** Linear RGB [0,1] → gamma-encoded 8-bit. */
export function encodeGamma(c: number): number {
  return Math.round(clamp(Math.pow(clamp(c, 0, 1), 1 / 2.2), 0, 1) * 255);
}

/** Linear RGB triple → gamma-encoded 8-bit triple (matches what the rasterizer writes). */
export function gammaRgb(rgb: Vec3): [number, number, number] {
  return [encodeGamma(rgb[0]), encodeGamma(rgb[1]), encodeGamma(rgb[2])];
}
