import {
  mat4, v3, tessellate, skinningMatrix,
  type Engine, type FrameState, type SceneDocument,
  type Material, type MeshData, type ResolvedLight, type ResolvedNode, type Vec3,
} from "@vsim/core";
import { Framebuffer, LinearBuffer, DepthMap, sampleTexel, sampleTexelLod, buildMips } from "./raster.js";
import { compositeOverlays } from "./overlay.js";

const DEFAULT_MATERIAL: Material = {
  id: "__default",
  color: [0.8, 0.8, 0.8],
  emissive: [0, 0, 0],
  opacity: 1,
  roughness: 0.8,
  metalness: 0,
};

/** Clip-space w below this is at/behind the camera; the near plane sits just in front of it. */
const W_NEAR = 1e-5;

const SHADOW_MAP_SIZE = 1024;

/**
 * Sutherland–Hodgman clip of a convex clip-space polygon against the near plane `w = W_NEAR`.
 * Each vertex is [x, y, z, w, ...attrs]; crossing edges get a linearly interpolated vertex.
 * Returns the kept polygon (0 or ≥3 vertices), to be fan-triangulated by the caller.
 */
function clipNear(poly: number[][], wMin = W_NEAR): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const nxt = poly[(i + 1) % poly.length]!;
    const curIn = cur[3]! >= wMin;
    const nxtIn = nxt[3]! >= wMin;
    if (curIn) out.push(cur);
    if (curIn !== nxtIn) {
      const tParam = (wMin - cur[3]!) / (nxt[3]! - cur[3]!);
      const n = cur.length; // [x,y,z,w, ...attrs]
      const v = new Array<number>(n);
      for (let k = 0; k < n; k++) v[k] = cur[k]! + (nxt[k]! - cur[k]!) * tParam;
      out.push(v);
    }
  }
  return out;
}

/** One mesh's per-frame vertex data: world positions/normals (skinning + morphs applied) etc. */
interface MeshBatch {
  node: ResolvedNode;
  md: MeshData;
  material: Material;
  /** UVs are carried whenever ANY texture map needs them (base colour or PBR maps). */
  useUV: boolean;
  wx: Float64Array; wy: Float64Array; wz: Float64Array;
  nx: Float64Array; ny: Float64Array; nz: Float64Array;
  cx: Float64Array; cy: Float64Array; cz: Float64Array; cw: Float64Array;
  cu?: Float64Array; cv?: Float64Array;
  /** World-space tangents (xyz) + handedness (w), only when the mesh has a normal map. */
  tx?: Float64Array; ty?: Float64Array; tz?: Float64Array; tw?: Float64Array;
}

/**
 * Per-vertex tangents (xyz + handedness w) from bind-pose positions/uvs (Lengyel's method):
 * accumulate the uv-aligned edge direction per triangle, then Gram-Schmidt against the normal.
 * Cached per MeshData — tangents deform with the same matrices as normals at draw time.
 */
function computeTangents(md: MeshData): Float32Array {
  const vcount = md.positions.length / 3;
  const tan = new Float64Array(vcount * 3);
  const bit = new Float64Array(vcount * 3);
  const pos = md.positions, uv = md.uvs!, idx = md.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    const x1 = pos[b * 3]! - pos[a * 3]!, y1 = pos[b * 3 + 1]! - pos[a * 3 + 1]!, z1 = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const x2 = pos[c * 3]! - pos[a * 3]!, y2 = pos[c * 3 + 1]! - pos[a * 3 + 1]!, z2 = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    const s1 = uv[b * 2]! - uv[a * 2]!, t1 = uv[b * 2 + 1]! - uv[a * 2 + 1]!;
    const s2 = uv[c * 2]! - uv[a * 2]!, t2 = uv[c * 2 + 1]! - uv[a * 2 + 1]!;
    const det = s1 * t2 - s2 * t1;
    if (det === 0) continue;
    const r = 1 / det;
    const tx = (t2 * x1 - t1 * x2) * r, ty = (t2 * y1 - t1 * y2) * r, tz = (t2 * z1 - t1 * z2) * r;
    const bx = (s1 * x2 - s2 * x1) * r, by = (s1 * y2 - s2 * y1) * r, bz = (s1 * z2 - s2 * z1) * r;
    for (const i of [a, b, c]) {
      tan[i * 3] = tan[i * 3]! + tx; tan[i * 3 + 1] = tan[i * 3 + 1]! + ty; tan[i * 3 + 2] = tan[i * 3 + 2]! + tz;
      bit[i * 3] = bit[i * 3]! + bx; bit[i * 3 + 1] = bit[i * 3 + 1]! + by; bit[i * 3 + 2] = bit[i * 3 + 2]! + bz;
    }
  }
  const out = new Float32Array(vcount * 4);
  const nrm = md.normals;
  for (let i = 0; i < vcount; i++) {
    const nx = nrm[i * 3]!, ny = nrm[i * 3 + 1]!, nz = nrm[i * 3 + 2]!;
    let tx = tan[i * 3]!, ty = tan[i * 3 + 1]!, tz = tan[i * 3 + 2]!;
    // Gram-Schmidt orthogonalize against the normal.
    const d = nx * tx + ny * ty + nz * tz;
    tx -= nx * d; ty -= ny * d; tz -= nz * d;
    const len = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (len > 1e-8) { tx /= len; ty /= len; tz /= len; } else { tx = 1; ty = 0; tz = 0; }
    // Handedness: does N×T point along the accumulated bitangent?
    const cxv = ny * tz - nz * ty, cyv = nz * tx - nx * tz, czv = nx * ty - ny * tx;
    const w = cxv * bit[i * 3]! + cyv * bit[i * 3 + 1]! + czv * bit[i * 3 + 2]! < 0 ? -1 : 1;
    out[i * 4] = tx; out[i * 4 + 1] = ty; out[i * 4 + 2] = tz; out[i * 4 + 3] = w;
  }
  return out;
}

