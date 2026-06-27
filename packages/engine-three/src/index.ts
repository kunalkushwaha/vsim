import * as THREE from "three";
import {
  tessellate, mat4, v3, skinningMatrix,
  type Engine, type FrameState, type SceneDocument, type ResolvedLight, type Geometry, type MeshData, type Mat4,
} from "@vsim/core";

export interface ThreeEngineOptions {
  /**
   * Inject a renderer. In the browser the player passes one bound to a canvas; for headless
   * server rendering, pass one backed by a GL context (e.g. headless-gl). If omitted, a
   * WebGLRenderer is created (browser only).
   */
  renderer?: THREE.WebGLRenderer;
  canvas?: HTMLCanvasElement | OffscreenCanvas;
}

/**
 * Three.js production renderer. Primitive geometry comes from core's `tessellate`, so boxes/
 * spheres/planes are byte-for-byte the same topology the software engine uses — keeping the
 * GPU "render" close to the reference "preview". Lighting is three's PBR (higher fidelity).
 */
export class ThreeEngine implements Engine {
  readonly width: number;
  readonly height: number;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera();
  readonly renderer: THREE.WebGLRenderer;

  private meshes = new Map<string, THREE.Mesh>();
  private skinnedBind = new Map<string, MeshData>(); // bind-pose data for skinned nodes, re-skinned each frame
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private lightObjs: { ambient: THREE.AmbientLight; dirs: THREE.DirectionalLight[]; points: THREE.PointLight[] } = {
    ambient: new THREE.AmbientLight(0x000000, 0),
    dirs: [],
    points: [],
  };
  private readPixelBuf?: Uint8Array;

  constructor(width: number, height: number, opts: ThreeEngineOptions = {}) {
    this.width = width;
    this.height = height;
    this.renderer =
      opts.renderer ??
      new THREE.WebGLRenderer({ canvas: opts.canvas as HTMLCanvasElement, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(width, height, false);
    this.scene.matrixWorldAutoUpdate = false;
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
  }

  init(doc: SceneDocument): void {
    for (const m of doc.materials) {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(m.color[0], m.color[1], m.color[2]),
        emissive: new THREE.Color(m.emissive[0], m.emissive[1], m.emissive[2]),
        roughness: m.roughness,
        metalness: m.metalness,
        opacity: m.opacity,
        transparent: m.opacity < 1,
      });
      this.materials.set(m.id, mat);
    }

    for (const node of doc.nodes) {
      if (!node.mesh) continue;
      const geom = this.buildGeometry(node.mesh.geometry);
      const mat = node.mesh.materialId
        ? this.materials.get(node.mesh.materialId) ?? defaultMaterial()
        : defaultMaterial();
      const mesh = new THREE.Mesh(geom, mat);
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldAutoUpdate = false;
      this.meshes.set(node.id, mesh);
      this.scene.add(mesh);
    }

    this.scene.add(this.lightObjs.ambient);
  }

