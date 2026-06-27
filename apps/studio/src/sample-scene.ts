import { scene } from "@vsim/authoring";

/** A browser-safe procedural sample scene (no fs / glTF) for the studio to load on startup. */
export function sampleScene() {
  return scene({ fps: 30, duration: 120, width: 854, height: 480, background: [0.53, 0.74, 0.96] })
    .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
    .material("grass", { color: [0.30, 0.55, 0.26] })
    .material("cube", { color: [0.90, 0.45, 0.35] })
    .material("ball", { color: [0.35, 0.55, 0.95] })
    .light({ type: "hemisphere", intensity: 0.7, skyColor: [0.6, 0.72, 0.95], groundColor: [0.3, 0.4, 0.25] })
    .light({ type: "directional", intensity: 1.0, direction: [-0.4, -1, -0.35] })
    .mesh("ground", { geometry: { kind: "plane", size: [30, 30] }, material: "grass" })
    .tree("tree0", { position: [-3, 0, -3], height: 2.6 })
    .tree("tree1", { position: [3.5, 0, -4], height: 2.0 })
    .rock("rock0", { position: [2, 0, 1], radius: 0.5 })
    .mesh("cube", { geometry: { kind: "box", size: [1.2, 1.2, 1.2] }, material: "cube", position: [0, 0.6, 0] })
    .mesh("ball", { geometry: { kind: "sphere", radius: 0.5, segments: 20 }, material: "ball", position: [0, 0.5, 0] })
    .animate("cube", "rotation.y", [{ frame: 0, value: 0 }, { frame: 120, value: Math.PI * 2 }])
    .animate("ball", "position.y", [
      { frame: 0, value: 0.5 }, { frame: 30, value: 2.2 }, { frame: 60, value: 0.5 },
      { frame: 90, value: 2.2 }, { frame: 120, value: 0.5 },
    ])
    .animate("ball", "position.x", [{ frame: 0, value: -2.5 }, { frame: 120, value: 2.5 }])
    .camera({ position: [5, 3.2, 6], lookAt: [0, 0.8, 0], fov: 45 })
    .build();
}
