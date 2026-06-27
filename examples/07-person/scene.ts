// Example 07 — a realistic rigged human (the CesiumMan sample) walking on grass.
//
// loadCharacter("person") returns the rig + placement metadata. The model is Z-up, so the
// metadata rotates it upright. Asset license: see packages/assets/library/CREDITS.md.
// (Note: the software renderer is flat-shaded — no textures yet — so the face, which is a texture,
// is not shown; the body shape and walk animation are fully realistic.)
import { scene } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";

export default (async () => {
  const { rig, meta } = await loadCharacter("person", 30);

  return scene({ fps: 30, duration: 90, width: 640, height: 360, background: [0.53, 0.74, 0.96] })
    .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
    .material("grass", { color: [0.27, 0.55, 0.24] })
    .material("skin", { color: [0.82, 0.62, 0.5], roughness: 0.7 })
    .light({ type: "hemisphere", intensity: 0.55, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
    .light({ type: "directional", intensity: 0.85, direction: [-0.4, -1, -0.3] })
    .mesh("ground", { geometry: { kind: "plane", size: [40, 40] }, material: "grass" })
    .character("person", rig, {
      clip: meta.defaultClip,
      loop: true,
      material: "skin",
      scale: [meta.scale, meta.scale, meta.scale],
      rotation: meta.rotation,
    })
    .animate("person", "position.x", [{ frame: 0, value: 3 }, { frame: 90, value: -3 }])
    .group("aim", { position: [3, 0.85, 0] })
    .animate("aim", "position.x", [{ frame: 0, value: 3 }, { frame: 90, value: -3 }])
    .camera({ position: [0, 1.4, 5.5], lookAtNodeId: "aim", fov: 42 })
    .build();
})();
