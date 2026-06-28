import type { Mat4, Quat, Vec3 } from "./math.js";
import type { Material, Light, Mesh, SceneDocument, TextOverlay } from "./document.js";
import type { MeshData } from "./geometry.js";

/** A text overlay with its animated properties resolved for the current frame. */
export type ResolvedTextOverlay = TextOverlay;

/**
 * A renderer-agnostic frame snapshot produced by the runtime. World matrices are already
 * resolved (animation + physics + hierarchy applied), so an Engine only has to draw.
 */
export interface ResolvedNode {
  id: string;
  worldMatrix: Mat4;
  mesh?: Mesh;
  light?: Light;
  /** Resolved material for this node's mesh (after material animation), if any. */
  material?: Material;
  /**
   * Skinning matrices for a skinned mesh (one per joint, `jointWorld · inverseBind`). When set,
   * an engine deforms the mesh's bind-pose vertices by these instead of using `worldMatrix`.
   */
  skin?: { jointMatrices: Mat4[] };
  /** Morph-target weights for this frame, aligned to the mesh's `morphTargets` order. The engine
   *  displaces each vertex by Σ weightᵢ·deltaᵢ before skinning. */
  morphWeights?: number[];
}

export interface ResolvedLight {
  type: Light["type"];
  color: Vec3;
  intensity: number;
  /** World position (point) or normalized direction (directional). */
  position: Vec3;
  direction: Vec3;
  /** Hemisphere light only. */
  skyColor?: Vec3;
  groundColor?: Vec3;
}

export interface ResolvedCamera {
  viewMatrix: Mat4;
  projMatrix: Mat4;
  position: Vec3;
}

export interface FrameState {
  frame: number;
  time: number;
  width: number;
  height: number;
  background: Vec3;
  /** Resolved gradient sky (top→horizon). When set, engines fill the background with it. */
  sky?: { top: Vec3; bottom: Vec3 };
  /** Render style — "manga" = banded cel-shading + outlines. */
  style: "realistic" | "manga";
  nodes: ResolvedNode[];
  lights: ResolvedLight[];
  camera: ResolvedCamera;
  /** Screen-space text overlays for this frame (animation already applied). */
  overlays: ResolvedTextOverlay[];
}

/**
 * A renderer. The SAME engine instance drives both live preview (read into a canvas) and
 * offline render (readPixels → encoder). Two output modes, one renderer.
 */
export interface Engine {
  readonly width: number;
  readonly height: number;
  init(doc: SceneDocument): Promise<void> | void;
  renderFrame(state: FrameState): void;
  /** RGBA8, length width*height*4, row 0 = top of image. */
  readPixels(): Uint8ClampedArray;
  /** Inject loaded mesh data for a node (e.g. a glTF model) before rendering. */
  loadMesh?(nodeId: string, data: MeshData): void;
  dispose(): void;
}

/**
 * Deterministic physics backend (implemented by @vsim/physics-rapier). Stepped at a fixed
 * sub-timestep by the runtime so results are reproducible across runs.
 */
export interface PhysicsAdapter {
  init(doc: SceneDocument): Promise<void> | void;
  step(dt: number): void;
  /** World transforms for body-controlled nodes, keyed by nodeId. */
  getTransforms(): Map<string, { position: Vec3; quaternion: Quat }>;
  reset(): Promise<void> | void;
  dispose(): void;
}
