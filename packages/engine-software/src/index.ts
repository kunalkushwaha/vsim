import {
  mat4, v3, tessellate, skinningMatrix,
  type Engine, type FrameState, type SceneDocument,
  type Material, type MeshData, type ResolvedLight, type ResolvedNode, type Vec3,
} from "@vsim/core";
import { Framebuffer, LinearBuffer, DepthMap, sampleAlbedo } from "./raster.js";
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
function clipNear(poly: number[][]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const nxt = poly[(i + 1) % poly.length]!;
    const curIn = cur[3]! >= W_NEAR;
    const nxtIn = nxt[3]! >= W_NEAR;
    if (curIn) out.push(cur);
    if (curIn !== nxtIn) {
      const tParam = (W_NEAR - cur[3]!) / (nxt[3]! - cur[3]!);
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
  textured: boolean;
  wx: Float64Array; wy: Float64Array; wz: Float64Array;
  nx: Float64Array; ny: Float64Array; nz: Float64Array;
  cx: Float64Array; cy: Float64Array; cz: Float64Array; cw: Float64Array;
  cu?: Float64Array; cv?: Float64Array;
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
  const casters = batches.filter((b) => b.node.mesh?.geometry.kind !== "plane");
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
      let lit = 0, taps = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = iy + dy;
        if (yy < 0 || yy >= size) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = ix + dx;
          if (xx < 0 || xx >= size) continue;
          taps++;
          if (lz - bias <= data[yy * size + xx]!) lit++;
        }
      }
      return taps === 0 ? 1 : lit / taps;
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
  private hi: LinearBuffer; // hi-res linear-space target: all 3D shading lands here
  private fb: Framebuffer; // output-res gamma-space target: resolve + overlays
  private shadowMap = new DepthMap(SHADOW_MAP_SIZE);
  private meshes = new Map<string, MeshData>();

  constructor(width: number, height: number, opts: SoftwareEngineOptions = {}) {
    this.width = width;
    this.height = height;
    this.supersample = Math.max(1, Math.floor(opts.supersample ?? 2));
    this.shadows = opts.shadows ?? true;
    this.hi = new LinearBuffer(width, height, this.supersample);
    this.fb = new Framebuffer(width, height);
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

  renderFrame(state: FrameState): void {
    if (state.sky) this.hi.clearGradient(state.sky.top, state.sky.bottom);
    else this.hi.clear(state.background);
    const viewProj = mat4.multiply(state.camera.projMatrix, state.camera.viewMatrix);
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
      const textured = md.texture !== undefined && md.uvs !== undefined;
      const cu = textured ? new Float64Array(vcount) : undefined;
      const cv = textured ? new Float64Array(vcount) : undefined;

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
        if (textured) {
          cu![i] = md.uvs![i * 2]!;
          cv![i] = md.uvs![i * 2 + 1]!;
        }
        const clip = mat4.transformPoint(viewProj, [wp4[0], wp4[1], wp4[2]]);
        cx[i] = clip[0]; cy[i] = clip[1]; cz[i] = clip[2]; cw[i] = clip[3];
      }

      batches.push({ node, md, material, textured, wx, wy, wz, nx, ny, nz, cx, cy, cz, cw, cu, cv });
    }

    // ---- pass 2: shadow map for the first directional light (all meshes cast + receive) ----
    const sun = this.shadows ? state.lights.find((l) => l.type === "directional") : undefined;
    const shadow = sun ? buildShadow(sun, batches, this.shadowMap) : undefined;

    // ---- pass 3: shade + rasterize ----
    for (const b of batches) {
      const { md, material, textured } = b;
      const tex = md.texture;
      const shadePx = (a: Float64Array, out: Vec3): void => {
        let albR: number, albG: number, albB: number;
        if (tex && textured) {
          const alb = sampleAlbedo(tex, a[6]!, a[7]!);
          albR = alb[0]; albG = alb[1]; albB = alb[2];
        } else {
          albR = material.color[0]; albG = material.color[1]; albB = material.color[2];
        }
        shadePixel(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, albR, albG, albB, material, state.lights, cam, toon, sun, shadow, out);
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

      const project = (i: number): [number, number, number] => {
        const w = b.cw[i]!;
        return [((b.cx[i]! / w) * 0.5 + 0.5) * hiW, (0.5 - (b.cy[i]! / w) * 0.5) * hiH, b.cz[i]! / w];
      };
      const projectV = (v: number[]): [number, number, number] => {
        const w = v[3]!;
        return [((v[0]! / w) * 0.5 + 0.5) * hiW, (0.5 - (v[1]! / w) * 0.5) * hiH, v[2]! / w];
      };
      const attrsOf = (i: number): number[] =>
        textured
          ? [b.wx[i]!, b.wy[i]!, b.wz[i]!, b.nx[i]!, b.ny[i]!, b.nz[i]!, b.cu![i]!, b.cv![i]!]
          : [b.wx[i]!, b.wy[i]!, b.wz[i]!, b.nx[i]!, b.ny[i]!, b.nz[i]!];

      const idx = md.indices;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!, b2 = idx[t + 1]!, c = idx[t + 2]!;
        const ain = b.cw[a]! >= W_NEAR, bin = b.cw[b2]! >= W_NEAR, cin = b.cw[c]! >= W_NEAR;

        if (ain && bin && cin) {
          // Fully in front: project directly.
          this.hi.triangleShaded(project(a), attrsOf(a), project(b2), attrsOf(b2), project(c), attrsOf(c), shadePx);
          continue;
        }
        if (!ain && !bin && !cin) continue; // wholly behind the near plane

        // Straddles the near plane: clip to a polygon, then fan-triangulate the visible part.
        const vert = (i: number): number[] => [b.cx[i]!, b.cy[i]!, b.cz[i]!, b.cw[i]!, ...attrsOf(i)];
        const poly = clipNear([vert(a), vert(b2), vert(c)]);
        for (let k = 1; k + 1 < poly.length; k++) {
          const v0 = poly[0]!, v1 = poly[k]!, v2 = poly[k + 1]!;
          this.hi.triangleShaded(
            projectV(v0), v0.slice(4),
            projectV(v1), v1.slice(4),
            projectV(v2), v2.slice(4),
            shadePx,
          );
        }
      }
    }

    if (toon) this.hi.outline([0.04, 0.05, 0.08]); // manga: dark silhouette/edge lines

    this.hi.resolveTo(this.fb); // linear box-filter → gamma-encoded output pixels

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
 * specular lobe for directional/point lights driven by the material's roughness (lobe width via
 * a Beckmann-style exponent) and metalness (F0 = 4% dielectric → albedo-tinted metal; metals
 * lose direct diffuse). The first directional light (`sun`) is attenuated by the PCF shadow
 * factor when a shadow map is present. Ambient/hemisphere terms are diffuse-only. Manga (toon)
 * mode keeps the banded, specular-free cel look — with hard-thresholded shadows to match.
 */
