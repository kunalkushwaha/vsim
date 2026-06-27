// Example 13 — the MakeHuman human's CLIP LIBRARY: four copies of the same rig, each looping a
// different animation (walk · run · idle · wave) side by side. The clips are authored on the rig in
// scripts/blender/make-human.py and exported as separate glTF animations; loadCharacter("human")
// exposes the whole set, and each .character() call picks which clip that copy plays.
import { scene } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";

export default (async () => {
  const { rig, meta } = await loadCharacter("human", 30);
  const clips = ["walk", "run", "idle", "wave"] as const;

  const s = scene({ fps: 30, duration: 60, width: 960, height: 360, background: [0.53, 0.74, 0.96] })
    .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
    .material("grass", { color: [0.27, 0.55, 0.24] })
    .material("skin", { color: [0.85, 0.68, 0.56] })
    .light({ type: "hemisphere", intensity: 0.6, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
    .light({ type: "directional", intensity: 0.9, direction: [-0.4, -1, -0.3] })
    .mesh("ground", { geometry: { kind: "plane", size: [40, 40] }, material: "grass" });

  // one human per clip, spread across X, turned to face the camera (rig faces +x → yaw -90° → +z)
  clips.forEach((clip, i) => {
    s.character(`h_${clip}`, rig, {
      clip,
      loop: true,
      material: "skin",
      scale: [meta.scale, meta.scale, meta.scale],
      rotation: [meta.rotation[0], -Math.PI / 2, meta.rotation[2]],
      position: [(i - (clips.length - 1) / 2) * 1.8, 0, 0],
    });
  });

  return s
    .camera({ position: [0, 1.5, 6.5], lookAt: [0, 0.9, 0], fov: 48 })
    .build();
})();
