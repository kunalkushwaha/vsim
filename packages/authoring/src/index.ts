import {
  parseDocument,
  type SceneDocument, type SceneDocumentInput,
  type GeometryInput, type Vec3, type Quat, type Mat4, type MeshData, type Clip,
} from "@vsim/core";

type Keyframes = { frame: number; value: number | number[]; easing?: any }[];

/**
 * A loaded character rig (structurally `RiggedGltf` from `@vsim/assets`). Pass the result of
 * `loadGltfRig()` to `SceneBuilder.character()`.
 */
export interface CharacterRig {
  mesh: MeshData;
  joints: string[];
  jointNodes: { id: string; parent?: string; translation: Vec3; rotation: Quat; scale: Vec3 }[];
  inverseBindMatrices: Mat4[];
  clips: Clip[];
}

interface CharacterInput extends TransformInput {
  /** Clip to play (by its id in the rig). Defaults to the first clip. */
  clip?: string;
  loop?: boolean;
  speed?: number;
  startFrame?: number;
  material?: string;
}

interface MetaInput {
  fps?: number;
  /** Duration in frames. */
  duration: number;
  width?: number;
  height?: number;
  seed?: number;
  substeps?: number;
  background?: Vec3;
}

interface TransformInput {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  parent?: string;
}

interface MeshInput extends TransformInput {
  geometry: GeometryInput;
  material?: string;
}

interface LightInput extends TransformInput {
  type: "ambient" | "directional" | "point";
  color?: Vec3;
  intensity?: number;
  direction?: Vec3;
}

interface CameraInput extends TransformInput {
  /** Optional id, so shots and camera-animation tracks can reference this camera. */
  id?: string;
  fov?: number;
  near?: number;
  far?: number;
  lookAt?: Vec3;
  /** Aim at this node's world position every frame (a tracking shot). */
  lookAtNodeId?: string;
}

type ColliderInput =
  | { shape: "box"; halfExtents?: Vec3 }
  | { shape: "sphere"; radius?: number }
  | { shape: "plane" };

interface BodyInput {
  type?: "dynamic" | "fixed" | "kinematic";
  collider: ColliderInput;
  mass?: number;
  restitution?: number;
  friction?: number;
  linvel?: Vec3;
  angvel?: Vec3;
}

/**
 * Fluent builder for scene documents — the ergonomic "code → scene" surface. Everything it
 * produces is just a SceneDocument, so timeline/AI tooling can read & round-trip it.
 */
export class SceneBuilder {
  private doc: SceneDocumentInput;
  private lightCount = 0;

  constructor(meta: MetaInput) {
    this.doc = {
      meta: {
        fps: meta.fps ?? 30,
        durationFrames: meta.duration,
        width: meta.width ?? 1920,
        height: meta.height ?? 1080,
        seed: meta.seed ?? 0,
        substeps: meta.substeps ?? 4,
        background: meta.background ?? [0.05, 0.06, 0.09],
      },
      assets: [],
      materials: [],
      nodes: [],
      animation: [],
      camera: { nodeId: "__camera" },
    };
  }

  material(id: string, props: { color?: Vec3; emissive?: Vec3; opacity?: number; roughness?: number; metalness?: number }): this {
    this.doc.materials!.push({ id, ...props });
    return this;
  }

  asset(id: string, type: "gltf" | "audio" | "texture", uri: string): this {
    this.doc.assets!.push({ id, type, uri });
    return this;
  }

  private node(id: string, t: TransformInput, extra: Record<string, unknown>): void {
    this.doc.nodes!.push({
      id,
      parent: t.parent,
      position: t.position,
      rotation: t.rotation,
      scale: t.scale,
      ...extra,
    } as any);
  }

  group(id: string, t: TransformInput = {}): this {
    this.node(id, t, {});
    return this;
  }

  mesh(id: string, m: MeshInput): this {
    this.node(id, m, { mesh: { geometry: m.geometry, materialId: m.material } });
    return this;
  }