/**
 * Directional-light shadow context: an orthographic light-space depth map fitted to the frame's
 * world-space geometry. `factor` returns how lit a world point is (0 = fully shadowed, 1 = lit)
 * using a 3×3 PCF kernel and a slope-scaled depth bias.
 */
interface ShadowContext {
  factor(wpx: number, wpy: number, wpz: number, lambert: number): number;
}

function buildShadow(sun: ResolvedLight, batches: MeshBatch[], map: DepthMap): ShadowContext | undefined {
  // Planes are ground/backdrop: they RECEIVE shadows but don't cast them. Excluding them keeps
  // the map bounds tight around the actual objects (a big ground plane would blow the texel
  // size up ~10× and turn every shadow edge into blocks). Points outside the map sample as lit.
  const casters = batches.filter((b) => b.node.mesh?.geometry.kind !== "plane" && b.material.opacity >= 1);
  if (casters.length === 0) return undefined;

  // Orthonormal light basis: f along the light's travel direction, r/u spanning the map plane.
  const f = v3.normalize(sun.direction);
  const helper: Vec3 = Math.abs(f[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const r = v3.normalize(v3.cross(helper, f));
  const u = v3.cross(f, r);

  // Fit light-space bounds over caster vertices (deterministic; no temporal stabilization needed).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of casters) {
    const n = b.wx.length;
    for (let i = 0; i < n; i++) {
      const x = b.wx[i]!, y = b.wy[i]!, z = b.wz[i]!;
      const lx = x * r[0] + y * r[1] + z * r[2];
      const ly = x * u[0] + y * u[1] + z * u[2];
      const lz = x * f[0] + y * f[1] + z * f[2];
      if (lx < minX) minX = lx; if (lx > maxX) maxX = lx;
      if (ly < minY) minY = ly; if (ly > maxY) maxY = ly;
      if (lz < minZ) minZ = lz; if (lz > maxZ) maxZ = lz;
    }
  }
  if (!Number.isFinite(minX)) return undefined;
  const size = map.size;
  const padXY = Math.max(maxX - minX, maxY - minY) * 0.01 + 1e-4;
  minX -= padXY; maxX += padXY; minY -= padXY; maxY += padXY;
  const spanX = maxX - minX, spanY = maxY - minY, spanZ = Math.max(maxZ - minZ, 1e-4);
  const sx = size / spanX, sy = size / spanY;

  map.clear();
  for (const b of casters) {
    const idx = b.md.indices;
    const px = (i: number) => (b.wx[i]! * r[0] + b.wy[i]! * r[1] + b.wz[i]! * r[2] - minX) * sx;
    const py = (i: number) => (b.wx[i]! * u[0] + b.wy[i]! * u[1] + b.wz[i]! * u[2] - minY) * sy;
    const pz = (i: number) => (b.wx[i]! * f[0] + b.wy[i]! * f[1] + b.wz[i]! * f[2] - minZ) / spanZ;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]!, bb = idx[t + 1]!, c = idx[t + 2]!;
      map.triangle(px(a), py(a), pz(a), px(bb), py(bb), pz(bb), px(c), py(c), pz(c));
    }
  }

  const data = map.data;
  return {
    factor(wpx, wpy, wpz, lambert) {
      const lx = (wpx * r[0] + wpy * r[1] + wpz * r[2] - minX) * sx;
      const ly = (wpx * u[0] + wpy * u[1] + wpz * u[2] - minY) * sy;
      const lz = (wpx * f[0] + wpy * f[1] + wpz * f[2] - minZ) / spanZ;
      const ix = Math.floor(lx), iy = Math.floor(ly);
      // Slope-scaled bias in normalized depth: steeper grazing angles need more to avoid acne.
      const bias = 0.004 + 0.014 * (1 - lambert);
      // Bilinear PCF: tent-weight each 3×3 tap by its distance to the exact sample position
      // (radius 1.5 texels), so the lit fraction ramps continuously as the sample point moves
      // across texels instead of stepping — shadow edges lose the residual stair pattern.
      // Taps OUTSIDE the map count as lit (empty space casts nothing): the map bounds are
      // fitted tightly to the casters, so a caster silhouette often IS the map boundary, and
      // skipping those taps would turn that edge into a hard binary cutoff.
      let lit = 0, total = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = iy + dy;
        const wy = Math.max(0, 1.5 - Math.abs(yy + 0.5 - ly));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = ix + dx;
          const w = wy * Math.max(0, 1.5 - Math.abs(xx + 0.5 - lx));
          total += w;
          const outside = xx < 0 || xx >= size || yy < 0 || yy >= size;
          if (outside || lz - bias <= data[yy * size + xx]!) lit += w;
        }
      }
      return total === 0 ? 1 : lit / total;
    },
  };
}

