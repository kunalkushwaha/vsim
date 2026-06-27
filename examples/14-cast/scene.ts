// Example 14 — the character library's HUMAN CAST: a woman, a man, and a child, all generated from
// MakeHuman with distinct bodies (gender / age / build macros) but the same rig + clip set. They
// load by name from the library (loadCharacter) and walk together, so the size/proportion
// differences are plain to see. See scripts/blender/make-human.py for how each body was authored.
import { scene } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";

export default (async () => {
  const cast = ["human", "man", "kid"] as const;
  const loaded = await Promise.all(cast.map((id) => loadCharacter(id, 30)));

  const s = scene({ fps: 30, duration: 60, width: 960, height: 360, background: [0.53, 0.74, 0.96] })
    .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
    .material("grass", { color: [0.27, 0.55, 0.24] })
    .material("skin", { color: [0.85, 0.68, 0.56] })
    .light({ type: "hemisphere", intensity: 0.6, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
    .light({ type: "directional", intensity: 0.9, direction: [-0.4, -1, -0.3] })
    .mesh("ground", { geometry: { kind: "plane", size: [40, 40] }, material: "grass" });

  loaded.forEach(({ rig, meta }, i) => {
    s.character(cast[i], rig, {
      clip: "walk",
      loop: true,
      material: "skin",
      scale: [meta.scale, meta.scale, meta.scale],
      rotation: [meta.rotation[0], -Math.PI / 2, meta.rotation[2]], // face the camera
      position: [(i - 1) * 1.6, 0, 0],
    });
  });

  return s
    .camera({ position: [0, 1.4, 6.5], lookAt: [0, 0.8, 0], fov: 46 })
    .build();
})();
