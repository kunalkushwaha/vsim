// Bake vsim scene frames to flat JSON for the Cycles backend: world-space (skinned + morphed)
// geometry, the scene's actual lights/camera, materials + PBR maps — all resolved through the SAME
// SceneRuntime the preview/software renderers use, so the path-traced render matches vsim.
//
//   pnpm exec tsx apps/studio/cycles-bake.ts <scene.json|scene.ts> <out.json>            # one frame
//   pnpm exec tsx apps/studio/cycles-bake.ts <scene.json|scene.ts> <outDir> <from> <to> <step>  # a range
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SceneRuntime, parseDocument, tessellate, skinningMatrix, mat4, v3,
  type SceneDocument, type Vec3,
} from "@vsim/core";

const [scenePath, outPath, fromArg, toArg, stepArg] = process.argv.slice(2);

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
const enc = (t?: { width: number; height: number; data: Uint8Array }) =>
  t ? { width: t.width, height: t.height, rgba: Buffer.from(t.data).toString("base64") } : null;

function bakeFrame(frame: number) {
  const f = rt.computeFrameState(frame);
  const invView = mat4.invert(f.camera.viewMatrix);
  const forward = v3.normalize(mat4.transformDir(invView, [0, 0, -1]));
  const up = v3.normalize(mat4.transformDir(invView, [0, 1, 0]));
  const fovY = 2 * Math.atan(1 / f.camera.projMatrix[5]!);
  const meshes = [];
  for (const n of f.nodes) {
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
      texture: enc(md.texture), normalMap: enc(md.normalMap), metallicRoughnessMap: enc(md.metallicRoughnessMap),
      occlusionMap: enc(md.occlusionMap), emissiveMap: enc(md.emissiveMap),
    });
  }
  return {
    width: f.width, height: f.height, background: f.background, sky: f.sky ?? null,
    camera: { position: f.camera.position, forward, up, fovY },
    lights: f.lights.map((l) => ({ type: l.type, color: l.color, intensity: l.intensity, position: l.position, direction: l.direction, skyColor: l.skyColor ?? null, groundColor: l.groundColor ?? null })),
    meshes,
  };
}

if (outPath!.endsWith(".json")) {
  await writeFile(resolve(outPath!), JSON.stringify(bakeFrame(Number(fromArg ?? 0))));
  console.log(`baked frame ${fromArg ?? 0} → ${outPath}`);
} else {
  const dir = resolve(outPath!);
  await mkdir(dir, { recursive: true });
  const last = doc.meta.durationFrames - 1;
  const from = Number(fromArg ?? 0), to = Math.min(Number(toArg ?? last), last), step = Number(stepArg ?? 1);
  const frames: string[] = [];
  for (let fr = from; fr <= to; fr += step) {
    const name = `frame_${String(frames.length).padStart(4, "0")}.json`;
    await writeFile(join(dir, name), JSON.stringify(bakeFrame(fr)));
    frames.push(name);
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ fps: doc.meta.fps, width: doc.meta.width, height: doc.meta.height, frames }));
  console.log(`baked ${frames.length} frames (${from}..${to} step ${step}) → ${dir}`);
}
