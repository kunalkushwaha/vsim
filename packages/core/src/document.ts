import { z } from "zod";

/**
 * The canonical scene document. This is the single source of truth: timeline, code, and
 * AI authoring all read/write THIS shape. Time is always in frames. Defaults keep
 * hand/code authoring terse; `parseDocument` fills them in.
 */

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const color = z.tuple([z.number(), z.number(), z.number()]); // linear RGB 0..1

export const MetaSchema = z.object({
  fps: z.number().int().positive().default(30),
  durationFrames: z.number().int().positive(),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  seed: z.number().int().default(0),
  substeps: z.number().int().positive().default(4),
  background: color.default([0.05, 0.06, 0.09]),
  /** Render style: "realistic" (smooth Lambert) or "manga" (banded cel-shading + outlines). */
  style: z.enum(["realistic", "manga"]).default("realistic"),
});

export const AssetSchema = z.object({
  id: z.string(),
  type: z.enum(["gltf", "audio", "texture"]),
  uri: z.string(),
});

export const MaterialSchema = z.object({
  id: z.string(),
  color: color.default([0.8, 0.8, 0.8]),
  emissive: color.default([0, 0, 0]),
  opacity: z.number().min(0).max(1).default(1),
  roughness: z.number().min(0).max(1).default(0.8),
  metalness: z.number().min(0).max(1).default(0),
});

export const GeometrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("box"), size: vec3.default([1, 1, 1]) }),
  z.object({ kind: z.literal("sphere"), radius: z.number().default(0.5), segments: z.number().int().min(3).default(16) }),
  z.object({ kind: z.literal("plane"), size: z.tuple([z.number(), z.number()]).default([10, 10]) }),
  z.object({ kind: z.literal("cylinder"), radius: z.number().default(0.5), height: z.number().default(1), segments: z.number().int().min(3).default(16) }),
  z.object({ kind: z.literal("cone"), radius: z.number().default(0.5), height: z.number().default(1), segments: z.number().int().min(3).default(16) }),
  z.object({ kind: z.literal("gltf"), assetId: z.string() }),
  // Inline mesh data carried in the document (e.g. a procedurally-built rig) — keeps the scene
  // self-contained. Includes optional skinning attributes.
  z.object({
    kind: z.literal("mesh"),
    data: z.object({
      positions: z.array(z.number()),
      normals: z.array(z.number()),
      indices: z.array(z.number()),
      joints: z.array(z.number()).optional(),
      weights: z.array(z.number()).optional(),
      uvs: z.array(z.number()).optional(),
      // In-memory RGBA textures (not JSON-serializable; reference a glTF asset for that path).
      texture: z.object({ width: z.number(), height: z.number(), data: z.instanceof(Uint8Array) }).optional(),
      normalMap: z.object({ width: z.number(), height: z.number(), data: z.instanceof(Uint8Array) }).optional(),
      metallicRoughnessMap: z.object({ width: z.number(), height: z.number(), data: z.instanceof(Uint8Array) }).optional(),
      occlusionMap: z.object({ width: z.number(), height: z.number(), data: z.instanceof(Uint8Array) }).optional(),
      emissiveMap: z.object({ width: z.number(), height: z.number(), data: z.instanceof(Uint8Array) }).optional(),
      // Morph targets (blend shapes): per-target position deltas added to `positions`, weighted.
      morphTargets: z.array(z.object({ name: z.string().optional(), deltas: z.array(z.number()) })).optional(),
    }),
  }),
]);

export const MeshSchema = z.object({
  geometry: GeometrySchema,
  materialId: z.string().optional(),
  /** Binds this mesh to a skeleton (`skins[].id`) for skeletal animation. */
  skinId: z.string().optional(),
  /** Initial morph-target weights keyed by target name; animate via the "morph.<name>" track path. */
  morphWeights: z.record(z.number()).optional(),
});

const mat4Schema = z.array(z.number()).length(16); // column-major 4x4

/** A skeleton: an ordered list of joint nodes + their inverse bind matrices. */
export const SkinSchema = z.object({
  id: z.string(),
  joints: z.array(z.string()), // node ids, in skin order
  inverseBindMatrices: z.array(mat4Schema),
});

/** One animated joint property over time (glTF animation channel). Times are FRAME indices. */
export const ClipChannelSchema = z.object({
  jointNodeId: z.string(),
  path: z.enum(["translation", "rotation", "scale"]),
  times: z.array(z.number()), // frame indices (converted from glTF seconds at load)
  values: z.array(z.number()), // flat: vec3 per key (T/S) or quat per key (R)
  interpolation: z.enum(["linear", "step", "cubicspline"]).default("linear"),
});

/** A named animation clip — a bundle of joint channels that play together. */
export const ClipSchema = z.object({
  id: z.string(),
  durationFrames: z.number(),
  channels: z.array(ClipChannelSchema),
});

/** Plays a clip on a node's skeleton, positioned on the scene timeline. */
export const ClipPlaybackSchema = z.object({
  clipId: z.string(),
  startFrame: z.number().default(0),
  speed: z.number().default(1),
  loop: z.boolean().default(false),
});

export const LightSchema = z.object({
  type: z.enum(["ambient", "directional", "point", "hemisphere"]),
  color: color.default([1, 1, 1]),
  intensity: z.number().default(1),
  /** World-space direction a directional light travels (e.g. [0,-1,0] = straight down). */
  direction: vec3.optional(),
  /** Hemisphere light only: sky tint (lights upward-facing surfaces). */
  skyColor: color.optional(),
  /** Hemisphere light only: ground tint (lights downward-facing surfaces). */
  groundColor: color.optional(),
});

