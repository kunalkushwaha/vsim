// Example 12 — a realistic human created with MakeHuman, walking on grass.
//
// The rig was generated headlessly with MakeHuman's MPFB 2 Blender add-on
// (scripts/blender/make-human.py → packages/assets/library/human.glb, CC0) — a ~22k-vertex human
// with a 53-bone skeleton, a real (CC0) skin texture, and a clip library (walk/run/idle/wave).
// It loads by name from the library, no hand-coded rig. See examples/13-clips for the other clips.
import { scene } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";

export default (async () => {
  const { rig, meta } = await loadCharacter("human", 30);

  return scene({ fps: 30, duration: 90, width: 640, height: 360, background: [0.53, 0.74, 0.96] })
    .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
    .material("grass", { color: [0.27, 0.55, 0.24] })
    .material("skin", { color: [0.85, 0.68, 0.56] })
    .light({ type: "hemisphere", intensity: 0.6, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
    .light({ type: "directional", intensity: 0.9, direction: [-0.4, -1, -0.3] })
    .mesh("ground", { geometry: { kind: "plane", size: [40, 40] }, material: "grass" })
    .character("human", rig, {
      clip: meta.defaultClip,
      loop: true,
      material: "skin",
      scale: [meta.scale, meta.scale, meta.scale],
      rotation: meta.rotation,
    })
    .animate("human", "position.x", [{ frame: 0, value: -3 }, { frame: 90, value: 3 }])
    .group("aim", { position: [-3, 0.9, 0] })
    .animate("aim", "position.x", [{ frame: 0, value: -3 }, { frame: 90, value: 3 }])
    .camera({ position: [0, 1.4, 5.5], lookAtNodeId: "aim", fov: 42 })
    .build();
})();
