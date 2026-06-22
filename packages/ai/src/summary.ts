import type { SceneDocument } from "@vsim/core";

/**
 * A compact, human-readable inventory of a scene — node ids and what they are, material
 * ids, camera, and meta. Given to the model so it edits existing items (by their real
 * ids) instead of inventing new geometry.
 */
export function summarizeScene(doc: SceneDocument): string {
  const lines: string[] = [];
  const m = doc.meta;
  lines.push(`meta: ${m.width}x${m.height} @ ${m.fps}fps, ${m.durationFrames} frames, background ${JSON.stringify(m.background)}`);

  if (doc.materials.length) {
    lines.push("materials:");
    for (const mat of doc.materials) lines.push(`  - ${mat.id}: color ${JSON.stringify(mat.color)}`);
  }

  lines.push("nodes:");
  for (const n of doc.nodes) {
    let kind = "group";
    if (n.mesh) kind = `mesh(${n.mesh.geometry.kind}${n.mesh.materialId ? `, material=${n.mesh.materialId}` : ""})`;
    else if (n.light) kind = `light(${n.light.type})`;
    else if (n.id === doc.camera.nodeId) kind = "camera";
    lines.push(`  - ${n.id}: ${kind} at ${JSON.stringify(n.position)}`);
  }

  lines.push(`camera: node ${doc.camera.nodeId}, fov ${doc.camera.fov}${doc.camera.lookAt ? `, lookAt ${JSON.stringify(doc.camera.lookAt)}` : ""}`);
  if (doc.animation.length) lines.push(`animation: ${doc.animation.length} track(s)`);
  if (doc.physics?.bodies.length) lines.push(`physics: ${doc.physics.bodies.length} body(ies)`);
  return lines.join("\n");
}
