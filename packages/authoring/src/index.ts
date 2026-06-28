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
  /** All skinned meshes sharing the skeleton (body + garments). Defaults to `[mesh]` if absent. */
  meshes?: MeshData[];
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
  /** "realistic" (default) or "manga" (cel-shading + outlines). */
  style?: "realistic" | "manga";
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
  type: "ambient" | "directional" | "point" | "hemisphere";
  color?: Vec3;
  intensity?: number;
  direction?: Vec3;
  /** Hemisphere light: sky/ground tints. */
  skyColor?: Vec3;
  groundColor?: Vec3;
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

interface TextInput {
  /** Normalized screen position [0..1], origin top-left (default center 0.5, 0.5). */
  x?: number;
  y?: number;
  /** Font size in output pixels. */
  size?: number;
  color?: Vec3;
  opacity?: number;
  align?: "left" | "center" | "right";
  /** Optional background box (lower-thirds / captions). */
  box?: { color?: Vec3; opacity?: number; padding?: number };
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
  private propMats = new Set<string>();
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
        style: meta.style ?? "realistic",
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

  /** Add a shared prop material once (idempotent by id), so prop builders don't duplicate it. */
  private ensureMaterial(id: string, color: Vec3): void {
    if (this.propMats.has(id) || this.doc.materials!.some((m) => m.id === id)) return;
    this.doc.materials!.push({ id, color } as any);
    this.propMats.add(id);
  }

  /**
   * A simple low-poly tree prop: a cylinder trunk + a cone of foliage, parented to a group `id` you
   * can position/scale. `position` is the tree's base on the ground. Deterministic — vary `height`
   * per call for a believable stand of trees. Adds shared "prop_bark"/"prop_leaves" materials.
   */
  tree(id: string, opts: TransformInput & { height?: number; trunkColor?: Vec3; leafColor?: Vec3 } = {}): this {
    const h = opts.height ?? 2.4;
    const trunkH = h * 0.42, leafH = h * 0.74, trunkR = h * 0.05, leafR = h * 0.28;
    this.ensureMaterial("prop_bark", opts.trunkColor ?? [0.40, 0.26, 0.13]);
    this.ensureMaterial("prop_leaves", opts.leafColor ?? [0.16, 0.42, 0.17]);
    this.group(id, opts);
    this.node(`${id}__trunk`, { parent: id, position: [0, trunkH / 2, 0] },
      { mesh: { geometry: { kind: "cylinder", radius: trunkR, height: trunkH, segments: 10 }, materialId: "prop_bark" } });
    this.node(`${id}__leaves`, { parent: id, position: [0, trunkH + leafH / 2 - h * 0.05, 0] },
      { mesh: { geometry: { kind: "cone", radius: leafR, height: leafH, segments: 12 }, materialId: "prop_leaves" } });
    return this;
  }

  /** A faceted boulder prop: a squashed low-poly sphere. `position` is its base on the ground. */
  rock(id: string, opts: TransformInput & { radius?: number; color?: Vec3 } = {}): this {
    const r = opts.radius ?? 0.5;
    const sy = opts.scale?.[1] ?? 0.65;
    const [px, py, pz] = opts.position ?? [0, 0, 0];
    this.ensureMaterial("prop_stone", opts.color ?? [0.5, 0.5, 0.52]);
    this.node(id, { ...opts, position: [px, py + r * sy, pz], scale: [opts.scale?.[0] ?? 1, sy, opts.scale?.[2] ?? 1] },
      { mesh: { geometry: { kind: "sphere", radius: r, segments: 6 }, materialId: "prop_stone" } });
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
    const clip = clipName ? { clipId: `${id}/${clipName}`, loop: opts.loop, speed: opts.speed, startFrame: opts.startFrame } : undefined;
    // One mesh node per skinned mesh (body + garments), all bound to the same skin. The clip poses
    // shared joints, so it rides on the first mesh node only. Each mesh keeps its own texture.
    const meshes = rig.meshes ?? [rig.mesh];
    meshes.forEach((meshData, k) => {
      this.doc.nodes!.push({
        id: k === 0 ? `${id}__mesh` : `${id}__mesh${k}`,
        // Inline the skinned mesh so the scene document stays self-contained (CLI-renderable).
        mesh: { geometry: { kind: "mesh", data: meshData }, materialId: opts.material, skinId: `${id}__skin` },
        clip: k === 0 ? clip : undefined,
      } as any);
    });
    return this;
  }

  light(props: LightInput, id?: string): this {
    const nid = id ?? `__light${this.lightCount++}`;
    this.node(nid, props, {
      light: {
        type: props.type,
        color: props.color,
        intensity: props.intensity,
        direction: props.direction,
        skyColor: props.skyColor,
        groundColor: props.groundColor,
      },
    });
    return this;
  }

  /** Set a gradient sky background (top color → horizon color). */
  sky(top: Vec3, bottom: Vec3): this {
    this.doc.environment = { ...(this.doc.environment ?? {}), sky: { type: "gradient", top, bottom } };
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

  /**
   * Add a screen-space text overlay (title / caption / lower-third), drawn on top of the render.
   * Position is normalized [0..1] (origin top-left); `align` anchors horizontally, `y` is the line's
   * vertical center. Animate it with `animateOverlay(id, "opacity"|"x"|"y"|"size"|"color", …)`.
   */
  text(id: string, text: string, opts: TextInput = {}): this {
    this.doc.overlays = this.doc.overlays ?? [];
    this.doc.overlays.push({ id, text, ...opts });
    return this;
  }

  /** Animate a text overlay property: "opacity" | "x" | "y" | "size" (numbers) or "color" (vec3). */
  animateOverlay(overlayId: string, path: string, keyframes: Keyframes): this {
    this.doc.animation!.push({ target: { overlayId, path }, keyframes });
    return this;
  }

  /**
   * Title-card preset: centered text that fades in over `fade` frames at `startFrame`, holds, then
   * fades out by `endFrame` (defaults to the scene end). Any `TextInput` overrides the look.
   */
  title(
    id: string,
    text: string,
    opts: TextInput & { startFrame?: number; endFrame?: number; fade?: number } = {},
  ): this {
    const { startFrame = 0, endFrame, fade = 8, ...look } = opts;
    const end = endFrame ?? this.doc.meta.durationFrames;
    this.text(id, text, { y: 0.5, size: 96, align: "center", ...look });
    this.animateOverlay(id, "opacity", [
      { frame: startFrame, value: 0 },
      { frame: Math.min(startFrame + fade, end), value: 1, easing: "easeOut" },
      { frame: Math.max(end - fade, startFrame + fade), value: 1 },
      { frame: end, value: 0, easing: "easeIn" },
    ]);
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
