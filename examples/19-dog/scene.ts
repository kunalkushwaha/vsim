// Example 19 — a procedural QUADRUPED. A rigged four-legged creature (13-bone spine + neck/head +
// tail + four two-bone legs) generated headlessly in Blender (scripts/blender/make-quadruped.py,
// pure MIT, no assets) with a diagonal trot gait. Loaded by name like any rig; trots across grass.
import { scene } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";

export default (async () => {
  const { rig, meta } = await loadCharacter("dog", 30);

  return scene({ fps: 30, duration: 90, width: 854, height: 480, background: [0.53, 0.74, 0.96] })
    .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
    .material("grass", { color: [0.30, 0.55, 0.26] })
    .material("fur", { color: [0.55, 0.40, 0.24] })
    .light({ type: "hemisphere", intensity: 0.65, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
    .light({ type: "directional", intensity: 0.95, direction: [-0.4, -1, -0.35] })
    .mesh("ground", { geometry: { kind: "plane", size: [40, 40] }, material: "grass" })
    .tree("t0", { position: [-3, 0, -4], height: 2.6 })
    .tree("t1", { position: [4, 0, -5], height: 2.2 })
    .character("dog", rig, {
      clip: "trot", loop: true, material: "fur",
      scale: [meta.scale, meta.scale, meta.scale], rotation: meta.rotation,
    })
    // the rig faces -z; walk it forward along -z and film from a 3/4 side angle to show the gait
    .animate("dog", "position.z", [{ frame: 0, value: 4 }, { frame: 90, value: -4 }])
    .group("aim", { position: [0, 0.5, 4] })
    .animate("aim", "position.z", [{ frame: 0, value: 4 }, { frame: 90, value: -4 }])
    .camera({ position: [4.5, 2.2, 4.5], lookAtNodeId: "aim", fov: 42 })
    .build();
})();
