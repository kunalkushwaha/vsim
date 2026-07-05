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

/**
 * High-resolution linear-space render target for supersampled, per-pixel-shaded drawing.
 * Stores linear RGB floats (gamma-encoded only once, at resolve time) plus a z-buffer, at
 * `supersample`× the output resolution. `resolveTo` box-filters down into a `Framebuffer`.
 */
export class LinearBuffer {
  readonly width: number; // = output width · supersample
  readonly height: number;
  readonly supersample: number;
  readonly rgb: Float32Array; // linear RGB, 3 floats per pixel
  readonly depth: Float32Array; // NDC z; smaller = nearer

  constructor(outWidth: number, outHeight: number, supersample = 1) {
    this.supersample = supersample;
    this.width = outWidth * supersample;
    this.height = outHeight * supersample;
    this.rgb = new Float32Array(this.width * this.height * 3);
    this.depth = new Float32Array(this.width * this.height);
  }

  clear(bg: Vec3): void {
    const { rgb, depth } = this;
    for (let i = 0, p = 0; i < depth.length; i++, p += 3) {
      rgb[p] = bg[0];
      rgb[p + 1] = bg[1];
      rgb[p + 2] = bg[2];
      depth[i] = Infinity;
    }
  }

  /**
   * Clear to a vertical gradient. Each block of `supersample` rows takes the color of its OUTPUT
   * row (same ramp as a non-supersampled render), so the resolved sky is byte-identical to a
   * single-sample render — supersampling sharpens geometry without re-shading the background.
   */
  clearGradient(top: Vec3, bottom: Vec3): void {
    const { width, height, supersample: ss, rgb, depth } = this;
    const outHeight = height / ss;
    for (let y = 0; y < height; y++) {
      const oy = Math.floor(y / ss);
      const t = outHeight === 1 ? 0 : oy / (outHeight - 1);
      const r = top[0] + (bottom[0] - top[0]) * t;
      const g = top[1] + (bottom[1] - top[1]) * t;
      const b = top[2] + (bottom[2] - top[2]) * t;
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 3;
        rgb[p] = r;
        rgb[p + 1] = g;
        rgb[p + 2] = b;
      }
    }
    depth.fill(Infinity);
  }

  /**
   * Rasterize a screen-space triangle with a per-pixel shading callback. Each vertex is
   * [x, y, ndcZ, 1/w] plus `ATTRS` interpolated floats (world position, normal, uv); `shade`
   * receives the interpolated attributes and writes linear RGB into `out`. Attributes are
   * perspective-correct: interpolated as attr/w with a per-pixel divide by the interpolated
   * 1/w, so textures and world positions don't swim on large surfaces at grazing angles.
   * Depth stays screen-affine (NDC z is already hyperbolic).
   *
   * When `uvIndex` ≥ 0, attrs[uvIndex]/attrs[uvIndex+1] are treated as UV and the PER-PIXEL
   * screen-space UV footprint (max of the x/y derivative magnitudes, in UV units per pixel) is
   * written into attrs[n] (one slot past the vertex attributes) for mip selection. Derivatives
   * are exact for the hyperbolic mapping: d(u)/dx = (dPAu/dx − u·dIW/dx) / IW, with the linear
   * forms' gradients constant per triangle.
   */
  triangleShaded(
    p0: [number, number, number, number], a0: ArrayLike<number>,
    p1: [number, number, number, number], a1: ArrayLike<number>,
    p2: [number, number, number, number], a2: ArrayLike<number>,
    shade: (attrs: Float64Array, out: Vec3) => void,
    uvIndex = -1,
  ): void {
    const { width, height, rgb, depth } = this;
    const area = edge(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]);
    if (area === 0) return;
    const inv = 1 / area;

    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));

    const n = a0.length;
    const attrs = SCRATCH_ATTRS.length >= n + 1 ? SCRATCH_ATTRS : new Float64Array(n + 1);
    const out: Vec3 = SCRATCH_RGB;
    // Premultiply attributes by their vertex 1/w once per triangle.
    const iw0 = p0[3], iw1 = p1[3], iw2 = p2[3];
    const pa0 = SCRATCH_PA0.length >= n ? SCRATCH_PA0 : new Float64Array(n);
    const pa1 = SCRATCH_PA1.length >= n ? SCRATCH_PA1 : new Float64Array(n);
    const pa2 = SCRATCH_PA2.length >= n ? SCRATCH_PA2 : new Float64Array(n);
    for (let k = 0; k < n; k++) {
      pa0[k] = a0[k]! * iw0;
      pa1[k] = a1[k]! * iw1;
      pa2[k] = a2[k]! * iw2;
    }

    // Constant per-triangle gradients of the barycentric weights over screen space.
    const dw0dx = (p2[1] - p1[1]) * inv, dw0dy = -(p2[0] - p1[0]) * inv;
    const dw1dx = (p0[1] - p2[1]) * inv, dw1dy = -(p0[0] - p2[0]) * inv;
    const dw2dx = (p1[1] - p0[1]) * inv, dw2dy = -(p1[0] - p0[0]) * inv;
    const dIWdx = iw0 * dw0dx + iw1 * dw1dx + iw2 * dw2dx;
    const dIWdy = iw0 * dw0dy + iw1 * dw1dy + iw2 * dw2dy;
    let dPUdx = 0, dPUdy = 0, dPVdx = 0, dPVdy = 0;
    if (uvIndex >= 0) {
      dPUdx = pa0[uvIndex]! * dw0dx + pa1[uvIndex]! * dw1dx + pa2[uvIndex]! * dw2dx;
      dPUdy = pa0[uvIndex]! * dw0dy + pa1[uvIndex]! * dw1dy + pa2[uvIndex]! * dw2dy;
      dPVdx = pa0[uvIndex + 1]! * dw0dx + pa1[uvIndex + 1]! * dw1dx + pa2[uvIndex + 1]! * dw2dx;
      dPVdy = pa0[uvIndex + 1]! * dw0dy + pa1[uvIndex + 1]! * dw1dy + pa2[uvIndex + 1]! * dw2dy;
    }

    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = edge(p1[0], p1[1], p2[0], p2[1], px, py) * inv;
        const w1 = edge(p2[0], p2[1], p0[0], p0[1], px, py) * inv;
        const w2 = edge(p0[0], p0[1], p1[0], p1[1], px, py) * inv;
        // accept either winding
        if (!((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))) continue;

        const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
        const di = y * width + x;
        if (z >= depth[di]!) continue;
        depth[di] = z;

        const iw = w0 * iw0 + w1 * iw1 + w2 * iw2;
        const rw = iw !== 0 ? 1 / iw : 0;
        for (let k = 0; k < n; k++) attrs[k] = (w0 * pa0[k]! + w1 * pa1[k]! + w2 * pa2[k]!) * rw;
        if (uvIndex >= 0) {
          const u = attrs[uvIndex]!, v = attrs[uvIndex + 1]!;
          const dudx = (dPUdx - u * dIWdx) * rw, dvdx = (dPVdx - v * dIWdx) * rw;
          const dudy = (dPUdy - u * dIWdy) * rw, dvdy = (dPVdy - v * dIWdy) * rw;
          attrs[n] = Math.max(Math.sqrt(dudx * dudx + dvdx * dvdx), Math.sqrt(dudy * dudy + dvdy * dvdy));
        }
        shade(attrs, out);
        const p = di * 3;
        rgb[p] = out[0];
        rgb[p + 1] = out[1];
        rgb[p + 2] = out[2];
      }
    }
  }

  /**
   * Manga-style outline on the hi-res buffer: darken pixels on a depth discontinuity, dilated to
   * `supersample` thickness so the resolved line weight matches a single-sample render.
   */
  outline(rgb: Vec3, threshold = 0.002): void {
    const { width, height, depth } = this;
    const edgeMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const d = depth[i]!;
        if (d === Infinity) continue; // background: the outline sits on the object's near side
        const e =
          (x > 0 && depth[i - 1]! - d > threshold) ||
          (x < width - 1 && depth[i + 1]! - d > threshold) ||
          (y > 0 && depth[i - width]! - d > threshold) ||
          (y < height - 1 && depth[i + width]! - d > threshold);
        if (e) edgeMask[i] = 1;
      }
    }
    // Dilate so the line survives the box-filter at full strength (matches 1px at output res).
    const r = this.supersample - 1;
    const mask = r > 0 ? dilate(edgeMask, width, height, r) : edgeMask;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const p = i * 3;
      this.rgb[p] = rgb[0];
      this.rgb[p + 1] = rgb[1];
      this.rgb[p + 2] = rgb[2];
    }
  }

  /**
   * Box-filter the linear hi-res buffer down into `fb` (gamma-encoded once, per output pixel).
   * With `aces` the averaged linear value passes through the ACES filmic fit first, rolling
   * HDR highlights off smoothly instead of clipping at 1.
   */
  resolveTo(fb: Framebuffer, aces = false): void {
    const { width, supersample: ss, rgb } = this;
    const inv = 1 / (ss * ss);
    const { width: ow, height: oh, color } = fb;
    for (let oy = 0; oy < oh; oy++) {
      for (let ox = 0; ox < ow; ox++) {
        let r = 0, g = 0, b = 0;
        for (let sy = 0; sy < ss; sy++) {
          let p = ((oy * ss + sy) * width + ox * ss) * 3;
          for (let sx = 0; sx < ss; sx++, p += 3) {
            r += rgb[p]!;
            g += rgb[p + 1]!;
            b += rgb[p + 2]!;
          }
        }
        const pi = (oy * ow + ox) * 4;
        if (aces) {
          color[pi] = encodeGamma(acesFit(r * inv));
          color[pi + 1] = encodeGamma(acesFit(g * inv));
          color[pi + 2] = encodeGamma(acesFit(b * inv));
        } else {
          color[pi] = encodeGamma(r * inv);
          color[pi + 1] = encodeGamma(g * inv);
          color[pi + 2] = encodeGamma(b * inv);
        }
        color[pi + 3] = 255;
      }
    }
  }
}

