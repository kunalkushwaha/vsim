import {
  parseDocument,
  type SceneDocument, type SceneDocumentInput,
  type GeometryInput, type Vec3,
} from "@vsim/core";

type Keyframes = { frame: number; value: number | number[]; easing?: any }[];

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
  fov?: number;
  near?: number;
  far?: number;
  lookAt?: Vec3;
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

  light(props: LightInput, id?: string): this {
    const nid = id ?? `__light${this.lightCount++}`;
    this.node(nid, props, {
      light: { type: props.type, color: props.color, intensity: props.intensity, direction: props.direction },
    });
    return this;
  }

  camera(c: CameraInput, id = "__camera"): this {
    this.node(id, c, {});
    this.doc.camera = { nodeId: id, fov: c.fov, near: c.near, far: c.far, lookAt: c.lookAt };
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