/** Cube-face axis conventions shared by the rasterize and sample sides (they must match). */
const CUBE_FACES: { axis: number; sign: number }[] = [
  { axis: 0, sign: 1 }, { axis: 0, sign: -1 },
  { axis: 1, sign: 1 }, { axis: 1, sign: -1 },
  { axis: 2, sign: 1 }, { axis: 2, sign: -1 },
];

/** Face-space coords for point P relative to a cube face: w = depth along the face axis. */
function faceCoords(dx: number, dy: number, dz: number, face: { axis: number; sign: number }): [number, number, number] {
  const a = face.axis, s = face.sign;
  if (a === 0) return [-dz * s, -dy, dx * s];
  if (a === 1) return [dx, dz * s, dy * s];
  return [dx * s, -dy, dz * s];
}

const POINT_NEAR = 0.05;

/**
 * Omnidirectional shadow for the first point light: six 90° depth faces around the light.
 * Depth is stored as 1 − near/w (hyperbolic, hence screen-affine — the DepthMap's affine
 * interpolation is exact for it). Sampling picks the face by dominant axis and applies the
 * same tent-weighted PCF as the sun map, with out-of-map taps lit.
 */
function buildPointShadow(light: ResolvedLight, batches: MeshBatch[], maps: DepthMap[]): ShadowContext | undefined {
  const casters = batches.filter((b) => b.node.mesh?.geometry.kind !== "plane" && b.material.opacity >= 1);
  if (casters.length === 0) return undefined;
  const [lx, ly, lz] = light.position;
  const size = maps[0]!.size;
  const half = size / 2;

  for (let f = 0; f < 6; f++) {
    const face = CUBE_FACES[f]!;
    const map = maps[f]!;
    map.clear();
    for (const b of casters) {
      const idx = b.md.indices;
      for (let t = 0; t < idx.length; t += 3) {
        // Gather face-space verts; clip against the face near plane (w = POINT_NEAR).
        const poly: number[][] = [];
        for (const vi of [idx[t]!, idx[t + 1]!, idx[t + 2]!]) {
          const [x, y, w] = faceCoords(b.wx[vi]! - lx, b.wy[vi]! - ly, b.wz[vi]! - lz, face);
          poly.push([x, y, 0, w]);
        }
        const inFront = poly.filter((v) => v[3]! >= POINT_NEAR).length;
        if (inFront === 0) continue;
        const clipped = inFront === 3 ? poly : clipNear(poly, POINT_NEAR);
        for (let k = 1; k + 1 < clipped.length; k++) {
          const tri = [clipped[0]!, clipped[k]!, clipped[k + 1]!];
          const pts = tri.map((v) => {
            const w = v[3]!;
            return [(v[0]! / w) * half + half, (v[1]! / w) * half + half, 1 - POINT_NEAR / w];
          });
          map.triangle(
            pts[0]![0]!, pts[0]![1]!, pts[0]![2]!,
            pts[1]![0]!, pts[1]![1]!, pts[1]![2]!,
            pts[2]![0]!, pts[2]![1]!, pts[2]![2]!,
          );
        }
      }
    }
  }

  return {
    factor(wpx, wpy, wpz, lambert) {
      const dx = wpx - lx, dy = wpy - ly, dz = wpz - lz;
      const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
      let f: number;
      if (ax >= ay && ax >= az) f = dx >= 0 ? 0 : 1;
      else if (ay >= ax && ay >= az) f = dy >= 0 ? 2 : 3;
      else f = dz >= 0 ? 4 : 5;
      const face = CUBE_FACES[f]!;
      const [x, y, w] = faceCoords(dx, dy, dz, face);
      if (w < POINT_NEAR) return 1;
      const size2 = maps[f]!.size, half2 = size2 / 2;
      const sx = (x / w) * half2 + half2;
      const sy = (y / w) * half2 + half2;
      const sz = 1 - POINT_NEAR / w;
      const data = maps[f]!.data;
      const ix = Math.floor(sx), iy = Math.floor(sy);
      const bias = 0.002 + 0.01 * (1 - lambert);
      let lit = 0, total = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const yy = iy + oy;
        const wy = Math.max(0, 1.5 - Math.abs(yy + 0.5 - sy));
        for (let ox = -1; ox <= 1; ox++) {
          const xx = ix + ox;
          const wgt = wy * Math.max(0, 1.5 - Math.abs(xx + 0.5 - sx));
          total += wgt;
          const outside = xx < 0 || xx >= size2 || yy < 0 || yy >= size2;
          if (outside || sz - bias <= data[yy * size2 + xx]!) lit += wgt;
        }
      }
      return total === 0 ? 1 : lit / total;
    },
  };
}

export interface SoftwareEngineOptions {
  /**
   * Supersampling factor: the frame is shaded at N× resolution in linear space and box-filtered
   * down (anti-aliasing). 1 disables it. Default 2 — 4 shaded samples per output pixel.
   */
  supersample?: number;
  /** Disable the directional-light shadow map (on by default). */
  shadows?: boolean;
  /** Shadow map resolution (texels per side). Default 1024; lower = softer/cheaper shadows. */
  shadowMapSize?: number;
  /**
   * Render only output rows [y0, y1) — the tiled-rendering band (R5.3). Each band engine pays
   * the vertex/shadow passes but rasterizes only its rows (plus an internal margin so manga
   * outlines are seam-free); stitching N bands is byte-identical to one full-frame render.
   * Run one band engine per worker for parallel rendering.
   */
  region?: { y0: number; y1: number };
}

