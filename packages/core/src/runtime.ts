import { Clock } from "./clock.js";
import { Rng } from "./rng.js";
import { evaluateTrack } from "./animation.js";
import { mat4, quatFromEuler, v3, DEG2RAD } from "./math.js";
import type { Mat4, Quat, Vec3 } from "./math.js";
import type { Material, Node, SceneDocument } from "./document.js";
import type {
  FrameState,
  PhysicsAdapter,
  ResolvedCamera,
  ResolvedLight,
  ResolvedNode,
} from "./engine.js";

interface LocalTransform {
  position: Vec3;
  rotation: Vec3; // euler radians
  scale: Vec3;
  quat?: Quat; // set directly by physics, overrides euler
}

const AXIS: Record<string, number> = { x: 0, y: 1, z: 2 };

function applyToTransform(lt: LocalTransform, path: string, value: number | number[]): void {
  const [prop, comp] = path.split(".");
  const target =
    prop === "position" ? lt.position : prop === "rotation" ? lt.rotation : prop === "scale" ? lt.scale : null;
  if (!target) return;
  if (comp === undefined) {
    if (Array.isArray(value)) {
      target[0] = value[0] ?? target[0];
      target[1] = value[1] ?? target[1];
      target[2] = value[2] ?? target[2];
    }
  } else if (comp in AXIS && typeof value === "number") {
    target[AXIS[comp]!] = value;
  }
}

function applyToMaterial(mat: Material, path: string, value: number | number[]): void {
  if ((path === "color" || path === "emissive") && Array.isArray(value)) {
    mat[path] = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
  } else if ((path === "opacity" || path === "roughness" || path === "metalness") && typeof value === "number") {
    mat[path] = value;
  }
}

/**
 * The runtime: advances the deterministic clock, steps physics, evaluates animation, and
 * resolves a full FrameState (world matrices, lights, camera) for an Engine to draw.
 * Forward-only stepping; call `reset()` to replay from the start.
 */
export class SceneRuntime {
  readonly doc: SceneDocument;
  readonly clock: Clock;
  readonly rng: Rng;
  private physics?: PhysicsAdapter;
  private nodeMap = new Map<string, Node>();

  constructor(doc: SceneDocument, opts: { physics?: PhysicsAdapter } = {}) {
    this.doc = doc;
    this.physics = opts.physics;
    this.clock = new Clock({ fps: doc.meta.fps, substeps: doc.meta.substeps });
    this.rng = new Rng(doc.meta.seed);
    for (const n of doc.nodes) this.nodeMap.set(n.id, n);
  }

  async init(): Promise<void> {
    if (this.physics) await this.physics.init(this.doc);
  }

  async reset(): Promise<void> {
    this.clock.reset();
    if (this.physics) await this.physics.reset();
  }

  get durationFrames(): number {
    return this.doc.meta.durationFrames;
  }

  /** Advance simulation to `frame` and resolve a FrameState. */
  computeFrameState(frame: number): FrameState {
    this.clock.advanceTo(frame, (subDt) => this.physics?.step(subDt));

    const locals = new Map<string, LocalTransform>();
    for (const n of this.doc.nodes) {
      locals.set(n.id, {
        position: [...n.position] as Vec3,
        rotation: [...n.rotation] as Vec3,
        scale: [...n.scale] as Vec3,
      });
    }

    const materials = new Map<string, Material>();
    for (const m of this.doc.materials) {
      materials.set(m.id, { ...m, color: [...m.color] as Vec3, emissive: [...m.emissive] as Vec3 });
    }

    for (const track of this.doc.animation) {
      const value = evaluateTrack(track, frame);
      if (track.target.nodeId) {
        const lt = locals.get(track.target.nodeId);
        if (lt) applyToTransform(lt, track.target.path, value);
      } else if (track.target.materialId) {
        const mt = materials.get(track.target.materialId);
        if (mt) applyToMaterial(mt, track.target.path, value);
      }
    }

    if (this.physics) {
      for (const [nodeId, tr] of this.physics.getTransforms()) {
        const lt = locals.get(nodeId);
        if (lt) {
          lt.position = tr.position;
          lt.quat = tr.quaternion;
        }
      }
    }

    const worldMatrices = new Map<string, Mat4>();
    const computeWorld = (id: string): Mat4 => {
      const cached = worldMatrices.get(id);
      if (cached) return cached;
      const node = this.nodeMap.get(id)!;
      const lt = locals.get(id)!;
      const quat = lt.quat ?? quatFromEuler(lt.rotation[0], lt.rotation[1], lt.rotation[2]);
      const localMat = mat4.compose(lt.position, quat, lt.scale);
      const world = node.parent ? mat4.multiply(computeWorld(node.parent), localMat) : localMat;
      worldMatrices.set(id, world);
      return world;
    };

    const nodes: ResolvedNode[] = [];
    const lights: ResolvedLight[] = [];
    for (const n of this.doc.nodes) {
      const world = computeWorld(n.id);
      const material = n.mesh?.materialId ? materials.get(n.mesh.materialId) : undefined;
      nodes.push({ id: n.id, worldMatrix: world, mesh: n.mesh, light: n.light, material });
      if (n.light) {
        lights.push({
          type: n.light.type,
          color: n.light.color,
          intensity: n.light.intensity,
          position: mat4.getTranslation(world),
          direction: v3.normalize(mat4.transformDir(world, [0, 0, -1])),
        });
      }
    }

    return {
      frame,
      time: frame / this.doc.meta.fps,
      width: this.doc.meta.width,
      height: this.doc.meta.height,
      background: this.doc.meta.background,
      nodes,
      lights,
      camera: this.resolveCamera(computeWorld),
    };
  }

  private resolveCamera(computeWorld: (id: string) => Mat4): ResolvedCamera {
    const cam = this.doc.camera;
    const world = computeWorld(cam.nodeId);
    const position = mat4.getTranslation(world);
    let viewMatrix: Mat4;
    if (cam.lookAt) {
      viewMatrix = mat4.lookAt(position, cam.lookAt, [0, 1, 0]);
    } else {
      const target = v3.add(position, v3.normalize(mat4.transformDir(world, [0, 0, -1])));
      const up = v3.normalize(mat4.transformDir(world, [0, 1, 0]));
      viewMatrix = mat4.lookAt(position, target, up);
    }
    const aspect = this.doc.meta.width / this.doc.meta.height;
    return {
      viewMatrix,
      projMatrix: mat4.perspective(cam.fov * DEG2RAD, aspect, cam.near, cam.far),
      position,
    };
  }
}
