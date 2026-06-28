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
  | { op: "setMeta"; fps?: number; durationFrames?: number; width?: number; height?: number; background?: Vec3; style?: "realistic" | "manga" }
  | { op: "setMaterial"; id: string; color?: Vec3; emissive?: Vec3; opacity?: number; roughness?: number; metalness?: number }
  | { op: "addMesh"; id: string; geometry: GeometrySpec; material?: string; position?: Vec3; rotation?: Vec3; scale?: Vec3 }
  | { op: "updateNode"; id: string; position?: Vec3; rotation?: Vec3; scale?: Vec3 }
  | { op: "removeNode"; id: string }
  | { op: "addLight"; id?: string; type: "ambient" | "directional" | "point" | "hemisphere"; color?: Vec3; intensity?: number; direction?: Vec3; skyColor?: Vec3; groundColor?: Vec3 }
  | { op: "setCamera"; position?: Vec3; lookAt?: Vec3; fov?: number }
  | { op: "addCamera"; id: string; position?: Vec3; lookAt?: Vec3; lookAtNodeId?: string; fov?: number }
  | { op: "setShot"; cameraId: string; startFrame: number; endFrame: number }
  | { op: "setEnvironment"; skyTop?: Vec3; skyBottom?: Vec3 }
  | { op: "addText"; id: string; text: string; x?: number; y?: number; size?: number; color?: Vec3; opacity?: number; align?: "left" | "center" | "right"; box?: { color?: Vec3; opacity?: number; padding?: number } }
  | { op: "removeText"; id: string }
  | { op: "addAnimation"; nodeId?: string; overlayId?: string; path: string; keyframes: Keyframe[] };

type Draft = {
  meta: Record<string, unknown>;
  materials: Record<string, unknown>[];
  nodes: Record<string, unknown>[];
  animation: { target: { nodeId?: string; materialId?: string; cameraId?: string; overlayId?: string; path: string }; keyframes: Keyframe[] }[];
  overlays?: Record<string, unknown>[];
  physics?: { gravity?: Vec3; bodies: { nodeId: string }[] };
  camera: { nodeId: string; fov?: number; lookAt?: Vec3; near?: number; far?: number };
  cameras?: Record<string, unknown>[];
  shots?: { cameraId: string; startFrame: number; endFrame: number }[];
  environment?: { sky?: Record<string, unknown> };
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
      assignDefined(draft.meta, op, ["fps", "durationFrames", "width", "height", "background", "style"]);
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
      assignDefined(light, op, ["color", "intensity", "direction", "skyColor", "groundColor"]);
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
    case "addCamera": {
      const nodeId = `__cam_${op.id}`;
      let node = findNode(draft, nodeId);
      if (!node) {
        node = { id: nodeId };
        draft.nodes.push(node);
      }
      assignDefined(node, op, ["position"]);
      draft.cameras ??= [];
      let cam = draft.cameras.find((c) => c.id === op.id);
      if (!cam) {
        cam = { id: op.id, nodeId };
        draft.cameras.push(cam);
      }
      assignDefined(cam, op, ["lookAt", "lookAtNodeId", "fov"]);
      break;
    }
    case "setShot": {
      draft.shots ??= [];
      draft.shots.push({ cameraId: op.cameraId, startFrame: op.startFrame, endFrame: op.endFrame });
      break;
    }
    case "setEnvironment": {
      const sky: Record<string, unknown> = { type: "gradient" };
      if (op.skyTop !== undefined) sky.top = op.skyTop;
      if (op.skyBottom !== undefined) sky.bottom = op.skyBottom;
      draft.environment = { ...(draft.environment ?? {}), sky };
      break;
    }
    case "addText": {
      draft.overlays ??= [];
      let ov = draft.overlays.find((o) => o.id === op.id);
      if (!ov) {
        ov = { id: op.id };
        draft.overlays.push(ov);
      }
      ov.text = op.text;
      assignDefined(ov, op, ["x", "y", "size", "color", "opacity", "align", "box"]);
      break;
    }
    case "removeText": {
      draft.overlays = (draft.overlays ?? []).filter((o) => o.id !== op.id);
      draft.animation = draft.animation.filter((t) => t.target.overlayId !== op.id);
      break;
    }
    case "addAnimation": {
      const target = op.overlayId ? { overlayId: op.overlayId, path: op.path } : { nodeId: op.nodeId!, path: op.path };
      draft.animation.push({ target, keyframes: op.keyframes });
      break;
    }
  }
}

/**
 * Apply a list of edit operations to a scene document, producing a new validated
 * document. Pure and deterministic: same (doc, ops) → same output, every time.
 *
 * By default it's strict: if the operations produce an invalid document, it throws (via
 * `parseDocument`). With `{ skipInvalid: true }` it applies operations one at a time and
 * silently drops any that would make the document invalid — useful for AI-proposed edits,
 * where one malformed op shouldn't discard the rest of a generation.
 */
export function applyOperations(
  doc: SceneDocument,
  ops: EditOperation[],
  opts: { skipInvalid?: boolean } = {},
): SceneDocument {
  if (opts.skipInvalid) {
    let current = doc;
    for (const op of ops) {
      try {
        current = applyOperations(current, [op]); // strict single-op apply
      } catch {
        // drop the malformed op and keep going
      }
    }
    return current;
  }
  const draft = structuredClone(doc) as unknown as Draft;
  draft.materials ??= [];
  draft.nodes ??= [];
  draft.animation ??= [];
  for (const op of ops) applyOne(draft, op);
  return parseDocument(draft);
}