/**
 * Pure-TypeScript reference renderer. No GPU, no native deps — runs identically everywhere,
 * which makes it the determinism oracle and the default headless renderer. Per-pixel lighting
 * (Lambert diffuse + Blinn-Phong specular driven by material roughness/metalness), PCF shadow
 * mapping for the first directional light, linear distance fog, supersampled anti-aliasing,
 * and a z-buffer.
 */
export class SoftwareEngine implements Engine {
  readonly width: number;
  readonly height: number;
  readonly supersample: number;
  readonly shadows: boolean;
  readonly region?: { y0: number; y1: number };
  private hi: LinearBuffer; // hi-res linear-space target: all 3D shading lands here
  private fb: Framebuffer; // output-res gamma-space target: resolve + overlays
  private shadowMap: DepthMap;
  private pointMaps?: DepthMap[];
  private meshes = new Map<string, MeshData>();
  private tangentCache = new WeakMap<MeshData, Float32Array>();
  private mipCache = new WeakMap<object, ReturnType<typeof buildMips>>();

  constructor(width: number, height: number, opts: SoftwareEngineOptions = {}) {
    this.width = width;
    this.height = height;
    this.supersample = Math.max(1, Math.floor(opts.supersample ?? 2));
    this.shadows = opts.shadows ?? true;
    this.shadowMap = new DepthMap(Math.max(2, Math.floor(opts.shadowMapSize ?? SHADOW_MAP_SIZE)));
    this.hi = new LinearBuffer(width, height, this.supersample);
    this.fb = new Framebuffer(width, height);
    this.region = opts.region ? { y0: Math.max(0, opts.region.y0), y1: Math.min(height, opts.region.y1) } : undefined;
    if (this.region) {
      // Rasterize a margin beyond the band so the outline pass (which reads neighbor depth,
      // then dilates by supersample-1) sees valid depth at the band boundary.
      const margin = this.supersample * 2;
      this.hi.rasterY0 = Math.max(0, this.region.y0 * this.supersample - margin);
      this.hi.rasterY1 = Math.min(this.hi.height, this.region.y1 * this.supersample + margin);
    }
  }

  init(doc: SceneDocument): void {
    for (const node of doc.nodes) {
      if (node.mesh) this.meshes.set(node.id, tessellate(node.mesh.geometry));
    }
  }

  /** Inject mesh data for a node (e.g. a loaded glTF mesh). */
  loadMesh(nodeId: string, data: MeshData): void {
    this.meshes.set(nodeId, data);
  }

  /** Mip chain for a texture, built once and cached by texture identity. */
  private mipsOf(tex: { width: number; height: number; data: Uint8Array }) {
    let mips = this.mipCache.get(tex);
    if (!mips) {
      mips = buildMips(tex);
      this.mipCache.set(tex, mips);
    }
    return mips;
  }