  /**
   * Add a rigged character from a loaded rig (see `loadGltfRig`). Creates a group node `id` you can
   * position/animate (move it to make the character walk across the scene), the joint hierarchy, the
   * skin, the clips, and a skinned mesh node `${id}__mesh`. The mesh vertices are returned by
   * `characterMeshes()` — pass them to the renderer via `RenderOptions.meshes`.
   */
  character(id: string, rig: CharacterRig, opts: CharacterInput = {}): this {
    const jid = (j: string) => `${id}/${j}`;
    // Group node: the character handle. Animate its position to walk the whole skeleton.
    this.node(id, opts, {});

    for (const j of rig.jointNodes) {
      this.doc.nodes!.push({
        id: jid(j.id),
        parent: j.parent ? jid(j.parent) : id, // root joints hang off the group
        position: j.translation,
        quaternion: j.rotation,
        scale: j.scale,
      } as any);
    }

    this.doc.skins = this.doc.skins ?? [];
    this.doc.skins.push({ id: `${id}__skin`, joints: rig.joints.map(jid), inverseBindMatrices: rig.inverseBindMatrices });

    this.doc.clips = this.doc.clips ?? [];
    for (const c of rig.clips) {
      this.doc.clips.push({
        id: `${id}/${c.id}`,
        durationFrames: c.durationFrames,
        channels: c.channels.map((ch) => ({ ...ch, jointNodeId: jid(ch.jointNodeId) })),
      });
    }

    const clipName = opts.clip ?? rig.clips[0]?.id;
    this.doc.nodes!.push({
      id: `${id}__mesh`,
      // Inline the skinned mesh so the scene document stays self-contained (CLI-renderable).
      mesh: { geometry: { kind: "mesh", data: rig.mesh }, materialId: opts.material, skinId: `${id}__skin` },
      clip: clipName ? { clipId: `${id}/${clipName}`, loop: opts.loop, speed: opts.speed, startFrame: opts.startFrame } : undefined,
    } as any);
    return this;
  }

  light(props: LightInput, id?: string): this {
    const nid = id ?? `__light${this.lightCount++}`;
    this.node(nid, props, {
      light: { type: props.type, color: props.color, intensity: props.intensity, direction: props.direction },
    });
    return this;
  }

  camera(c: CameraInput, id = "__camera"): this {
    this.node(id, c, {});
    this.doc.camera = { id: c.id, nodeId: id, fov: c.fov, near: c.near, far: c.far, lookAt: c.lookAt, lookAtNodeId: c.lookAtNodeId };
    return this;
  }

  /** Add a named camera (for multi-shot scenes). Reference it from `shot()`. */
  addCamera(id: string, c: CameraInput): this {
    const nodeId = `__cam_${id}`;
    this.node(nodeId, c, {});
    this.doc.cameras = this.doc.cameras ?? [];
    this.doc.cameras.push({ id, nodeId, fov: c.fov, near: c.near, far: c.far, lookAt: c.lookAt, lookAtNodeId: c.lookAtNodeId });
    return this;
  }

  /** Film `[startFrame, endFrame]` (inclusive) with camera `cameraId` — a cut in the shot timeline. */
  shot(cameraId: string, startFrame: number, endFrame: number): this {
    this.doc.shots = this.doc.shots ?? [];
    this.doc.shots.push({ cameraId, startFrame, endFrame });
    return this;
  }