const SCRATCH_ATTRS = new Float64Array(16);
const SCRATCH_PA0 = new Float64Array(16);
const SCRATCH_PA1 = new Float64Array(16);
const SCRATCH_PA2 = new Float64Array(16);
const SCRATCH_RGB: Vec3 = [0, 0, 0];

/**
 * A square depth-only buffer for shadow mapping: triangles rasterized in light space, keeping
 * the depth nearest the light. Pure floats — deterministic everywhere.
 */
export class DepthMap {
  readonly size: number;
  readonly data: Float32Array;

  constructor(size: number) {
    this.size = size;
    this.data = new Float32Array(size * size);
  }

  clear(): void {
    this.data.fill(Infinity);
  }

  /** Rasterize a triangle given in map coordinates ([0..size) x/y, arbitrary z; smaller = nearer). */
  triangle(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
  ): void {
    const { size, data } = this;
    const area = edge(x0, y0, x1, y1, x2, y2);
    if (area === 0) return;
    const inv = 1 / area;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = edge(x1, y1, x2, y2, px, py) * inv;
        const w1 = edge(x2, y2, x0, y0, px, py) * inv;
        const w2 = edge(x0, y0, x1, y1, px, py) * inv;
        if (!((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        const i = y * size + x;
        if (z < data[i]!) data[i] = z;
      }
    }
  }
}

/** Binary dilation of a mask by Chebyshev radius `r`. */
function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const y0 = Math.max(0, y - r), y1 = Math.min(height - 1, y + r);
      const x0 = Math.max(0, x - r), x1 = Math.min(width - 1, x + r);
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) out[yy * width + xx] = 1;
    }
  }
  return out;
}