  /** Inject loaded mesh data (e.g. a glTF model) for a node. */
  loadMesh(nodeId: string, data: MeshData): void {
    const mesh = this.meshes.get(nodeId);
    if (!mesh) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(data.normals, 3));
    g.setIndex(data.indices);
    mesh.geometry.dispose();
    mesh.geometry = g;
    // Skinned mesh: keep the bind-pose data so we can re-deform the attributes each frame.
    if (data.joints && data.weights) this.skinnedBind.set(nodeId, data);
    else this.skinnedBind.delete(nodeId);
  }

  private buildGeometry(geo: Geometry): THREE.BufferGeometry {
    const data = tessellate(geo);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(data.normals, 3));
    g.setIndex(data.indices);
    return g;
  }

  renderFrame(state: FrameState): void {
    this.scene.background = new THREE.Color(state.background[0], state.background[1], state.background[2]);

    for (const node of state.nodes) {
      const mesh = this.meshes.get(node.id);
      if (!mesh) continue;
      const bind = node.skin ? this.skinnedBind.get(node.id) : undefined;
      if (bind && node.skin) {
        // CPU skin into the geometry; skinned positions are already world-space, so identity matrix.
        skinInto(mesh, bind, node.skin.jointMatrices);
        mesh.matrix.identity();
        mesh.matrixWorld.identity();
      } else {
        mesh.matrix.fromArray(node.worldMatrix);
        mesh.matrixWorld.fromArray(node.worldMatrix);
      }
      if (node.material) {
        const mat = this.materials.get(node.material.id);
        if (mat) {
          mat.color.setRGB(node.material.color[0], node.material.color[1], node.material.color[2]);
          mat.emissive.setRGB(node.material.emissive[0], node.material.emissive[1], node.material.emissive[2]);
          mat.opacity = node.material.opacity;
        }
      }
    }

    this.syncLights(state.lights);

    this.camera.projectionMatrix.fromArray(state.camera.projMatrix);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.matrixWorldInverse.fromArray(state.camera.viewMatrix);
    this.camera.matrixWorld.copy(this.camera.matrixWorldInverse).invert();

    this.renderer.render(this.scene, this.camera);
  }

  private syncLights(lights: ResolvedLight[]): void {
    let ambient = new THREE.Color(0, 0, 0);
    const dirs: ResolvedLight[] = [];
    const points: ResolvedLight[] = [];
    for (const l of lights) {
      if (l.type === "ambient") ambient.add(new THREE.Color(l.color[0] * l.intensity, l.color[1] * l.intensity, l.color[2] * l.intensity));
      else if (l.type === "directional") dirs.push(l);
      else points.push(l);
    }
    this.lightObjs.ambient.color.copy(ambient);
    this.lightObjs.ambient.intensity = 1;
    this.ensure(this.lightObjs.dirs, dirs.length, () => {
      const d = new THREE.DirectionalLight();
      d.target.matrixAutoUpdate = false;
      this.scene.add(d);
      this.scene.add(d.target);
      return d;
    });
    this.ensure(this.lightObjs.points, points.length, () => {
      const p = new THREE.PointLight();
      this.scene.add(p);
      return p;
    });
    dirs.forEach((l, i) => {
      const d = this.lightObjs.dirs[i]!;
      d.color.setRGB(l.color[0], l.color[1], l.color[2]);
      d.intensity = l.intensity;
      d.position.set(-l.direction[0], -l.direction[1], -l.direction[2]);
      d.target.position.set(0, 0, 0);
      d.updateMatrix?.();
    });
    points.forEach((l, i) => {
      const p = this.lightObjs.points[i]!;
      p.color.setRGB(l.color[0], l.color[1], l.color[2]);
      p.intensity = l.intensity;
      p.position.set(l.position[0], l.position[1], l.position[2]);
    });
  }

  private ensure<T extends THREE.Object3D>(arr: T[], n: number, make: () => T): void {
    while (arr.length < n) arr.push(make());
    for (let i = 0; i < arr.length; i++) arr[i]!.visible = i < n;
  }

  readPixels(): Uint8ClampedArray {
    const gl = this.renderer.getContext();
    const buf = (this.readPixelBuf ??= new Uint8Array(this.width * this.height * 4));
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    // GL origin is bottom-left; flip to top-left to match the Engine contract.
    const out = new Uint8ClampedArray(buf.length);
    const stride = this.width * 4;
    for (let y = 0; y < this.height; y++) {
      const src = (this.height - 1 - y) * stride;
      out.set(buf.subarray(src, src + stride), y * stride);
    }
    return out;
  }

  dispose(): void {
    this.meshes.forEach((m) => m.geometry.dispose());
    this.materials.forEach((m) => m.dispose());
    this.renderer.dispose();
  }
}

function defaultMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(0.8, 0.8, 0.8), roughness: 0.8 });
}

/** CPU linear-blend skinning: deform the bind-pose vertices by the joint matrices into the geometry. */
function skinInto(mesh: THREE.Mesh, bind: MeshData, jointMatrices: Mat4[]): void {
  const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const nrm = mesh.geometry.getAttribute("normal") as THREE.BufferAttribute;
  const vcount = bind.positions.length / 3;
  for (let i = 0; i < vcount; i++) {
    const m = skinningMatrix(jointMatrices, bind.joints!, bind.weights!, i);
    const p = mat4.transformPoint(m, [bind.positions[i * 3]!, bind.positions[i * 3 + 1]!, bind.positions[i * 3 + 2]!]);
    pos.setXYZ(i, p[0], p[1], p[2]);
    const n = v3.normalize(mat4.transformDir(m, [bind.normals[i * 3]!, bind.normals[i * 3 + 1]!, bind.normals[i * 3 + 2]!]));
    nrm.setXYZ(i, n[0], n[1], n[2]);
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
}
