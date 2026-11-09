import { scene } from "@vsim/authoring";
import { loadModel } from "@vsim/assets";

/**
 * Bridge check — assetkit library models referenced BY NAME, exactly like film3d props:
 * docs -> scripts/blender/assetkit/make.py (build -> QA -> bake -> GLB) ->
 * packages/assets/models/assetkit/manifest.json -> loadModel("haveli").
 * Models are real-world metres, grounded at y=0, front facing +z.
 *
 *   pnpm render examples/04-gltf/assetkit-haveli.ts --still out/asset-proof/vsim_street.png --frame 0
 */
const [haveli, cottage, marigold, lotus] = await Promise.all(
  ["haveli", "cottage", "marigold", "lotus"].map((n) => loadModel(n)),
);

const b = scene({ fps: 30, duration: 90, width: 1280, height: 720, background: [0.58, 0.66, 0.8] })
  .material("baked", { color: [1, 1, 1], roughness: 0.8 })
  .material("ground", { color: [0.40, 0.36, 0.29], roughness: 0.95 })
  .light({ type: "ambient", intensity: 0.45 })
  .light({ type: "directional", intensity: 1.6, color: [1, 0.9, 0.75], direction: [-0.6, -1, -0.5] })
  .mesh("ground", { geometry: { kind: "plane", size: [120, 120] }, material: "ground" })
  .mesh("haveli", { geometry: { kind: "mesh", data: haveli as never }, material: "baked" })
  .mesh("cottage", { geometry: { kind: "mesh", data: cottage as never }, material: "baked", position: [16, 0, 3], rotation: [0, -0.5, 0] });

// a bed of marigolds and a few lotuses along the front — tiny real-world props, many instances
for (let i = 0; i < 14; i++) {
  b.mesh(`marigold${i}`, { geometry: { kind: "mesh", data: marigold as never }, material: "baked",
    position: [-5 + i * 0.75, 0, 8.5 + (i % 2) * 0.4], scale: [2.2, 2.2, 2.2], rotation: [0, i * 1.3, 0] });
}
for (let i = 0; i < 3; i++) {
  b.mesh(`lotus${i}`, { geometry: { kind: "mesh", data: lotus as never }, material: "baked",
    position: [6 + i * 1.6, 0, 10], scale: [1.4, 1.4, 1.4], rotation: [0, i * 2.1, 0] });
}

export default b
  .camera({ position: [12, 3.4, 27], lookAt: [3, 5, 0], fov: 48 })
  .animate("camera", "position.x", [{ frame: 0, value: 12 }, { frame: 90, value: 4 }])
  .build();