/**
 * Build a mip chain for a texture: successive 2× box reductions (in stored gamma space, matching
 * how levels are later decoded on sample) down to 1×1. Level 0 is the original texture.
 */
export function buildMips(tex: Texture): Texture[] {
  const chain: Texture[] = [tex];
  let cur = tex;
  while (cur.width > 1 || cur.height > 1) {
    const w = Math.max(1, cur.width >> 1);
    const h = Math.max(1, cur.height >> 1);
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const sy0 = Math.min(y * 2, cur.height - 1);
      const sy1 = Math.min(y * 2 + 1, cur.height - 1);
      for (let x = 0; x < w; x++) {
        const sx0 = Math.min(x * 2, cur.width - 1);
        const sx1 = Math.min(x * 2 + 1, cur.width - 1);
        for (let c = 0; c < 4; c++) {
          const sum =
            cur.data[(sy0 * cur.width + sx0) * 4 + c]! + cur.data[(sy0 * cur.width + sx1) * 4 + c]! +
            cur.data[(sy1 * cur.width + sx0) * 4 + c]! + cur.data[(sy1 * cur.width + sx1) * 4 + c]!;
          data[(y * w + x) * 4 + c] = Math.round(sum / 4);
        }
      }
    }
    cur = { width: w, height: h, data };
    chain.push(cur);
  }
  return chain;
}