  renderFrame(state: FrameState): void {
    if (state.sky) this.hi.clearGradient(state.sky.top, state.sky.bottom);
    else this.hi.clear(state.background);
    const viewProj = mat4.multiply(state.camera.projMatrix, state.camera.viewMatrix);
    // Visible sun: painted into the sky straight after the clear — geometry simply draws over
    // it, so no depth interaction is needed. Position = the first directional light's source
    // direction projected at infinity (clip = VP · [-dir, 0]).
    if (state.sky?.sun) {
      const sunLight = state.lights.find((l) => l.type === "directional");
      if (sunLight) {
        const d = v3.normalize(sunLight.direction);
        const M = viewProj;
        const sxc = -(M[0]! * d[0] + M[4]! * d[1] + M[8]! * d[2]);
        const syc = -(M[1]! * d[0] + M[5]! * d[1] + M[9]! * d[2]);
        const swc = -(M[3]! * d[0] + M[7]! * d[1] + M[11]! * d[2]);
        if (swc > 1e-6) {
          const cxp = ((sxc / swc) * 0.5 + 0.5) * this.hi.width;
          const cyp = (0.5 - (syc / swc) * 0.5) * this.hi.height;
          const col = state.sky.sun.color ?? sunLight.color;
          this.hi.paintSun(cxp, cyp, state.sky.sun.size * this.hi.height, state.sky.sun.glow * this.hi.height, col);
        }
      }
    }
    const hiW = this.hi.width;
    const hiH = this.hi.height;
    const toon = state.style === "manga";
    const cam = state.camera.position;
    const fog = state.fog;

    // ---- pass 1: transform every mesh's vertices once (morphs + skinning + world + clip) ----
    const batches: MeshBatch[] = [];
    for (const node of state.nodes) {
      if (!node.mesh) continue;
      const md = this.meshes.get(node.id);
      if (!md || md.indices.length === 0) continue;
      const material = node.material ?? DEFAULT_MATERIAL;
      const vcount = md.positions.length / 3;

      const wx = new Float64Array(vcount), wy = new Float64Array(vcount), wz = new Float64Array(vcount);
      const nx = new Float64Array(vcount), ny = new Float64Array(vcount), nz = new Float64Array(vcount);
      const cx = new Float64Array(vcount), cy = new Float64Array(vcount), cz = new Float64Array(vcount), cw = new Float64Array(vcount);
      const useUV = md.uvs !== undefined &&
        (md.texture !== undefined || md.normalMap !== undefined || md.metallicRoughnessMap !== undefined ||
          md.occlusionMap !== undefined || md.emissiveMap !== undefined);
      const cu = useUV ? new Float64Array(vcount) : undefined;
      const cv = useUV ? new Float64Array(vcount) : undefined;
      // Normal mapping needs per-vertex tangents (computed once per mesh, deformed per frame).
      const hasNormalMap = useUV && md.normalMap !== undefined;
      let bindTangents: Float32Array | undefined;
      if (hasNormalMap) {
        bindTangents = this.tangentCache.get(md);
        if (!bindTangents) {
          bindTangents = computeTangents(md);
          this.tangentCache.set(md, bindTangents);
        }
      }
      const tx = hasNormalMap ? new Float64Array(vcount) : undefined;
      const ty = hasNormalMap ? new Float64Array(vcount) : undefined;
      const tz = hasNormalMap ? new Float64Array(vcount) : undefined;
      const tw = hasNormalMap ? new Float64Array(vcount) : undefined;

      // Skinned meshes deform per-vertex by blended joint matrices (CPU linear-blend skinning);
      // static meshes use the node's world matrix.
      const jm = node.skin?.jointMatrices;
      const skinned = jm !== undefined && md.joints !== undefined && md.weights !== undefined;

      // Active morph targets (blend shapes): displace each vertex by Σ weightᵢ·deltaᵢ before skinning.
      const morphs = md.morphTargets && node.morphWeights
        ? md.morphTargets.map((t, i) => ({ deltas: t.deltas, w: node.morphWeights![i] ?? 0 })).filter((m) => m.w !== 0)
        : [];

      for (let i = 0; i < vcount; i++) {
        const pos: Vec3 = [md.positions[i * 3]!, md.positions[i * 3 + 1]!, md.positions[i * 3 + 2]!];
        for (const m of morphs) {
          pos[0] += m.w * m.deltas[i * 3]!;
          pos[1] += m.w * m.deltas[i * 3 + 1]!;
          pos[2] += m.w * m.deltas[i * 3 + 2]!;
        }
        const nrm: Vec3 = [md.normals[i * 3]!, md.normals[i * 3 + 1]!, md.normals[i * 3 + 2]!];
        const m = skinned ? skinningMatrix(jm!, md.joints!, md.weights!, i) : node.worldMatrix;
        const wp4 = mat4.transformPoint(m, pos);
        const wn = v3.normalize(mat4.transformDir(m, nrm));
        wx[i] = wp4[0]; wy[i] = wp4[1]; wz[i] = wp4[2];
        nx[i] = wn[0]; ny[i] = wn[1]; nz[i] = wn[2];
        if (useUV) {
          cu![i] = md.uvs![i * 2]!;
          cv![i] = md.uvs![i * 2 + 1]!;
        }
        if (hasNormalMap) {
          const wt = v3.normalize(mat4.transformDir(m, [bindTangents![i * 4]!, bindTangents![i * 4 + 1]!, bindTangents![i * 4 + 2]!]));
          tx![i] = wt[0]; ty![i] = wt[1]; tz![i] = wt[2]; tw![i] = bindTangents![i * 4 + 3]!;
        }
        const clip = mat4.transformPoint(viewProj, [wp4[0], wp4[1], wp4[2]]);
        cx[i] = clip[0]; cy[i] = clip[1]; cz[i] = clip[2]; cw[i] = clip[3];
      }

      batches.push({ node, md, material, useUV, wx, wy, wz, nx, ny, nz, cx, cy, cz, cw, cu, cv, tx, ty, tz, tw });
    }

    // ---- pass 2: shadow maps — first directional light + first point light ----
    const sun = this.shadows ? state.lights.find((l) => l.type === "directional") : undefined;
    const shadow = sun ? buildShadow(sun, batches, this.shadowMap) : undefined;
    const lamp = this.shadows ? state.lights.find((l) => l.type === "point") : undefined;
    let lampShadow: ShadowContext | undefined;
    if (lamp) {
      if (!this.pointMaps) this.pointMaps = Array.from({ length: 6 }, () => new DepthMap(256));
      lampShadow = buildPointShadow(lamp, batches, this.pointMaps);
    }

    // ---- pass 3: shade + rasterize. Opaque first; then transparent triangles (opacity < 1)
    // sorted back-to-front across ALL transparent meshes, alpha-blended without depth writes. ----
    const prepareDraw = (b: MeshBatch) => {
      const { md, material, useUV } = b;
      const tex = md.texture, nrmMap = md.normalMap, mrMap = md.metallicRoughnessMap;
      const aoMap = md.occlusionMap, emiMap = md.emissiveMap;
      const hasTangents = b.tx !== undefined;
      // Mip chains for the color maps (albedo/emissive) — the ones where minification shimmer
      // is visible. Data maps (normal/MR/AO) sample base level. LOD is chosen per triangle
      // from the texel-to-pixel area ratio and blended trilinearly between levels.
      const albMips = tex ? this.mipsOf(tex) : undefined;
      const emiMips = emiMap ? this.mipsOf(emiMap) : undefined;
      const albDim = tex ? Math.max(tex.width, tex.height) : 0;
      const emiDim = emiMap ? Math.max(emiMap.width, emiMap.height) : 0;
      const wantLod = (albMips?.length ?? 1) > 1 || (emiMips?.length ?? 1) > 1;
      // Attr layout: [wx,wy,wz, nx,ny,nz] + [u,v]? + [tx,ty,tz,tw]?; the rasterizer appends
      // the per-pixel UV footprint (uv units/pixel) one slot past the attrs when requested.
      const attrCount = 6 + (useUV ? 2 : 0) + (hasTangents ? 4 : 0);
      const shadePx = (a: Float64Array, out: Vec3): void => {
        const u = useUV ? a[6]! : 0, v = useUV ? a[7]! : 0;
        const rho = wantLod ? a[attrCount]! : 0;

        // Geometric normal, renormalized after interpolation.
        let nX = a[3]!, nY = a[4]!, nZ = a[5]!;
        {
          const nl = Math.sqrt(nX * nX + nY * nY + nZ * nZ) || 1;
          nX /= nl; nY /= nl; nZ /= nl;
        }
        // Tangent-space normal mapping: perturb the geometric normal by the sampled texel.
        if (nrmMap && hasTangents) {
          let tX = a[8]!, tY = a[9]!, tZ = a[10]!;
          const w = a[11]! < 0 ? -1 : 1;
          // Re-orthogonalize the interpolated tangent against the normal.
          const d = nX * tX + nY * tY + nZ * tZ;
          tX -= nX * d; tY -= nY * d; tZ -= nZ * d;
          const tl = Math.sqrt(tX * tX + tY * tY + tZ * tZ);
          if (tl > 1e-8) {
            tX /= tl; tY /= tl; tZ /= tl;
            const bX = (nY * tZ - nZ * tY) * w, bY = (nZ * tX - nX * tZ) * w, bZ = (nX * tY - nY * tX) * w;
            const tn = sampleTexel(nrmMap, u, v, false);
            const sx = tn[0] * 2 - 1, sy = tn[1] * 2 - 1, sz = tn[2] * 2 - 1;
            let pX = tX * sx + bX * sy + nX * sz;
            let pY = tY * sx + bY * sy + nY * sz;
            let pZ = tZ * sx + bZ * sy + nZ * sz;
            const pl = Math.sqrt(pX * pX + pY * pY + pZ * pZ);
            if (pl > 1e-8) { nX = pX / pl; nY = pY / pl; nZ = pZ / pl; }
          }
        }

        let albR: number, albG: number, albB: number;
        if (albMips) {
          const lod = rho > 0 ? Math.log2(Math.max(rho * albDim, 1)) : 0;
          const alb = sampleTexelLod(albMips, u, v, lod, true);
          albR = alb[0]; albG = alb[1]; albB = alb[2];
        } else {
          albR = material.color[0]; albG = material.color[1]; albB = material.color[2];
        }

        // glTF factor semantics: map values multiply the material's scalar factors.
        let roughness = material.roughness, metalness = material.metalness;
        if (mrMap) {
          const mr = sampleTexel(mrMap, u, v, false); // G = roughness, B = metalness
          roughness *= mr[1]; metalness *= mr[2];
        }
        const ao = aoMap ? sampleTexel(aoMap, u, v, false)[0] : 1;
        let emiR = material.emissive[0], emiG = material.emissive[1], emiB = material.emissive[2];
        if (emiMips) {
          const lod = rho > 0 ? Math.log2(Math.max(rho * emiDim, 1)) : 0;
          const em = sampleTexelLod(emiMips, u, v, lod, true);
          emiR = em[0]; emiG = em[1]; emiB = em[2];
        }

        shadePixel(a[0]!, a[1]!, a[2]!, nX, nY, nZ, albR, albG, albB, emiR, emiG, emiB, roughness, metalness, ao, state.lights, cam, toon, sun, shadow, lamp, lampShadow, out);
        if (fog) {
          const dx = a[0]! - cam[0], dy = a[1]! - cam[1], dz = a[2]! - cam[2];
          const t = (Math.sqrt(dx * dx + dy * dy + dz * dz) - fog.near) / (fog.far - fog.near);
          if (t > 0) {
            const k = t >= 1 ? 1 : t;
            out[0] += (fog.color[0] - out[0]) * k;
            out[1] += (fog.color[1] - out[1]) * k;
            out[2] += (fog.color[2] - out[2]) * k;
          }
        }
      };

      const project = (i: number): [number, number, number, number] => {
        const w = b.cw[i]!;
        return [((b.cx[i]! / w) * 0.5 + 0.5) * hiW, (0.5 - (b.cy[i]! / w) * 0.5) * hiH, b.cz[i]! / w, 1 / w];
      };
      const projectV = (v: number[]): [number, number, number, number] => {
        const w = v[3]!;
        return [((v[0]! / w) * 0.5 + 0.5) * hiW, (0.5 - (v[1]! / w) * 0.5) * hiH, v[2]! / w, 1 / w];
      };
      const attrsOf = (i: number): number[] => {
        const a = [b.wx[i]!, b.wy[i]!, b.wz[i]!, b.nx[i]!, b.ny[i]!, b.nz[i]!];
        if (useUV) a.push(b.cu![i]!, b.cv![i]!);
        if (hasTangents) a.push(b.tx![i]!, b.ty![i]!, b.tz![i]!, b.tw![i]!);
        return a;
      };

      const uvIdx = useUV && wantLod ? 6 : -1;
      // Draw triangle t (index into md.indices) with the given alpha (1 = opaque).
      const drawTri = (t: number, alpha: number): void => {
        const a = md.indices[t]!, b2 = md.indices[t + 1]!, c = md.indices[t + 2]!;
        const ain = b.cw[a]! >= W_NEAR, bin = b.cw[b2]! >= W_NEAR, cin = b.cw[c]! >= W_NEAR;

        if (ain && bin && cin) {
          // Fully in front: project directly.
          this.hi.triangleShaded(project(a), attrsOf(a), project(b2), attrsOf(b2), project(c), attrsOf(c), shadePx, uvIdx, alpha);
          return;
        }
        if (!ain && !bin && !cin) return; // wholly behind the near plane

        // Straddles the near plane: clip to a polygon, then fan-triangulate the visible part.
        const vert = (i: number): number[] => [b.cx[i]!, b.cy[i]!, b.cz[i]!, b.cw[i]!, ...attrsOf(i)];
        const poly = clipNear([vert(a), vert(b2), vert(c)]);
        for (let k = 1; k + 1 < poly.length; k++) {
          const v0 = poly[0]!, v1 = poly[k]!, v2 = poly[k + 1]!;
          this.hi.triangleShaded(
            projectV(v0), v0.slice(4),
            projectV(v1), v1.slice(4),
            projectV(v2), v2.slice(4),
            shadePx, uvIdx, alpha,
          );
        }
      };
      return drawTri;
    };

    // Opaque pass.
    for (const b of batches) {
      if (b.material.opacity < 1) continue;
      const drawTri = prepareDraw(b);
      for (let t = 0; t < b.md.indices.length; t += 3) drawTri(t, 1);
    }

    // Transparent pass: painter's algorithm across every transparent mesh — sort by mean view
    // depth (clip w), farthest first, blend over the opaque image without writing depth.
    const transparent = batches.filter((b) => b.material.opacity < 1);
    if (transparent.length) {
      const items: { drawTri: (t: number, alpha: number) => void; t: number; alpha: number; depth: number }[] = [];
      for (const b of transparent) {
        const drawTri = prepareDraw(b);
        const alpha = b.material.opacity;
        for (let t = 0; t < b.md.indices.length; t += 3) {
          const a = b.md.indices[t]!, b2 = b.md.indices[t + 1]!, c = b.md.indices[t + 2]!;
          items.push({ drawTri, t, alpha, depth: (b.cw[a]! + b.cw[b2]! + b.cw[c]!) / 3 });
        }
      }
      items.sort((x, y) => y.depth - x.depth);
      for (const it of items) it.drawTri(it.t, it.alpha);
    }

    // Particles: camera-facing splats, sorted back-to-front, depth-tested against geometry
    // (no depth write) and alpha-blended. Screen radius from perspective projection of the size.
    if (state.particles.length) {
      const P = state.camera.projMatrix;
      const items: { x: number; y: number; z: number; r: number; w: number; p: (typeof state.particles)[number] }[] = [];
      for (const pt of state.particles) {
        const clip = mat4.transformPoint(viewProj, pt.position);
        const w = clip[3];
        if (w < W_NEAR) continue;
        items.push({
          x: ((clip[0] / w) * 0.5 + 0.5) * hiW,
          y: (0.5 - (clip[1] / w) * 0.5) * hiH,
          z: clip[2] / w,
          r: (pt.size * P[5]! * 0.5 * hiH) / w,
          w,
          p: pt,
        });
      }
      items.sort((a, b) => b.w - a.w);
      for (const it of items) this.hi.splat(it.x, it.y, it.r, it.z, it.p.color, it.p.opacity);
    }

    if (toon) this.hi.outline([0.04, 0.05, 0.08]); // manga: dark silhouette/edge lines

    this.hi.resolveTo(this.fb, state.tone === "aces", this.region?.y0 ?? 0, this.region?.y1 ?? Infinity); // linear box-filter → gamma-encoded output

    if (state.overlays.length) compositeOverlays(this.fb, state.overlays, this.width, this.height); // screen-space text
  }

