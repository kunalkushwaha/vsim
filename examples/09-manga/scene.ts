// Example 09 — manga (cel-shaded) mode.
//
// The same realistic rigged human as example 07, but rendered in MANGA style: meta.style:"manga"
// switches the renderer to banded cel-shading + silhouette outlines (the look view-simulator calls
// "manga mode"). It's a one-flag toggle — no special assets.
import { scene } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";

export default (async () => {
  const { rig, meta } = await loadCharacter("person", 30);

  return scene({ fps: 30, duration: 90, width: 640, height: 360, background: [0.53, 0.74, 0.96], style: "manga" })
    .sky([0.34, 0.56, 0.95], [0.78, 0.88, 0.98])
    .material("grass", { color: [0.32, 0.62, 0.28] })
    .material("skin", { color: [0.86, 0.66, 0.54] })
    .light({ type: "hemisphere", intensity: 0.5, skyColor: [0.6, 0.75, 0.98], groundColor: [0.32, 0.5, 0.24] })
    .light({ type: "directional", intensity: 0.95, direction: [-0.5, -1, -0.35] })
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
