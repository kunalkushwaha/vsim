import { fileURLToPath } from "node:url";
import { scene } from "@vsim/authoring";

/**
 * Example 04 — load a glTF/GLB mesh (the "Blender asset source" pipeline).
 * Run `pnpm --filter @vsim/example-gltf make-asset` once to generate model.glb, then:
 *
 *   pnpm render examples/04-gltf/scene.ts -o out/gltf.mp4
 */
const modelPath = fileURLToPath(new URL("./model.glb", import.meta.url));

export default scene({ fps: 30, duration: 90, width: 640, height: 360, background: [0.03, 0.04, 0.07] })
  .asset("torus", "gltf", modelPath)
  .material("metal", { color: [0.85, 0.7, 0.3], roughness: 0.35, metalness: 0.8 })
  .material("floor", { color: [0.12, 0.13, 0.17] })
  .light({ type: "ambient", intensity: 0.35 })
  .light({ type: "directional", intensity: 1.2, direction: [-0.5, -1, -0.3] })
  .light({ type: "point", color: [0.4, 0.6, 1], intensity: 8, position: [-2, 1, 3] }, "rim")
  .mesh("floor", { geometry: { kind: "plane", size: [24, 24] }, material: "floor", position: [0, -1.4, 0] })
  .mesh("torus", { geometry: { kind: "gltf", assetId: "torus" }, material: "metal" })
  .camera({ position: [0, 1.6, 4.2], lookAt: [0, 0, 0], fov: 50 })
  .animate("torus", "rotation.x", [{ frame: 0, value: 0 }, { frame: 90, value: Math.PI * 2 }])
  .animate("torus", "rotation.y", [{ frame: 0, value: 0 }, { frame: 90, value: Math.PI }])
  .build();