function shadePixel(
  px: number, py: number, pz: number,
  nxr: number, nyr: number, nzr: number,
  albR: number, albG: number, albB: number,
  mat: Material, lights: ResolvedLight[], cam: Vec3, toon: boolean,
  sun: ResolvedLight | undefined, shadow: ShadowContext | undefined, out: Vec3,
): void {
  // Renormalize the interpolated normal.
  const nl = Math.sqrt(nxr * nxr + nyr * nyr + nzr * nzr) || 1;
  const nX = nxr / nl, nY = nyr / nl, nZ = nzr / nl;

  let r = mat.emissive[0], g = mat.emissive[1], b = mat.emissive[2];

  const metal = mat.metalness;
  const kd = 1 - metal;
  // Specular reflectance at normal incidence: 4% dielectric, albedo-tinted for metals.
  const f0r = 0.04 * kd + albR * metal;
  const f0g = 0.04 * kd + albG * metal;
  const f0b = 0.04 * kd + albB * metal;
  // Blinn-Phong exponent from roughness (Beckmann-style α = roughness²), with an energy
  // normalization so tight lobes peak brighter than broad ones.
  const alpha = Math.max(mat.roughness * mat.roughness, 0.02);
  const specExp = 2 / (alpha * alpha) - 2;
  const specNorm = (specExp + 8) / 8;

  // View vector (pixel → camera), for the specular half-vector.
  let vX = cam[0] - px, vY = cam[1] - py, vZ = cam[2] - pz;
  const vl = Math.sqrt(vX * vX + vY * vY + vZ * vZ) || 1;
  vX /= vl; vY /= vl; vZ /= vl;

  for (const light of lights) {
    if (light.type === "ambient") {
      r += albR * light.color[0] * light.intensity;
      g += albG * light.color[1] * light.intensity;
      b += albB * light.color[2] * light.intensity;
      continue;
    }
    if (light.type === "hemisphere") {
      // Blend ground→sky tint by how upward-facing the surface is.
      const f = nY * 0.5 + 0.5;
      const sky = light.skyColor ?? [1, 1, 1];
      const ground = light.groundColor ?? [0.3, 0.3, 0.3];
      r += albR * (ground[0] + (sky[0] - ground[0]) * f) * light.intensity;
      g += albG * (ground[1] + (sky[1] - ground[1]) * f) * light.intensity;
      b += albB * (ground[2] + (sky[2] - ground[2]) * f) * light.intensity;
      continue;
    }
    let lX: number, lY: number, lZ: number;
    if (light.type === "directional") {
      lX = -light.direction[0]; lY = -light.direction[1]; lZ = -light.direction[2];
    } else {
      lX = light.position[0] - px; lY = light.position[1] - py; lZ = light.position[2] - pz;
      const ll = Math.sqrt(lX * lX + lY * lY + lZ * lZ) || 1;
      lX /= ll; lY /= ll; lZ /= ll;
    }
    let lambert = nX * lX + nY * lY + nZ * lZ;
    if (lambert <= 0) continue;

    // Shadow: only the mapped sun light is attenuated. Toon thresholds to a hard cel shadow.
    let vis = 1;
    if (shadow && light === sun) {
      vis = shadow.factor(px, py, pz, lambert);
      if (toon) vis = vis < 0.5 ? 0 : 1;
      if (vis === 0) continue;
    }

    if (toon) {
      // Cel shading: banded diffuse, no specular.
      const f = bandLambert(lambert) * light.intensity * vis;
      r += albR * light.color[0] * f;
      g += albG * light.color[1] * f;
      b += albB * light.color[2] * f;
      continue;
    }
    const diff = lambert * light.intensity * kd * vis;
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
    const s = Math.pow(ndh, specExp) * specNorm * lambert * light.intensity * vis;
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
