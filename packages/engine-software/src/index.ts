import {
  mat4, v3, tessellate, skinningMatrix,
  type Engine, type FrameState, type SceneDocument,
  type Material, type MeshData, type ResolvedLight, type Vec3,
} from "@vsim/core";
import { Framebuffer } from "./raster.js";

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
 * Each vertex is [x, y, z, w, r, g, b]; crossing edges get a linearly interpolated vertex.
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
      const v = new Array<number>(7);
      for (let k = 0; k < 7; k++) v[k] = cur[k]! + (nxt[k]! - cur[k]!) * tParam;
      out.push(v);
    }
  }
  return out;
}

/**
 * Pure-TypeScript reference renderer. No GPU, no native deps — runs identically everywhere,
 * which makes it the determinism oracle and the default headless renderer. Lambert shading
 * with per-vertex (Gouraud) lighting and a z-buffer.
 */
export class SoftwareEngine implements Engine {
  readonly width: number;
  readonly height: number;
  private fb: Framebuffer;
  private meshes = new Map<string, MeshData>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
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
    if (state.sky) this.fb.clearGradient(state.sky.top, state.sky.bottom);
    else this.fb.clear(state.background);
    const viewProj = mat4.multiply(state.camera.projMatrix, state.camera.viewMatrix);
    const { width, height } = this;
    const toon = state.style === "manga";

    for (const node of state.nodes) {
      if (!node.mesh) continue;
      const md = this.meshes.get(node.id);
      if (!md || md.indices.length === 0) continue;
      const material = node.material ?? DEFAULT_MATERIAL;
      const vcount = md.positions.length / 3;

      // Clip-space coords (pre-divide) + Gouraud color, kept so triangles straddling the near
      // plane can be clipped rather than dropped.
      const cx = new Float64Array(vcount);
      const cy = new Float64Array(vcount);
      const cz = new Float64Array(vcount);
      const cw = new Float64Array(vcount);
      const cr = new Float64Array(vcount);
      const cg = new Float64Array(vcount);
      const cb = new Float64Array(vcount);

      // Skinned meshes deform per-vertex by blended joint matrices (CPU linear-blend skinning);
      // static meshes use the node's world matrix.
      const jm = node.skin?.jointMatrices;
      const skinned = jm !== undefined && md.joints !== undefined && md.weights !== undefined;

      for (let i = 0; i < vcount; i++) {
        const pos: Vec3 = [md.positions[i * 3]!, md.positions[i * 3 + 1]!, md.positions[i * 3 + 2]!];
        const nrm: Vec3 = [md.normals[i * 3]!, md.normals[i * 3 + 1]!, md.normals[i * 3 + 2]!];
        const m = skinned ? skinningMatrix(jm!, md.joints!, md.weights!, i) : node.worldMatrix;
        const wp4 = mat4.transformPoint(m, pos);
        const wp: Vec3 = [wp4[0], wp4[1], wp4[2]];
        const wn = v3.normalize(mat4.transformDir(m, nrm));
        const col = shade(wp, wn, material, state.lights, toon);
        cr[i] = col[0]; cg[i] = col[1]; cb[i] = col[2];

        const clip = mat4.transformPoint(viewProj, wp);
        cx[i] = clip[0]; cy[i] = clip[1]; cz[i] = clip[2]; cw[i] = clip[3];
      }

      const project = (i: number): [number, number, number] => {
        const w = cw[i]!;
        return [((cx[i]! / w) * 0.5 + 0.5) * width, (0.5 - (cy[i]! / w) * 0.5) * height, cz[i]! / w];
      };
      const projectV = (v: number[]): [number, number, number] => {
        const w = v[3]!;
        return [((v[0]! / w) * 0.5 + 0.5) * width, (0.5 - (v[1]! / w) * 0.5) * height, v[2]! / w];
      };

      const idx = md.indices;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
        const ain = cw[a]! >= W_NEAR, bin = cw[b]! >= W_NEAR, cin = cw[c]! >= W_NEAR;

        if (ain && bin && cin) {
          // Fully in front: project directly (bit-identical to the unclipped path).
          this.fb.triangle(
            project(a), [cr[a]!, cg[a]!, cb[a]!],
            project(b), [cr[b]!, cg[b]!, cb[b]!],
            project(c), [cr[c]!, cg[c]!, cb[c]!],
          );
          continue;
        }
        if (!ain && !bin && !cin) continue; // wholly behind the near plane

        // Straddles the near plane: clip to a polygon, then fan-triangulate the visible part.
        const poly = clipNear([
          [cx[a]!, cy[a]!, cz[a]!, cw[a]!, cr[a]!, cg[a]!, cb[a]!],
          [cx[b]!, cy[b]!, cz[b]!, cw[b]!, cr[b]!, cg[b]!, cb[b]!],
          [cx[c]!, cy[c]!, cz[c]!, cw[c]!, cr[c]!, cg[c]!, cb[c]!],
        ]);
        for (let k = 1; k + 1 < poly.length; k++) {
          const v0 = poly[0]!, v1 = poly[k]!, v2 = poly[k + 1]!;
          this.fb.triangle(
            projectV(v0), [v0[4]!, v0[5]!, v0[6]!],
            projectV(v1), [v1[4]!, v1[5]!, v1[6]!],
            projectV(v2), [v2[4]!, v2[5]!, v2[6]!],
          );
        }
      }
    }

    if (toon) this.fb.outline([0.04, 0.05, 0.08]); // manga: dark silhouette/edge lines
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

function shade(worldPos: Vec3, n: Vec3, mat: Material, lights: ResolvedLight[], toon = false): Vec3 {
  let r = mat.emissive[0], g = mat.emissive[1], b = mat.emissive[2];
  for (const light of lights) {
    if (light.type === "ambient") {
      r += mat.color[0] * light.color[0] * light.intensity;
      g += mat.color[1] * light.color[1] * light.intensity;
      b += mat.color[2] * light.color[2] * light.intensity;
      continue;
    }
    if (light.type === "hemisphere") {
      // Blend ground→sky tint by how upward-facing the surface is.
      const f = n[1] * 0.5 + 0.5;
      const sky = light.skyColor ?? [1, 1, 1];
      const ground = light.groundColor ?? [0.3, 0.3, 0.3];
      r += mat.color[0] * (ground[0] + (sky[0] - ground[0]) * f) * light.intensity;
      g += mat.color[1] * (ground[1] + (sky[1] - ground[1]) * f) * light.intensity;
      b += mat.color[2] * (ground[2] + (sky[2] - ground[2]) * f) * light.intensity;
      continue;
    }
    const L =
      light.type === "directional"
        ? v3.scale(light.direction, -1)
        : v3.normalize(v3.sub(light.position, worldPos));
    let lambert = Math.max(v3.dot(n, L), 0);
    if (toon) lambert = bandLambert(lambert); // hard cel bands instead of a smooth ramp
    const f = lambert * light.intensity;
    if (f <= 0) continue;
    r += mat.color[0] * light.color[0] * f;
    g += mat.color[1] * light.color[1] * f;
    b += mat.color[2] * light.color[2] * f;
  }
  return [r, g, b];
}

export { Framebuffer } from "./raster.js";
