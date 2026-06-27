// Example 06 — a rigged Fox from the bundled character library, walking on grass.
//
// loadCharacter("fox") returns the parsed rig plus placement metadata (scale/rotation/clip), so a
// scene doesn't need to know the model's quirks. The scene exports a Promise (it loads an asset);
// the CLI awaits it. Asset license: see packages/assets/library/CREDITS.md.
import { scene } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";

export default (async () => {
  const { rig, meta } = await loadCharacter("fox", 30);

  return scene({ fps: 30, duration: 96, width: 640, height: 360, background: [0.53, 0.74, 0.96] })
    .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
    .material("grass", { color: [0.27, 0.55, 0.24] })
    .material("fox", { color: [0.78, 0.42, 0.18], roughness: 0.7 })
    .light({ type: "hemisphere", intensity: 0.55, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
    .light({ type: "directional", intensity: 0.85, direction: [-0.4, -1, -0.3] })
    .mesh("ground", { geometry: { kind: "plane", size: [60, 60] }, material: "grass" })
    .character("fox", rig, {
      clip: meta.defaultClip,
      loop: true,
      material: "fox",
      scale: [meta.scale, meta.scale, meta.scale],
      rotation: meta.rotation,
    })
    // The fox faces -X, so walk it in -X (forward), crossing the field right → left.
    .animate("fox", "position.x", [{ frame: 0, value: 4 }, { frame: 96, value: -4 }])
    // An aim point that rides along the fox's path at body height, for the tracking camera.
    .group("aim", { position: [4, 0.5, 0] })
    .animate("aim", "position.x", [{ frame: 0, value: 4 }, { frame: 96, value: -4 }])
    .camera({ position: [0, 1.5, 6.5], lookAtNodeId: "aim", fov: 40 })
    .build();
})();
