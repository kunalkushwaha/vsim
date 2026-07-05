// Example 23 — clip-to-clip crossfade: ONE human blends idle → walk → run on a single skeleton.
//
// .character() starts the idle; each .playClip() ramps the next clip in over `blendIn` frames
// (smoothstep) on top of the previous pose — no snapping between animations. The first clip
// itself eases in from the static bind pose. All weights are pure functions of the frame index,
// so the transitions are deterministic and scrub-safe.
import { scene } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";

export default (async () => {
  const { rig, meta } = await loadCharacter("human", 30);

  return scene({ fps: 30, duration: 150, width: 640, height: 360, background: [0.53, 0.74, 0.96] })
    .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
    .material("grass", { color: [0.27, 0.55, 0.24] })
    .material("skin", { color: [0.85, 0.68, 0.56] })
    .light({ type: "hemisphere", intensity: 0.6, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
    .light({ type: "directional", intensity: 0.9, direction: [-0.4, -1, -0.3] })
    .mesh("ground", { geometry: { kind: "plane", size: [40, 40] }, material: "grass" })
    .character("h", rig, {
      clip: "idle", loop: true, material: "skin", blendIn: 10,
      scale: [meta.scale, meta.scale, meta.scale],
      rotation: [meta.rotation[0], -Math.PI / 2.6, meta.rotation[2]],
    })
    .playClip("h", "walk", { startFrame: 50, blendIn: 15, loop: true })
    .playClip("h", "run", { startFrame: 100, blendIn: 15, loop: true })
    .camera({ position: [0.6, 1.4, 3.6], lookAt: [0, 0.9, 0], fov: 45 })
    .build();
})();