  readPixels(): Uint8ClampedArray {
    return this.fb.color;
  }

  dispose(): void {
    this.meshes.clear();
  }
}

/** Quantize the diffuse term into hard bands for cel/manga shading (0, then 3 lit steps). */
function bandLambert(x: number): number {
  return x <= 0 ? 0 : Math.ceil(Math.min(x, 1) * 3) / 3;
}

/**
 * Per-pixel shading in linear space: emissive + per-light Lambert diffuse, plus a Blinn-Phong
 * specular lobe for directional/point lights driven by roughness (lobe width via a
 * Beckmann-style exponent) and metalness (F0 = 4% dielectric → albedo-tinted metal; metals
 * lose direct diffuse). Surface parameters arrive pre-resolved (material factors × PBR map
 * texels; the normal is already normalized and normal-mapped). `ao` darkens the ambient and
 * hemisphere terms only, per glTF occlusion semantics. The first directional light (`sun`) is
 * attenuated by the PCF shadow factor when a shadow map is present. Manga (toon) mode keeps
 * the banded, specular-free cel look — with hard-thresholded shadows to match.
 */
function shadePixel(
  px: number, py: number, pz: number,
  nX: number, nY: number, nZ: number,
  albR: number, albG: number, albB: number,
  emiR: number, emiG: number, emiB: number,
  roughness: number, metal: number, ao: number,
  lights: ResolvedLight[], cam: Vec3, toon: boolean,
  sun: ResolvedLight | undefined, shadow: ShadowContext | undefined,
  lamp: ResolvedLight | undefined, lampShadow: ShadowContext | undefined, out: Vec3,
): void {
  let r = emiR, g = emiG, b = emiB;

  const kd = 1 - metal;
  // Specular reflectance at normal incidence: 4% dielectric, albedo-tinted for metals.
  const f0r = 0.04 * kd + albR * metal;
  const f0g = 0.04 * kd + albG * metal;
  const f0b = 0.04 * kd + albB * metal;
  // Blinn-Phong exponent from roughness (Beckmann-style α = roughness²), with an energy
  // normalization so tight lobes peak brighter than broad ones.
  const alpha = Math.max(roughness * roughness, 0.02);
  const specExp = 2 / (alpha * alpha) - 2;
  const specNorm = (specExp + 8) / 8;

  // View vector (pixel → camera), for the specular half-vector.
  let vX = cam[0] - px, vY = cam[1] - py, vZ = cam[2] - pz;
  const vl = Math.sqrt(vX * vX + vY * vY + vZ * vZ) || 1;
  vX /= vl; vY /= vl; vZ /= vl;

  for (const light of lights) {
    if (light.type === "ambient") {
      const f = light.intensity * ao; // occlusion darkens ambient terms only
      r += albR * light.color[0] * f;
      g += albG * light.color[1] * f;
      b += albB * light.color[2] * f;
      continue;
    }
    if (light.type === "hemisphere") {
      // Blend ground→sky tint by how upward-facing the surface is.
      const f = nY * 0.5 + 0.5;
      const sky = light.skyColor ?? [1, 1, 1];
      const ground = light.groundColor ?? [0.3, 0.3, 0.3];
      const inten = light.intensity * ao;
      r += albR * (ground[0] + (sky[0] - ground[0]) * f) * inten;
      g += albG * (ground[1] + (sky[1] - ground[1]) * f) * inten;
      b += albB * (ground[2] + (sky[2] - ground[2]) * f) * inten;
      continue;
    }
    let lX: number, lY: number, lZ: number;
    let atten = 1;
    if (light.type === "directional") {
      lX = -light.direction[0]; lY = -light.direction[1]; lZ = -light.direction[2];
    } else {
      lX = light.position[0] - px; lY = light.position[1] - py; lZ = light.position[2] - pz;
      const ll = Math.sqrt(lX * lX + lY * lY + lZ * lZ) || 1;
      lX /= ll; lY /= ll; lZ /= ll;
      // Distance falloff: 1/(1+d^decay) — decay 0 keeps the legacy unattenuated look.
      if (light.decay) atten = 1 / (1 + Math.pow(ll, light.decay));
    }
    let lambert = nX * lX + nY * lY + nZ * lZ;
    if (lambert <= 0) continue;

    // Shadows: the mapped sun and lamp lights are attenuated. Toon thresholds to hard cel shadow.
    let vis = 1;
    if (shadow && light === sun) vis = shadow.factor(px, py, pz, lambert);
    else if (lampShadow && light === lamp) vis = lampShadow.factor(px, py, pz, lambert);
    if (vis !== 1) {
      if (toon) vis = vis < 0.5 ? 0 : 1;
      if (vis === 0) continue;
    }

    if (toon) {
      // Cel shading: banded diffuse, no specular.
      const f = bandLambert(lambert) * light.intensity * atten * vis;
      r += albR * light.color[0] * f;
      g += albG * light.color[1] * f;
      b += albB * light.color[2] * f;
      continue;
    }
    const diff = lambert * light.intensity * atten * kd * vis;
    r += albR * light.color[0] * diff;
    g += albG * light.color[1] * diff;
    b += albB * light.color[2] * diff;

    // Blinn-Phong specular: half-vector between light and view.
    let hX = lX + vX, hY = lY + vY, hZ = lZ + vZ;
    const hl = Math.sqrt(hX * hX + hY * hY + hZ * hZ);
    if (hl === 0) continue;
    hX /= hl; hY /= hl; hZ /= hl;
    const ndh = nX * hX + nY * hY + nZ * hZ;
    if (ndh <= 0) continue;
    const s = Math.pow(ndh, specExp) * specNorm * lambert * light.intensity * atten * vis;
    r += f0r * light.color[0] * s;
    g += f0g * light.color[1] * s;
    b += f0b * light.color[2] * s;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
}

export { Framebuffer, LinearBuffer, DepthMap } from "./raster.js";
export { compositeOverlays } from "./overlay.js";
