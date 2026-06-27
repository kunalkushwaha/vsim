// Example 06 — a downloaded rigged character (the glTF "Fox" sample) walking on grass.
//
// Unlike the procedural figure in example 05, this loads a real rigged glTF: loadGltfRig parses
// its skin, 24 joints, and Walk/Run/Survey clips. The scene exports a Promise (it loads an asset),
// which the CLI awaits. See CREDITS.md for the asset's license (CC0 model + CC-BY rig/animation).
import { scene } from "@vsim/authoring";
import { loadGltfRig } from "@vsim/assets";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default (async () => {
  const fox = await loadGltfRig(join(here, "Fox.glb"), 30);

  return scene({ fps: 30, duration: 96, width: 640, height: 360, background: [0.53, 0.74, 0.96] })
    .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
    .material("grass", { color: [0.27, 0.55, 0.24] })
    .material("fox", { color: [0.78, 0.42, 0.18], roughness: 0.7 })
    .light({ type: "hemisphere", intensity: 0.55, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
    .light({ type: "directional", intensity: 0.85, direction: [-0.4, -1, -0.3] })
    .mesh("ground", { geometry: { kind: "plane", size: [60, 60] }, material: "grass" })
    // The Fox model is ~80 units tall; scale it down to ~1.5 units and loop its Walk clip.
    .character("fox", fox, { clip: "Walk", loop: true, material: "fox", scale: [0.02, 0.02, 0.02] })
    // The fox faces -X, so walk it in -X (forward). It crosses the field right → left.
    .animate("fox", "position.x", [{ frame: 0, value: 4 }, { frame: 96, value: -4 }])
    // Aim point at the fox's mid-height (local 40 × 0.02 scale ≈ 0.8) that rides along with it.
    .group("foxAim", { parent: "fox", position: [0, 40, 0] })
    // A tracking camera pans to follow the fox across the field.
    .camera({ position: [0, 1.5, 6.5], lookAtNodeId: "foxAim", fov: 40 })
    .build();
})();
