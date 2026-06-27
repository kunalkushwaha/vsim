import { Clock } from "./clock.js";
import { Rng } from "./rng.js";
import { evaluateTrack } from "./animation.js";
import { evaluateClip } from "./clip.js";
import { mat4, quatFromEuler, v3, DEG2RAD } from "./math.js";
import type { Mat4, Quat, Vec3 } from "./math.js";
import type { Camera, Clip, Material, Node, SceneDocument, Skin } from "./document.js";
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

/**
 * Map a scene frame to a clip-local frame. Returns null before the clip starts; after the end it
 * holds the last frame (non-loop) or wraps (loop). Frame-based → reproducible.
 */
function clipLocalFrame(
  pb: { startFrame: number; speed: number; loop: boolean },
  frame: number,
  durationFrames: number,
): number | null {
  const local = (frame - pb.startFrame) * pb.speed;
  if (local < 0) return null;
  if (pb.loop) return durationFrames > 0 ? local % durationFrames : 0;
  return Math.min(local, durationFrames);
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
  private skinMap = new Map<string, Skin>();
  private clipMap = new Map<string, Clip>();
  private cameraById = new Map<string, Camera>();

  constructor(doc: SceneDocument, opts: { physics?: PhysicsAdapter } = {}) {
    this.doc = doc;
    this.physics = opts.physics;
    this.clock = new Clock({ fps: doc.meta.fps, substeps: doc.meta.substeps });
    this.rng = new Rng(doc.meta.seed);
    for (const n of doc.nodes) this.nodeMap.set(n.id, n);
    for (const s of doc.skins) this.skinMap.set(s.id, s);
    for (const c of doc.clips) this.clipMap.set(c.id, c);
    for (const c of doc.cameras) if (c.id) this.cameraById.set(c.id, c);
    if (doc.camera.id) this.cameraById.set(doc.camera.id, doc.camera);
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
        quat: n.quaternion ? ([...n.quaternion] as Quat) : undefined,
      });
    }

    const materials = new Map<string, Material>();
    for (const m of this.doc.materials) {
      materials.set(m.id, { ...m, color: [...m.color] as Vec3, emissive: [...m.emissive] as Vec3 });
    }

    // Morph-target weights per node (aligned to the mesh's morphTargets order), seeded from the
    // mesh's `morphWeights` defaults (keyed by name). Animation tracks with a "morph.<name|index>"
    // path override them; the engine then displaces vertices by Σ weight·delta before skinning.
    const morphByNode = new Map<string, number[]>();
    const morphNames = new Map<string, (string | undefined)[]>();
    for (const n of this.doc.nodes) {
      const g = n.mesh?.geometry;
      if (g?.kind !== "mesh" || !g.data.morphTargets) continue;
      const names = g.data.morphTargets.map((t) => t.name);
      const defaults = n.mesh!.morphWeights;
      morphByNode.set(n.id, names.map((nm) => (nm && defaults ? (defaults[nm] ?? 0) : 0)));
      morphNames.set(n.id, names);
    }

    // Skeletal clips: sample each playing clip and override its joints' local transforms.
    for (const node of this.doc.nodes) {
      if (!node.clip) continue;
      const clip = this.clipMap.get(node.clip.clipId);
      if (!clip) continue;
      const local = clipLocalFrame(node.clip, frame, clip.durationFrames);
      if (local === null) continue; // not yet started
      for (const [jointId, pose] of evaluateClip(clip, local)) {
        const lt = locals.get(jointId);
        if (!lt) continue;
        if (pose.translation) lt.position = pose.translation;
        if (pose.scale) lt.scale = pose.scale;
        if (pose.rotation) lt.quat = pose.rotation;
      }
    }

    const cameraOverrides = new Map<string, { fov?: number; lookAt?: Vec3 }>();
    for (const track of this.doc.animation) {
      const value = evaluateTrack(track, frame);
      if (track.target.nodeId && track.target.path.startsWith("morph.")) {
        const weights = morphByNode.get(track.target.nodeId);
        const names = morphNames.get(track.target.nodeId);
        if (weights && typeof value === "number") {
          const key = track.target.path.slice(6);
          let idx = names ? names.indexOf(key) : -1;
          if (idx < 0 && Number.isInteger(Number(key))) idx = Number(key);
          if (idx >= 0 && idx < weights.length) weights[idx] = value;
        }
      } else if (track.target.nodeId) {
        const lt = locals.get(track.target.nodeId);
        if (lt) applyToTransform(lt, track.target.path, value);
      } else if (track.target.materialId) {
        const mt = materials.get(track.target.materialId);
        if (mt) applyToMaterial(mt, track.target.path, value);
      } else if (track.target.cameraId) {
        const o = cameraOverrides.get(track.target.cameraId) ?? {};
        if (track.target.path === "fov" && typeof value === "number") o.fov = value;
        else if (track.target.path === "lookAt" && Array.isArray(value)) o.lookAt = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
        cameraOverrides.set(track.target.cameraId, o);
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
      let skin: { jointMatrices: Mat4[] } | undefined;
      if (n.mesh?.skinId) {
        const sk = this.skinMap.get(n.mesh.skinId);
        if (sk) {
          // glTF skinning: jointMatrix = jointWorld · inverseBind. The skinned mesh's own node
          // transform is intentionally ignored — joints carry the full transform.
          const jointMatrices = sk.joints.map((jid, i) =>
            mat4.multiply(computeWorld(jid), sk.inverseBindMatrices[i]!),
          );
          skin = { jointMatrices };
        }
      }
      nodes.push({ id: n.id, worldMatrix: world, mesh: n.mesh, light: n.light, material, skin, morphWeights: morphByNode.get(n.id) });
      if (n.light) {
        lights.push({
          type: n.light.type,
          color: n.light.color,
          intensity: n.light.intensity,
          position: mat4.getTranslation(world),
          direction: n.light.direction
            ? v3.normalize(n.light.direction)
            : v3.normalize(mat4.transformDir(world, [0, 0, -1])),
          skyColor: n.light.skyColor,
          groundColor: n.light.groundColor,
        });
      }
    }

    return {
      frame,
      time: frame / this.doc.meta.fps,
      width: this.doc.meta.width,
      height: this.doc.meta.height,
      background: this.doc.meta.background,
      sky:
        this.doc.environment?.sky?.type === "gradient"
          ? { top: this.doc.environment.sky.top, bottom: this.doc.environment.sky.bottom }
          : undefined,
      style: this.doc.meta.style,
      nodes,
      lights,
      camera: this.resolveCamera(frame, computeWorld, cameraOverrides),
    };
  }

  /** The camera filming `frame` — the first matching shot's camera, else the default `camera`. */
  private pickCamera(frame: number): Camera {
    for (const shot of this.doc.shots) {
      if (frame >= shot.startFrame && frame <= shot.endFrame) {
        const c = this.cameraById.get(shot.cameraId);
        if (c) return c;
      }
    }
    return this.doc.camera;
  }

  private resolveCamera(
    frame: number,
    computeWorld: (id: string) => Mat4,
    overrides: Map<string, { fov?: number; lookAt?: Vec3 }>,
  ): ResolvedCamera {
    const cam = this.pickCamera(frame);
    const ov = (cam.id ? overrides.get(cam.id) : undefined) ?? {};
    const world = computeWorld(cam.nodeId);
    const position = mat4.getTranslation(world);

    // Look-at target precedence: animated override → tracked node → static lookAt → node forward.
    const target =
      ov.lookAt ?? (cam.lookAtNodeId ? mat4.getTranslation(computeWorld(cam.lookAtNodeId)) : cam.lookAt);
    let viewMatrix: Mat4;
    if (target) {
      viewMatrix = mat4.lookAt(position, target, [0, 1, 0]);
    } else {
      const fwd = v3.add(position, v3.normalize(mat4.transformDir(world, [0, 0, -1])));
      const up = v3.normalize(mat4.transformDir(world, [0, 1, 0]));
      viewMatrix = mat4.lookAt(position, fwd, up);
    }
    const aspect = this.doc.meta.width / this.doc.meta.height;
    return {
      viewMatrix,
      projMatrix: mat4.perspective((ov.fov ?? cam.fov) * DEG2RAD, aspect, cam.near, cam.far),
      position,
    };
  }
}
