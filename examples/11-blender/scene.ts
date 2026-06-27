// Example 11 — a character created in Blender, walking on grass.
//
// The rig is generated headlessly by scripts/blender/make-character.py (see
// docs/guides/blender-characters.md) and loaded by name from the library. This shows the
// Blender → glTF → vsim pipeline end to end: no hand-coded skeleton, no third-party assets.
import { scene } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";

export default (async () => {
  const { rig, meta } = await loadCharacter("figure", 30);

  return scene({ fps: 30, duration: 90, width: 640, height: 360, background: [0.53, 0.74, 0.96] })
    .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
    .material("grass", { color: [0.27, 0.55, 0.24] })
    .material("body", { color: [0.55, 0.62, 0.85] })
    .light({ type: "hemisphere", intensity: 0.55, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
    .light({ type: "directional", intensity: 0.85, direction: [-0.4, -1, -0.3] })
    .mesh("ground", { geometry: { kind: "plane", size: [40, 40] }, material: "grass" })
    .character("figure", rig, {
      clip: meta.defaultClip,
      loop: true,
      material: "body",
      scale: [meta.scale, meta.scale, meta.scale],
      rotation: meta.rotation,
    })
    .animate("figure", "position.x", [{ frame: 0, value: -3 }, { frame: 90, value: 3 }])
    .group("aim", { position: [-3, 1.0, 0] })
    .animate("aim", "position.x", [{ frame: 0, value: -3 }, { frame: 90, value: 3 }])
    .camera({ position: [0, 1.5, 5.5], lookAtNodeId: "aim", fov: 42 })
    .build();
})();