  /**
   * Orbit preset: a named camera that circles `target` at `radius`/`height`, looking at it, over
   * `[startFrame, endFrame]`. (Dolly/crane/track are just `addCamera` + `animate`/`lookAtNodeId`.)
   */
  orbit(
    id: string,
    opts: { target: Vec3; radius: number; height?: number; startFrame: number; endFrame: number; revolutions?: number; fov?: number; samples?: number },
  ): this {
    const nodeId = `__cam_${id}`;
    const height = opts.height ?? opts.target[1];
    const revolutions = opts.revolutions ?? 1;
    const samples = opts.samples ?? 24;
    this.node(nodeId, { position: [opts.target[0] + opts.radius, height, opts.target[2]] }, {});
    this.doc.cameras = this.doc.cameras ?? [];
    this.doc.cameras.push({ id, nodeId, fov: opts.fov, lookAt: opts.target });
    const keyframes: Keyframes = [];
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const ang = t * revolutions * 2 * Math.PI;
      keyframes.push({
        frame: Math.round(opts.startFrame + t * (opts.endFrame - opts.startFrame)),
        value: [opts.target[0] + Math.cos(ang) * opts.radius, height, opts.target[2] + Math.sin(ang) * opts.radius],
      });
    }
    this.doc.animation!.push({ target: { nodeId, path: "position" }, keyframes });
    return this;
  }

  animate(nodeId: string, path: string, keyframes: Keyframes): this {
    this.doc.animation!.push({ target: { nodeId, path }, keyframes });
    return this;
  }

  animateMaterial(materialId: string, path: string, keyframes: Keyframes): this {
    this.doc.animation!.push({ target: { materialId, path }, keyframes });
    return this;
  }

  gravity(g: Vec3): this {
    this.doc.physics = { ...(this.doc.physics ?? { bodies: [] }), gravity: g } as any;
    return this;
  }

  body(nodeId: string, b: BodyInput): this {
    this.doc.physics = this.doc.physics ?? ({ bodies: [] } as any);
    (this.doc.physics as any).bodies.push({ nodeId, ...b });
    return this;
  }

  audio(assetId: string, opts: { gain?: number; beats?: number[] } = {}): this {
    this.doc.audio = { assetId, gain: opts.gain, beats: opts.beats };
    return this;
  }

  /** Validate and produce the final SceneDocument. */
  build(): SceneDocument {
    return parseDocument(this.doc);
  }

  /** The raw (unvalidated) input — useful for serialization/round-trip tooling. */
  toJSON(): SceneDocumentInput {
    return this.doc;
  }
}

export function scene(meta: MetaInput): SceneBuilder {
  return new SceneBuilder(meta);
}

// Re-export the core math/geometry helpers authoring code commonly needs (e.g. building a
// procedural rig), so scenes can import everything from `@vsim/authoring`.
export { tessellate, mat4, v3, quatFromEuler } from "@vsim/core";
export type { Vec3, Quat, Mat4, MeshData, Clip } from "@vsim/core";

/** Beat onsets as FRAME indices for a constant tempo — the unit that keeps audio-reactive
 * motion reproducible (frame-locked, not wall-clock). */
export function beatsFromBPM(bpm: number, fps: number, durationFrames: number): number[] {
  const framesPerBeat = (60 / bpm) * fps;
  const beats: number[] = [];
  for (let f = 0; f < durationFrames; f += framesPerBeat) beats.push(Math.round(f));
  return beats;
}

/** Build scale-pulse keyframes that pop on each beat frame and decay back. Deterministic
 * because beats are frame indices, so the render matches the preview exactly. */
export function pulseKeyframes(
  beats: number[],
  opts: { base?: number; peak?: number; release?: number } = {},
): { frame: number; value: number[]; easing: string }[] {
  const base = opts.base ?? 1;
  const peak = opts.peak ?? 1.4;
  const release = opts.release ?? 8;
  const kfs: { frame: number; value: number[]; easing: string }[] = [];
  if (beats[0] !== 0) kfs.push({ frame: 0, value: [base, base, base], easing: "linear" });
  for (const fb of beats) {
    kfs.push({ frame: fb, value: [peak, peak, peak], easing: "easeOut" });
    kfs.push({ frame: fb + release, value: [base, base, base], easing: "easeOut" });
  }
  return kfs.sort((a, b) => a.frame - b.frame);
}
