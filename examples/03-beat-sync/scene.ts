import { fileURLToPath } from "node:url";
import { scene, beatsFromBPM, pulseKeyframes } from "@vsim/authoring";

/**
 * Example 03 — audio beat-sync.
 * A cube pops on every beat. Beats are FRAME indices (not seconds), so the audio-reactive
 * motion is perfectly reproducible: preview == render == every variant.
 *
 *   pnpm render examples/03-beat-sync/scene.ts -o out/beat.mp4
 * (the scene exports `audioPath`, so the click track is muxed automatically)
 */
const FPS = 30;
const DURATION = 120; // 4s
const BPM = 120;
const beats = beatsFromBPM(BPM, FPS, DURATION); // [0,15,30,...,105]

/** The audio file is muxed automatically by the CLI via this export. */
export const audioPath = fileURLToPath(new URL("./beat.mp3", import.meta.url));

export default scene({ fps: FPS, duration: DURATION, width: 640, height: 360, background: [0.03, 0.03, 0.06] })
  .material("cube", { color: [0.55, 0.45, 0.95], emissive: [0.02, 0.0, 0.06], roughness: 0.4 })
  .material("floor", { color: [0.1, 0.1, 0.14] })
  .light({ type: "ambient", intensity: 0.3 })
  .light({ type: "directional", intensity: 1.1, direction: [-0.4, -1, -0.45] })
  .light({ type: "point", color: [0.6, 0.4, 1], intensity: 6, position: [0, 3, 2] }, "rim")
  .mesh("floor", { geometry: { kind: "plane", size: [24, 24] }, material: "floor", position: [0, -1.2, 0] })
  .mesh("cube", { geometry: { kind: "box", size: [1.5, 1.5, 1.5] }, material: "cube" })
  .camera({ position: [2.6, 1.8, 4.5], lookAt: [0, 0, 0], fov: 45 })
  // continuous spin
  .animate("cube", "rotation.y", [
    { frame: 0, value: 0 },
    { frame: DURATION, value: Math.PI * 2 },
  ])
  // scale pop on each beat (beats are frame indices → reproducible)
  .animate("cube", "scale", pulseKeyframes(beats, { base: 1, peak: 1.45, release: 9 }))
  // emissive flash on each beat
  .animateMaterial(
    "cube",
    "emissive",
    beats.flatMap((fb) => [
      { frame: fb, value: [0.5, 0.2, 0.9], easing: "easeOut" as const },
      { frame: fb + 9, value: [0.02, 0.0, 0.06], easing: "easeOut" as const },
    ]),
  )
  .audio("beat", { gain: 0.8, beats })
  .build();
