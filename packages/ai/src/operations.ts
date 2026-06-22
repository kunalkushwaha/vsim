import { parseDocument, type SceneDocument, type Vec3 } from "@vsim/core";

/**
 * Edit operations are the copilot's "patch" format: a small, closed vocabulary of
 * structural mutations on a SceneDocument. The AI proposes them (as schema-constrained
 * tool calls); `applyOperations` applies them deterministically. The AI is an
 * authoring-time tool — it produces a document, it never touches the runtime — so the
 * determinism guarantee is unaffected.
 */

export type GeometrySpec =
  | { kind: "box"; size?: Vec3 }
  | { kind: "sphere"; radius?: number; segments?: number }
  | { kind: "plane"; size?: [number, number] }
  | { kind: "gltf"; assetId: string };

export interface Keyframe {
  frame: number;
  value: number | number[];
  easing?: string;
}

export type EditOperation =
  | { op: "setMeta"; fps?: number; durationFrames?: number; width?: number; height?: number; background?: Vec3 }
  | { op: "setMaterial"; id: string; color?: Vec3; emissive?: Vec3; opacity?: number; roughness?: number; metalness?: number }
  | { op: "addMesh"; id: string; geometry: GeometrySpec; material?: string; position?: Vec3; rotation?: Vec3; scale?: Vec3 }
  | { op: "updateNode"; id: string; position?: Vec3; rotation?: Vec3; scale?: Vec3 }
  | { op: "removeNode"; id: string }
  | { op: "addLight"; id?: string; type: "ambient" | "directional" | "point"; color?: Vec3; intensity?: number; direction?: Vec3 }
  | { op: "setCamera"; position?: Vec3; lookAt?: Vec3; fov?: number }
  | { op: "addAnimation"; nodeId: string; path: string; keyframes: Keyframe[] };

type Draft = {
  meta: Record<string, unknown>;
  materials: Record<string, unknown>[];
  nodes: Record<string, unknown>[];
  animation: { target: { nodeId?: string; materialId?: string; path: string }; keyframes: Keyframe[] }[];
  physics?: { gravity?: Vec3; bodies: { nodeId: string }[] };
  camera: { nodeId: string; fov?: number; lookAt?: Vec3; near?: number; far?: number };
  [k: string]: unknown;
};

/** Copy only the keys that are actually present (not undefined) from src onto target. */
function assignDefined<T extends Record<string, unknown>>(target: Record<string, unknown>, src: T, keys: (keyof T)[]): void {
  for (const k of keys) {
    if (src[k] !== undefined) target[k as string] = src[k];
  }
}

function findNode(draft: Draft, id: string): Record<string, unknown> | undefined {
  return draft.nodes.find((n) => n.id === id);
}

function nextLightId(draft: Draft): string {
  let i = 0;
  while (draft.nodes.some((n) => n.id === `__light${i}`)) i++;
  return `__light${i}`;
}

function applyOne(draft: Draft, op: EditOperation): void {
  switch (op.op) {
    case "setMeta": {
      assignDefined(draft.meta, op, ["fps", "durationFrames", "width", "height", "background"]);
      break;
    }
    case "setMaterial": {
      let mat = draft.materials.find((m) => m.id === op.id);
      if (!mat) {
        mat = { id: op.id };
        draft.materials.push(mat);
      }
      assignDefined(mat, op, ["color", "emissive", "opacity", "roughness", "metalness"]);
      break;
    }
    case "addMesh": {
      let node = findNode(draft, op.id);
      if (!node) {
        node = { id: op.id };
        draft.nodes.push(node);
      }
      node.mesh = { geometry: op.geometry, materialId: op.material };
      assignDefined(node, op, ["position", "rotation", "scale"]);
      break;
    }
    case "updateNode": {
      const node = findNode(draft, op.id);
      if (!node) throw new Error(`updateNode: no node with id "${op.id}"`);
      assignDefined(node, op, ["position", "rotation", "scale"]);
      break;
    }
    case "removeNode": {
      draft.nodes = draft.nodes.filter((n) => n.id !== op.id);
      draft.animation = draft.animation.filter((t) => t.target.nodeId !== op.id);
      if (draft.physics) draft.physics.bodies = draft.physics.bodies.filter((b) => b.nodeId !== op.id);
      break;
    }
    case "addLight": {
      const id = op.id ?? nextLightId(draft);
      let node = findNode(draft, id);
      if (!node) {
        node = { id };
        draft.nodes.push(node);
      }
      const light: Record<string, unknown> = { type: op.type };
      assignDefined(light, op, ["color", "intensity", "direction"]);
      node.light = light;
      break;
    }
    case "setCamera": {
      let node = findNode(draft, draft.camera.nodeId);
      if (!node) {
        node = { id: draft.camera.nodeId };
        draft.nodes.push(node);
      }
      assignDefined(node, op, ["position"]);
      assignDefined(draft.camera, op, ["lookAt", "fov"]);
      break;
    }
    case "addAnimation": {
      draft.animation.push({ target: { nodeId: op.nodeId, path: op.path }, keyframes: op.keyframes });
      break;
    }
  }
}

/**
 * Apply a list of edit operations to a scene document, producing a new validated
 * document. Pure and deterministic: same (doc, ops) → same output, every time. Throws a
 * readable error (via `parseDocument`) if the operations produce an invalid document.
 */
export function applyOperations(doc: SceneDocument, ops: EditOperation[]): SceneDocument {
  const draft = structuredClone(doc) as unknown as Draft;
  draft.materials ??= [];
  draft.nodes ??= [];
  draft.animation ??= [];
  for (const op of ops) applyOne(draft, op);
  return parseDocument(draft);
}