/**
 * Trilinear sample: bilinear taps from the two mip levels bracketing `lod`, blended by its
 * fraction. `lod` 0 = full resolution; values past the chain end clamp to the 1×1 tail.
 */
export function sampleTexelLod(mips: Texture[], u: number, v: number, lod: number, srgb: boolean): [number, number, number] {
  if (lod <= 0 || mips.length === 1) return sampleTexel(mips[0]!, u, v, srgb);
  const top = mips.length - 1;
  const l0 = Math.min(Math.floor(lod), top);
  const l1 = Math.min(l0 + 1, top);
  const a = sampleTexel(mips[l0]!, u, v, srgb);
  if (l0 === l1) return a;
  const b = sampleTexel(mips[l1]!, u, v, srgb);
  const t = lod - l0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Bilinear sample of a texture, repeat-wrapped. `srgb` decodes color maps (base colour /
 * emissive) to linear; data maps (normal / metallic-roughness / occlusion) stay raw 0..1.
 */
export function sampleTexel(tex: Texture, u: number, v: number, srgb: boolean): [number, number, number] {
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
    const value = (top + (bot - top) * ty) / 255;
    return srgb ? Math.pow(value, 2.2) : value; // sRGB → linear for color maps only
  };
  return [ch(0), ch(1), ch(2)];
}

/** Bilinear sample of a base-color texture → linear-RGB albedo (sRGB-decoded), repeat-wrapped. */
export function sampleAlbedo(tex: Texture, u: number, v: number): [number, number, number] {
  return sampleTexel(tex, u, v, true);
}

function edge(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
}

/** ACES filmic tone-map fit (Narkowicz 2015): smooth highlight rolloff, ~identity near black. */
export function acesFit(x: number): number {
  if (x <= 0) return 0;
  return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
}

/** Linear RGB [0,1] → gamma-encoded 8-bit. */
export function encodeGamma(c: number): number {
  return Math.round(clamp(Math.pow(clamp(c, 0, 1), 1 / 2.2), 0, 1) * 255);
}

/** Linear RGB triple → gamma-encoded 8-bit triple (matches what the rasterizer writes). */
export function gammaRgb(rgb: Vec3): [number, number, number] {
  return [encodeGamma(rgb[0]), encodeGamma(rgb[1]), encodeGamma(rgb[2])];
}
