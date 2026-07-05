import {
  mat4, v3, tessellate, skinningMatrix,
  type Engine, type FrameState, type SceneDocument,
  type Material, type MeshData, type ResolvedLight, type Vec3,
} from "@vsim/core";
import { Framebuffer, LinearBuffer, sampleAlbedo } from "./raster.js";
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

export interface SoftwareEngineOptions {
  /**
   * Supersampling factor: the frame is shaded at N× resolution in linear space and box-filtered
   * down (anti-aliasing). 1 disables it. Default 2 — 4 shaded samples per output pixel.
   */
  supersample?: number;
}

/**
 * Pure-TypeScript reference renderer. No GPU, no native deps — runs identically everywhere,
 * which makes it the determinism oracle and the default headless renderer. Per-pixel lighting
 * (Lambert diffuse + Blinn-Phong specular driven by material roughness/metalness), supersampled
 * anti-aliasing, and a z-buffer.
 */
export class SoftwareEngine implements Engine {
  readonly width: number;
  readonly height: number;
  readonly supersample: number;
  private hi: LinearBuffer; // hi-res linear-space target: all 3D shading lands here
  private fb: Framebuffer; // output-res gamma-space target: resolve + overlays
  private meshes = new Map<string, MeshData>();

  constructor(width: number, height: number, opts: SoftwareEngineOptions = {}) {
    this.width = width;
    this.height = height;
    this.supersample = Math.max(1, Math.floor(opts.supersample ?? 2));
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

    for (const node of state.nodes) {
      if (!node.mesh) continue;
      const md = this.meshes.get(node.id);
      if (!md || md.indices.length === 0) continue;
      const material = node.material ?? DEFAULT_MATERIAL;
      const vcount = md.positions.length / 3;

      // Clip-space coords (pre-divide) + world-space position/normal per vertex, kept so
      // triangles straddling the near plane can be clipped rather than dropped.
      const cx = new Float64Array(vcount);
      const cy = new Float64Array(vcount);
      const cz = new Float64Array(vcount);
      const cw = new Float64Array(vcount);
      const wx = new Float64Array(vcount);
      const wy = new Float64Array(vcount);
      const wz = new Float64Array(vcount);
      const nx = new Float64Array(vcount);
      const ny = new Float64Array(vcount);
      const nz = new Float64Array(vcount);
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

      // Per-pixel shader for this mesh: attrs = [wx,wy,wz, nx,ny,nz, (u,v)] interpolated.
      const tex = md.texture;
      const shadePx = (a: Float64Array, out: Vec3): void => {
        let albR: number, albG: number, albB: number;
        if (tex && textured) {
          const alb = sampleAlbedo(tex, a[6]!, a[7]!);
          albR = alb[0]; albG = alb[1]; albB = alb[2];
        } else {
          albR = material.color[0]; albG = material.color[1]; albB = material.color[2];
        }
        shadePixel(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, albR, albG, albB, material, state.lights, cam, toon, out);
      };

      const project = (i: number): [number, number, number] => {
        const w = cw[i]!;
        return [((cx[i]! / w) * 0.5 + 0.5) * hiW, (0.5 - (cy[i]! / w) * 0.5) * hiH, cz[i]! / w];
      };
      const projectV = (v: number[]): [number, number, number] => {
        const w = v[3]!;
        return [((v[0]! / w) * 0.5 + 0.5) * hiW, (0.5 - (v[1]! / w) * 0.5) * hiH, v[2]! / w];
      };
      const attrsOf = (i: number): number[] =>
        textured
          ? [wx[i]!, wy[i]!, wz[i]!, nx[i]!, ny[i]!, nz[i]!, cu![i]!, cv![i]!]
          : [wx[i]!, wy[i]!, wz[i]!, nx[i]!, ny[i]!, nz[i]!];

      const idx = md.indices;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
        const ain = cw[a]! >= W_NEAR, bin = cw[b]! >= W_NEAR, cin = cw[c]! >= W_NEAR;

        if (ain && bin && cin) {
          // Fully in front: project directly.
          this.hi.triangleShaded(project(a), attrsOf(a), project(b), attrsOf(b), project(c), attrsOf(c), shadePx);
          continue;
        }
        if (!ain && !bin && !cin) continue; // wholly behind the near plane

        // Straddles the near plane: clip to a polygon, then fan-triangulate the visible part.
        const vert = (i: number): number[] => [cx[i]!, cy[i]!, cz[i]!, cw[i]!, ...attrsOf(i)];
        const poly = clipNear([vert(a), vert(b), vert(c)]);
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
 * lose direct diffuse). Ambient/hemisphere terms are diffuse-only, unchanged from the classic
 * path. Manga (toon) mode keeps the banded, specular-free cel look.
 */
function shadePixel(
  px: number, py: number, pz: number,
  nxr: number, nyr: number, nzr: number,
  albR: number, albG: number, albB: number,
  mat: Material, lights: ResolvedLight[], cam: Vec3, toon: boolean, out: Vec3,
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
    if (toon) {
      // Cel shading: banded diffuse, no specular.
      const f = bandLambert(lambert) * light.intensity;
      r += albR * light.color[0] * f;
      g += albG * light.color[1] * f;
      b += albB * light.color[2] * f;
      continue;
    }
    const diff = lambert * light.intensity * kd;
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
    const s = Math.pow(ndh, specExp) * specNorm * lambert * light.intensity;
    r += f0r * light.color[0] * s;
    g += f0g * light.color[1] * s;
    b += f0b * light.color[2] * s;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
}

export { Framebuffer, LinearBuffer } from "./raster.js";
export { compositeOverlays } from "./overlay.js";
