// Example 18 — PROPS dress the scene. The library now has procedural prop builders (.tree(), .rock())
// built from new cylinder/cone primitives — deterministic, no binary assets. Here a character walks
// through a small park of trees and boulders. Vary tree height per index for a believable stand.
import { scene } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";

export default (async () => {
  const { rig, meta } = await loadCharacter("man", 30);

  const s = scene({ fps: 30, duration: 120, width: 854, height: 480, background: [0.53, 0.74, 0.96] })
    .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
    .material("grass", { color: [0.30, 0.55, 0.26] })
    .material("skin", { color: [0.85, 0.68, 0.56] })
    .light({ type: "hemisphere", intensity: 0.65, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
    .light({ type: "directional", intensity: 0.95, direction: [-0.4, -1, -0.35] })
    .mesh("ground", { geometry: { kind: "plane", size: [60, 60] }, material: "grass" });

  // a stand of trees (deterministic positions + heights) + a few boulders
  const trees: [number, number][] = [[-6, -5], [-2.5, -7], [3, -6], [6.5, -4], [-7, 1], [7.5, 2]];
  trees.forEach(([x, z], i) => s.tree(`tree${i}`, { position: [x, 0, z], height: 2.2 + (i % 3) * 0.6 }));
  s.rock("rock0", { position: [-3.5, 0, -2], radius: 0.6 });
  s.rock("rock1", { position: [4, 0, -1.5], radius: 0.45 });
  s.rock("rock2", { position: [1.5, 0, 1.5], radius: 0.35 });

  return s
    .character("man", rig, {
      clip: "walk", loop: true, material: "skin",
      scale: [meta.scale, meta.scale, meta.scale], rotation: meta.rotation,
    })
    .animate("man", "position.x", [{ frame: 0, value: -6 }, { frame: 120, value: 6 }])
    .group("aim", { position: [-6, 1.0, 0] })
    .animate("aim", "position.x", [{ frame: 0, value: -6 }, { frame: 120, value: 6 }])
    .camera({ position: [0, 2.4, 9], lookAtNodeId: "aim", fov: 46 })
    .build();
})();
