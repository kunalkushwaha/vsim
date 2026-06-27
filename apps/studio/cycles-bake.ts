// Bake one frame of a vsim scene to a flat JSON for the Cycles backend: world-space (skinned +
// morphed) geometry, the scene's actual lights and camera, and materials — all resolved through the
// SAME SceneRuntime the software/preview renderers use, so the path-traced render matches vsim.
//
//   pnpm exec tsx apps/studio/cycles-bake.ts <scene.json|scene.ts> <out.json> [frame]
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SceneRuntime, parseDocument, tessellate, skinningMatrix, mat4, v3,
  type SceneDocument, type Vec3,
} from "@vsim/core";

const [scenePath, outPath, frameArg] = process.argv.slice(2);
const frame = Number(frameArg ?? 0);

async function loadDoc(p: string): Promise<SceneDocument> {
  const abs = resolve(p);
  if (abs.endsWith(".json")) return parseDocument(JSON.parse(await readFile(abs, "utf8")));
  const { tsImport } = await import("tsx/esm/api");
  const mod: any = await tsImport(pathToFileURL(abs).href, import.meta.url);
  return (await mod.default) as SceneDocument; // scene modules default-export a built (or async) document
}

const doc = await loadDoc(scenePath!);
const rt = new SceneRuntime(doc);
await rt.init();
const fs = rt.computeFrameState(frame);

// camera: derive world forward/up + vertical FOV from the resolved matrices
const invView = mat4.invert(fs.camera.viewMatrix);
const forward = v3.normalize(mat4.transformDir(invView, [0, 0, -1]));
const up = v3.normalize(mat4.transformDir(invView, [0, 1, 0]));
const fovY = 2 * Math.atan(1 / fs.camera.projMatrix[5]!);

// meshes: bake each node's vertices into world space (morph → skin/transform), like the SW engine
const meshes = [];
for (const n of fs.nodes) {
  if (!n.mesh) continue;
  const md = tessellate(n.mesh.geometry);
  if (!md.indices.length) continue;
  const vcount = md.positions.length / 3;
  const jm = n.skin?.jointMatrices;
  const skinned = jm !== undefined && md.joints !== undefined && md.weights !== undefined;
  const morphs = md.morphTargets && n.morphWeights
    ? md.morphTargets.map((t, i) => ({ d: t.deltas, w: n.morphWeights![i] ?? 0 })).filter((m) => m.w !== 0)
    : [];
  const positions: number[] = [], normals: number[] = [];
  for (let i = 0; i < vcount; i++) {
    let p: Vec3 = [md.positions[i * 3]!, md.positions[i * 3 + 1]!, md.positions[i * 3 + 2]!];
    for (const m of morphs) p = [p[0] + m.w * m.d[i * 3]!, p[1] + m.w * m.d[i * 3 + 1]!, p[2] + m.w * m.d[i * 3 + 2]!];
    const M = skinned ? skinningMatrix(jm!, md.joints!, md.weights!, i) : n.worldMatrix;
    const wp = mat4.transformPoint(M, p);
    const wn = v3.normalize(mat4.transformDir(M, [md.normals[i * 3]!, md.normals[i * 3 + 1]!, md.normals[i * 3 + 2]!]));
    positions.push(wp[0], wp[1], wp[2]); normals.push(wn[0], wn[1], wn[2]);
  }
  const mat = n.material;
  meshes.push({
    name: n.id, positions, normals, indices: md.indices, uvs: md.uvs ?? null,
    color: mat?.color ?? [0.8, 0.8, 0.8], roughness: mat?.roughness ?? 0.8, metalness: mat?.metalness ?? 0,
    emissive: mat?.emissive ?? [0, 0, 0], skin: skinned,
    texture: md.texture ? { width: md.texture.width, height: md.texture.height, rgba: Buffer.from(md.texture.data).toString("base64") } : null,
  });
}

const out = {
  width: fs.width, height: fs.height, background: fs.background, sky: fs.sky ?? null,
  camera: { position: fs.camera.position, forward, up, fovY },
  lights: fs.lights.map((l) => ({ type: l.type, color: l.color, intensity: l.intensity, position: l.position, direction: l.direction, skyColor: l.skyColor ?? null, groundColor: l.groundColor ?? null })),
  meshes,
};
await writeFile(resolve(outPath!), JSON.stringify(out));
console.log(`baked frame ${frame}: ${meshes.length} meshes, ${fs.lights.length} lights → ${outPath}`);