/** Scene environment: sky background and (later) fog. */
export const EnvironmentSchema = z.object({
  sky: z
    .object({
      type: z.enum(["flat", "gradient"]).default("gradient"),
      /** Gradient: color at the top of the frame. */
      top: color.default([0.35, 0.55, 0.92]),
      /** Gradient: color at the horizon. */
      bottom: color.default([0.72, 0.83, 0.96]),
    })
    .optional(),
});

export const NodeSchema = z.object({
  id: z.string(),
  parent: z.string().optional(),
  position: vec3.default([0, 0, 0]),
  rotation: vec3.default([0, 0, 0]), // euler radians, XYZ
  /** Optional bind rotation as a quaternion [x,y,z,w]; overrides `rotation` (used by skeleton joints). */
  quaternion: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  scale: vec3.default([1, 1, 1]),
  mesh: MeshSchema.optional(),
  light: LightSchema.optional(),
  /** Plays an animation clip driving this node's skeleton (for skinned characters). */
  clip: ClipPlaybackSchema.optional(),
});

const EasingSchema = z.union([
  z.enum(["linear", "easeIn", "easeOut", "easeInOut", "step"]),
  z.tuple([z.number(), z.number(), z.number(), z.number()]), // cubic bezier control points
]);

export const KeyframeSchema = z.object({
  frame: z.number(),
  value: z.union([z.number(), z.array(z.number())]),
  easing: EasingSchema.default("linear"),
});

export const TrackSchema = z.object({
  target: z.object({
    nodeId: z.string().optional(),
    materialId: z.string().optional(),
    /** A camera (by id) — animate its "fov" (number) or "lookAt" (vec3). */
    cameraId: z.string().optional(),
    /** Dot path, e.g. "position", "position.y", "rotation", "color", "fov", "lookAt". */
    path: z.string(),
  }),
  keyframes: z.array(KeyframeSchema).min(1),
});

export const ColliderSchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("box"), halfExtents: vec3.default([0.5, 0.5, 0.5]) }),
  z.object({ shape: z.literal("sphere"), radius: z.number().default(0.5) }),
  z.object({ shape: z.literal("plane") }),
]);

export const BodySchema = z.object({
  nodeId: z.string(),
  type: z.enum(["dynamic", "fixed", "kinematic"]).default("dynamic"),
  collider: ColliderSchema,
  mass: z.number().positive().optional(),
  restitution: z.number().min(0).default(0.2),
  friction: z.number().min(0).default(0.5),
  linvel: vec3.optional(),
  angvel: vec3.optional(),
});

export const PhysicsSchema = z.object({
  gravity: vec3.default([0, -9.81, 0]),
  bodies: z.array(BodySchema).default([]),
});

export const AudioSchema = z.object({
  assetId: z.string(),
  gain: z.number().default(1),
  /** Beat onsets as FRAME indices — keeps audio-reactive motion reproducible. */
  beats: z.array(z.number()).default([]),
});

export const CameraSchema = z.object({
  /** Optional name, referenced by shots and camera animation tracks. */
  id: z.string().optional(),
  nodeId: z.string(),
  fov: z.number().default(50), // degrees
  near: z.number().default(0.1),
  far: z.number().default(1000),
  /** Optional explicit look-at target (world space). Else derived from node rotation. */
  lookAt: vec3.optional(),
  /** Aim at this node's world position every frame (a tracking shot). Overrides `lookAt`. */
  lookAtNodeId: z.string().optional(),
});

/** A segment of the timeline filmed by a given camera. Frames are inclusive. */
export const ShotSchema = z.object({
  cameraId: z.string(),
  startFrame: z.number(),
  endFrame: z.number(),
});

export const SceneDocumentSchema = z.object({
  version: z.literal("0.1").default("0.1"),
  meta: MetaSchema,
  assets: z.array(AssetSchema).default([]),
  materials: z.array(MaterialSchema).default([]),
  nodes: z.array(NodeSchema).default([]),
  skins: z.array(SkinSchema).default([]),
  clips: z.array(ClipSchema).default([]),
  animation: z.array(TrackSchema).default([]),
  physics: PhysicsSchema.optional(),
  audio: AudioSchema.optional(),
  environment: EnvironmentSchema.optional(),
  camera: CameraSchema,
  /** Additional named cameras (each needs an `id`); the active one per frame is chosen by `shots`. */
  cameras: z.array(CameraSchema).default([]),
  /** Camera timeline — which camera films each frame range. Empty = always the default `camera`. */
  shots: z.array(ShotSchema).default([]),
});

export type SceneDocument = z.infer<typeof SceneDocumentSchema>;
export type SceneDocumentInput = z.input<typeof SceneDocumentSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type Mesh = z.infer<typeof MeshSchema>;
export type Material = z.infer<typeof MaterialSchema>;
export type Geometry = z.infer<typeof GeometrySchema>;
export type GeometryInput = z.input<typeof GeometrySchema>;
export type Light = z.infer<typeof LightSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
export type Skin = z.infer<typeof SkinSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type ClipChannel = z.infer<typeof ClipChannelSchema>;
export type ClipPlayback = z.infer<typeof ClipPlaybackSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Keyframe = z.infer<typeof KeyframeSchema>;
export type Body = z.infer<typeof BodySchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type Shot = z.infer<typeof ShotSchema>;
export type Asset = z.infer<typeof AssetSchema>;

/** Validate + apply defaults. Throws a readable error on invalid input. */
export function parseDocument(input: unknown): SceneDocument {
  const result = SceneDocumentSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid SceneDocument:\n${issues}`);
  }
  return result.data;
}
