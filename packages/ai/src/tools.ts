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
        style: { type: "string", enum: ["realistic", "manga"], description: "manga = cel-shading + outlines" },
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
    description: "Add a light. `type` is ambient, directional, point, or hemisphere. directional lights take a `direction` they travel along (e.g. [0,-1,0] = straight down). hemisphere lights take skyColor (lights upward-facing surfaces) and groundColor (downward) — great natural outdoor fill.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "optional; auto-generated if omitted" },
        type: { type: "string", enum: ["ambient", "directional", "point", "hemisphere"] },
        color,
        intensity: { type: "number" },
        direction: vec3,
        skyColor: color,
        groundColor: color,
      },
      required: ["type"],
    },
  },
  {
    name: "set_camera",
    description: "Move the active (default) camera and/or set its look-at target and field of view (degrees).",
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
    name: "add_camera",
    description: "Add a named camera (for multi-shot scenes). Reference it from set_shot. Set `lookAtNodeId` to make it track a moving node (a tracking shot), or `lookAt` for a fixed target.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "name to reference from set_shot" },
        position: vec3,
        lookAt: vec3,
        lookAtNodeId: { type: "string", description: "id of a node to aim at every frame (tracking)" },
        fov: { type: "number", description: "vertical field of view in degrees" },
      },
      required: ["id"],
    },
  },
  {
    name: "set_shot",
    description: "Film a frame range with a named camera (a cut in the shot timeline). Add multiple to cut between camera angles. Frames are inclusive.",
    input_schema: {
      type: "object",
      properties: {
        cameraId: { type: "string", description: "id of a camera from add_camera" },
        startFrame: { type: "integer" },
        endFrame: { type: "integer" },
      },
      required: ["cameraId", "startFrame", "endFrame"],
    },
  },
  {
    name: "set_environment",
    description: "Set a gradient sky background. skyTop is the color overhead, skyBottom the color at the horizon (e.g. a blue sky: skyTop [0.32,0.52,0.92], skyBottom [0.74,0.85,0.97]).",
    input_schema: {
      type: "object",
      properties: {
        skyTop: color,
        skyBottom: color,
      },
    },
  },
  {
    name: "add_text",
    description: "Add a screen-space text overlay (title, caption, or lower-third) drawn on top of the 3D. Position is normalized [0..1], origin top-left; `align` anchors horizontally and `y` is the line's vertical center. For a caption/lower-third, set a `box` (filled background). Animate it with add_animation using overlayId (fade=opacity, slide=x/y). Defaults: x 0.5, y 0.5, size 64, white, centered.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        text: { type: "string" },
        x: { type: "number", description: "0..1 left→right" },
        y: { type: "number", description: "0..1 top→bottom (vertical center of the line)" },
        size: { type: "number", description: "font size in output pixels" },
        color,
        opacity: { type: "number" },
        align: { type: "string", enum: ["left", "center", "right"] },
        box: {
          type: "object",
          description: "optional filled background box behind the text (lower-thirds / captions)",
          properties: { color, opacity: { type: "number" }, padding: { type: "number" } },
        },
      },
      required: ["id", "text"],
    },
  },
  {
    name: "remove_text",
    description: "Delete a text overlay by id, along with any animation tracks targeting it.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "add_animation",
    description: "Animate a property over frames. Target a node with `nodeId` (path like 'position.y', 'rotation.y', 'position', 'scale') OR a text overlay with `overlayId` (path 'opacity', 'x', 'y', 'size', or 'color'). Keyframe `value` is a number for a single axis or an array for a whole vector.",
    input_schema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "id of a node to animate" },
        overlayId: { type: "string", description: "id of a text overlay to animate (use instead of nodeId)" },
        path: { type: "string" },
        keyframes,
      },
      required: ["path", "keyframes"],
    },
  },
];

/**
 * A compact textual description of the edit tools, for prompting models that take plain
 * text (e.g. the `claude` CLI) instead of structured tool definitions. `*` marks required
 * fields.
 */
/** Describe a JSON-schema node compactly, expanding nested objects/arrays/enums one level deep. */
function describeSchema(v: any): string {
  if (!v || typeof v !== "object") return "any";
  if (v.enum) return v.enum.join("|");
  if (v.type === "object" && v.properties) {
    const sub = Object.entries(v.properties)
      .map(([k, sv]) => `${k}: ${describeSchema(sv)}`)
      .join(", ");
    return `{ ${sub} }`;
  }
  if (v.type === "array") return `${describeSchema(v.items)}[]`;
  if (v.anyOf) return v.anyOf.map(describeSchema).join("|");
  return v.type ?? "any";
}

export function toolsReference(): string {
  return EDIT_TOOLS.map((t) => {
    const schema = t.input_schema as { properties?: Record<string, any>; required?: string[] };
    const required = schema.required ?? [];
    const fields = Object.entries(schema.properties ?? {})
      .map(([k, v]) => `${k}${required.includes(k) ? "*" : ""} (${describeSchema(v)})`)
      .join(", ");
    return `- ${t.name}: ${t.description}\n    input: ${fields || "(none)"}`;
  }).join("\n");
}

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
    case "add_camera":
      return { op: "addCamera", ...i } as EditOperation;
    case "set_shot":
      return { op: "setShot", ...i } as EditOperation;
    case "set_environment":
      return { op: "setEnvironment", ...i } as EditOperation;
    case "add_text":
      return { op: "addText", ...i } as EditOperation;
    case "remove_text":
      return { op: "removeText", ...i } as EditOperation;
    case "add_animation":
      return { op: "addAnimation", ...i } as EditOperation;
    default:
      return null;
  }
}
