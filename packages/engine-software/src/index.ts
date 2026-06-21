import {
  mat4, v3, tessellate,
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
  setMesh(nodeId: string, data: MeshData): void {
    this.meshes.set(nodeId, data);
  }

  renderFrame(state: FrameState): void {
    this.fb.clear(state.background);
    const viewProj = mat4.multiply(state.camera.projMatrix, state.camera.viewMatrix);
    const { width, height } = this;

    for (const node of state.nodes) {
      if (!node.mesh) continue;
      const md = this.meshes.get(node.id);
      if (!md || md.indices.length === 0) continue;
      const material = node.material ?? DEFAULT_MATERIAL;
      const vcount = md.positions.length / 3;

      const sx = new Float64Array(vcount);
      const sy = new Float64Array(vcount);
      const sz = new Float64Array(vcount);
      const valid = new Uint8Array(vcount);
      const cr = new Float64Array(vcount);
      const cg = new Float64Array(vcount);
      const cb = new Float64Array(vcount);

      for (let i = 0; i < vcount; i++) {
        const pos: Vec3 = [md.positions[i * 3]!, md.positions[i * 3 + 1]!, md.positions[i * 3 + 2]!];
        const nrm: Vec3 = [md.normals[i * 3]!, md.normals[i * 3 + 1]!, md.normals[i * 3 + 2]!];
        const wp4 = mat4.transformPoint(node.worldMatrix, pos);
        const wp: Vec3 = [wp4[0], wp4[1], wp4[2]];
        const wn = v3.normalize(mat4.transformDir(node.worldMatrix, nrm));
        const col = shade(wp, wn, material, state.lights);
        cr[i] = col[0]; cg[i] = col[1]; cb[i] = col[2];

        const clip = mat4.transformPoint(viewProj, wp);
        const w = clip[3];
        if (w <= 1e-6) { valid[i] = 0; continue; } // simple near cull (no clipping)
        valid[i] = 1;
        sx[i] = ((clip[0] / w) * 0.5 + 0.5) * width;
        sy[i] = (0.5 - (clip[1] / w) * 0.5) * height;
        sz[i] = clip[2] / w;
      }

      const idx = md.indices;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
        if (!valid[a] || !valid[b] || !valid[c]) continue;
        this.fb.triangle(
          [sx[a]!, sy[a]!, sz[a]!], [cr[a]!, cg[a]!, cb[a]!],
          [sx[b]!, sy[b]!, sz[b]!], [cr[b]!, cg[b]!, cb[b]!],
          [sx[c]!, sy[c]!, sz[c]!], [cr[c]!, cg[c]!, cb[c]!],
        );
      }
    }
  }

  readPixels(): Uint8ClampedArray {
    return this.fb.color;
  }

  dispose(): void {
    this.meshes.clear();
  }
}

function shade(worldPos: Vec3, n: Vec3, mat: Material, lights: ResolvedLight[]): Vec3 {
  let r = mat.emissive[0], g = mat.emissive[1], b = mat.emissive[2];
  for (const light of lights) {
    if (light.type === "ambient") {
      r += mat.color[0] * light.color[0] * light.intensity;
      g += mat.color[1] * light.color[1] * light.intensity;
      b += mat.color[2] * light.color[2] * light.intensity;
      continue;
    }
    const L =
      light.type === "directional"
        ? v3.scale(light.direction, -1)
        : v3.normalize(v3.sub(light.position, worldPos));
    const ndotl = Math.max(v3.dot(n, L), 0) * light.intensity;
    if (ndotl <= 0) continue;
    r += mat.color[0] * light.color[0] * ndotl;
    g += mat.color[1] * light.color[1] * ndotl;
    b += mat.color[2] * light.color[2] * ndotl;
  }
  return [r, g, b];
}

export { Framebuffer } from "./raster.js";
