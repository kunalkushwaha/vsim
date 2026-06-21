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
  z.object({ kind: z.literal("gltf"), assetId: z.string() }),
]);

export const MeshSchema = z.object({
  geometry: GeometrySchema,
  materialId: z.string().optional(),
});

export const LightSchema = z.object({
  type: z.enum(["ambient", "directional", "point"]),
  color: color.default([1, 1, 1]),
  intensity: z.number().default(1),
});

export const NodeSchema = z.object({
  id: z.string(),
  parent: z.string().optional(),
  position: vec3.default([0, 0, 0]),
  rotation: vec3.default([0, 0, 0]), // euler radians, XYZ
  scale: vec3.default([1, 1, 1]),
  mesh: MeshSchema.optional(),
  light: LightSchema.optional(),
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
    /** Dot path, e.g. "position", "position.y", "rotation", "color". */
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
  nodeId: z.string(),
  fov: z.number().default(50), // degrees
  near: z.number().default(0.1),
  far: z.number().default(1000),
  /** Optional explicit look-at target (world space). Else derived from node rotation. */
  lookAt: vec3.optional(),
});

export const SceneDocumentSchema = z.object({
  version: z.literal("0.1").default("0.1"),
  meta: MetaSchema,
  assets: z.array(AssetSchema).default([]),
  materials: z.array(MaterialSchema).default([]),
  nodes: z.array(NodeSchema).default([]),
  animation: z.array(TrackSchema).default([]),
  physics: PhysicsSchema.optional(),
  audio: AudioSchema.optional(),
  camera: CameraSchema,
});

export type SceneDocument = z.infer<typeof SceneDocumentSchema>;
export type SceneDocumentInput = z.input<typeof SceneDocumentSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type Mesh = z.infer<typeof MeshSchema>;
export type Material = z.infer<typeof MaterialSchema>;
export type Geometry = z.infer<typeof GeometrySchema>;
export type Light = z.infer<typeof LightSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Keyframe = z.infer<typeof KeyframeSchema>;
export type Body = z.infer<typeof BodySchema>;
export type Camera = z.infer<typeof CameraSchema>;
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
