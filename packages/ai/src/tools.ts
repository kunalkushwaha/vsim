import type Anthropic from "@anthropic-ai/sdk";
import type { EditOperation } from "./operations.js";

/**
 * Claude tool definitions mirroring the EditOperation vocabulary. The model edits the
 * scene by calling these — so its output is structurally constrained to valid mutations.
 * `toolUseToOperation` maps a tool_use block back to an EditOperation for applying.
 */

const vec3 = { type: "array", items: { type: "number" }, description: "[x, y, z]" } as const;
const color = { type: "array", items: { type: "number" }, description: "linear RGB, each component 0..1, e.g. [0.9, 0.3, 0.3]" } as const;

const geometry = {
  type: "object",
  description: "Geometry. Set fields relevant to `kind`: box→size[x,y,z], sphere→radius(+segments), plane→size[w,h], gltf→assetId.",
  properties: {
    kind: { type: "string", enum: ["box", "sphere", "plane", "gltf"] },
    size: { type: "array", items: { type: "number" } },
    radius: { type: "number" },
    segments: { type: "integer" },
    assetId: { type: "string" },
  },
  required: ["kind"],
  additionalProperties: false,
} as const;

const keyframes = {
  type: "array",
  description: "Keyframes. `frame` is an integer frame index (time is measured in frames, never seconds).",
  items: {
    type: "object",
    properties: {
      frame: { type: "integer" },
      value: { anyOf: [{ type: "number" }, { type: "array", items: { type: "number" } }] },
      easing: { type: "string", enum: ["linear", "easeIn", "easeOut", "easeInOut", "step"] },
    },
    required: ["frame", "value"],
    additionalProperties: false,
  },
} as const;

export const EDIT_TOOLS: Anthropic.Tool[] = [
  {
    name: "set_meta",
    description: "Update render-level settings: frame rate, duration (in frames), resolution, or background color. Call this when the user changes timing, size, or background.",
    input_schema: {
      type: "object",
      properties: {
        fps: { type: "integer" },
        durationFrames: { type: "integer", description: "Total length in frames." },
        width: { type: "integer" },
        height: { type: "integer" },
        background: color,
      },
    },
  },
  {
    name: "set_material",
    description: "Create a material (if `id` is new) or update an existing one. Materials are referenced by meshes via their id. Call this before add_mesh when a mesh needs a new material.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        color,
        emissive: color,
        opacity: { type: "number" },
        roughness: { type: "number" },
        metalness: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "add_mesh",
    description: "Add a mesh node (or replace an existing node's geometry). `material` is a material id. Call this to introduce a new object into the scene.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        geometry,
        material: { type: "string", description: "id of a material (create it first with set_material)" },
        position: vec3,
        rotation: { type: "array", items: { type: "number" }, description: "Euler radians [x, y, z]" },
        scale: vec3,
      },
      required: ["id", "geometry"],
    },
  },
  {
    name: "update_node",
    description: "Move, rotate, or scale an existing node by id. Use this to reposition something already in the scene.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        position: vec3,
        rotation: { type: "array", items: { type: "number" }, description: "Euler radians [x, y, z]" },
        scale: vec3,
      },
      required: ["id"],
    },
  },
  {
    name: "remove_node",
    description: "Delete a node by id, along with any animation tracks and physics bodies targeting it.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "add_light",
    description: "Add a light. `type` is ambient, directional, or point. directional lights take a `direction` they travel along (e.g. [0,-1,0] = straight down).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "optional; auto-generated if omitted" },
        type: { type: "string", enum: ["ambient", "directional", "point"] },
        color,
        intensity: { type: "number" },
        direction: vec3,
      },
      required: ["type"],
    },
  },
  {
    name: "set_camera",
    description: "Move the active camera and/or set its look-at target and field of view (degrees).",
    input_schema: {
      type: "object",
      properties: {
        position: vec3,
        lookAt: vec3,
        fov: { type: "number", description: "vertical field of view in degrees" },
      },
    },
  },
  {
    name: "add_animation",
    description: "Animate a node property over frames. `path` is a dot path like 'position.y', 'rotation.y', 'position', or 'scale'. Keyframe `value` is a number for a single axis or an array for a whole vector.",
    input_schema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        path: { type: "string" },
        keyframes,
      },
      required: ["nodeId", "path", "keyframes"],
    },
  },
];

/** Map a Claude tool_use block back to an EditOperation. Returns null for unknown tools. */
export function toolUseToOperation(name: string, input: unknown): EditOperation | null {
  const i = input as Record<string, unknown>;
  switch (name) {
    case "set_meta":
      return { op: "setMeta", ...i } as EditOperation;
    case "set_material":
      return { op: "setMaterial", ...i } as EditOperation;
    case "add_mesh":
      return { op: "addMesh", ...i } as EditOperation;
    case "update_node":
      return { op: "updateNode", ...i } as EditOperation;
    case "remove_node":
      return { op: "removeNode", ...i } as EditOperation;
    case "add_light":
      return { op: "addLight", ...i } as EditOperation;
    case "set_camera":
      return { op: "setCamera", ...i } as EditOperation;
    case "add_animation":
      return { op: "addAnimation", ...i } as EditOperation;
    default:
      return null;
  }
}
