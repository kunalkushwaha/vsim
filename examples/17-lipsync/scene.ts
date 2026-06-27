// Example 17 — lip-sync via MORPH TARGETS. The "speaker" character carries a "mouthOpen" blend
// shape (a glTF morph target). We drive its weight from audio BEAT frames, so the mouth opens on
// every beat — perfectly reproducible because beats are frame indices, not wall-clock. The morph is
// applied per-vertex in the software renderer before skinning (so preview == render).
import { fileURLToPath } from "node:url";
import { scene, beatsFromBPM, pulseKeyframes } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";

const FPS = 30, DURATION = 120, BPM = 150;
const beats = beatsFromBPM(BPM, FPS, DURATION); // frame indices
export const audioPath = fileURLToPath(new URL("./beat.mp3", import.meta.url));

export default (async () => {
  const { rig, meta } = await loadCharacter("speaker", FPS);

  return scene({ fps: FPS, duration: DURATION, width: 640, height: 360, background: [0.10, 0.12, 0.18] })
    .material("skin", { color: [0.85, 0.68, 0.56] })
    .light({ type: "hemisphere", intensity: 0.7, skyColor: [0.7, 0.75, 0.9], groundColor: [0.25, 0.22, 0.2] })
    .light({ type: "directional", intensity: 1.0, direction: [-0.3, -0.6, -0.7] })
    .character("speaker", rig, {
      clip: "idle", loop: true, material: "skin",
      scale: [meta.scale, meta.scale, meta.scale], rotation: meta.rotation,
    })
    // open the mouth on every beat (morph weight 0 → 1 → 0); path is "morph.<targetName>"
    .animate("speaker__mesh", "morph.mouthOpen", pulseKeyframes(beats, { base: 0, peak: 1, release: 5 }))
    .audio("beat", { gain: 0.8, beats })
    // close-up on the face (the rig faces +x, so frame it from the front)
    // close-up on the face, framed from the front (the rig faces +z, toward +z like example 12)
    .camera({ position: [0, 1.52, 1.5], lookAt: [0, 1.5, 0], fov: 28 })
    .build();
})();
