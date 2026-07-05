// Example 06 — a rigged Fox from the bundled character library, walking through a
// golden-hour clearing (procedural trees/rocks, warm low sun + rim light).
//
// loadCharacter("fox") returns the parsed rig plus placement metadata (scale/rotation/clip), so a
// scene doesn't need to know the model's quirks. The scene exports a Promise (it loads an asset);
// the CLI awaits it. Asset license: see packages/assets/library/CREDITS.md.
import { scene } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";

export default (async () => {
  const { rig, meta } = await loadCharacter("fox", 30);

  return scene({ fps: 30, duration: 96, width: 640, height: 360, background: [0.9, 0.78, 0.62] })
    .sky([0.38, 0.55, 0.88], [0.96, 0.8, 0.62]) // clear sky fading to sunset haze
    .material("grass", { color: [0.23, 0.42, 0.19], roughness: 0.9 })
    .material("fox", { color: [0.78, 0.42, 0.18], roughness: 0.45 }) // sheen for the rim light
    .light({ type: "hemisphere", intensity: 0.5, skyColor: [0.55, 0.65, 0.9], groundColor: [0.4, 0.42, 0.26] })
    .light({ type: "directional", intensity: 1.2, color: [1.0, 0.8, 0.55], direction: [-0.6, -0.55, -0.45] }) // low warm sun
    .light({ type: "point", intensity: 0.5, color: [1.0, 0.72, 0.45], position: [-3, 1.6, -2.5] }) // warm rim from behind
    .mesh("ground", { geometry: { kind: "plane", size: [80, 80] }, material: "grass" })
    .tree("t1", { position: [-5.5, 0, -6], height: 3.2 })
    .tree("t2", { position: [-2.5, 0, -8], height: 2.6, variant: "broadleaf" })
    .tree("t3", { position: [3.5, 0, -7], height: 3.6 })
    .tree("t4", { position: [6.5, 0, -5], height: 3.0, variant: "broadleaf" })
    .rock("r1", { position: [1.6, 0, -1.6], radius: 0.4 })
    .rock("r2", { position: [-3.4, 0, -3], radius: 0.6 })
    .character("fox", rig, {
      clip: meta.defaultClip,
      loop: true,
      material: "fox",
      scale: [meta.scale, meta.scale, meta.scale],
      rotation: meta.rotation,
    })
    .animate("fox", "position.x", [{ frame: 0, value: 3 }, { frame: 96, value: -3 }])
    .group("aim", { position: [3, 0.45, 0] })
    .animate("aim", "position.x", [{ frame: 0, value: 3 }, { frame: 96, value: -3 }])
    .camera({ position: [-2.6, 1.05, 4.6], lookAtNodeId: "aim", fov: 42 })
    .build();
})();
