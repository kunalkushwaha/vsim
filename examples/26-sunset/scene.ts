// Example 26 — the environment is an animation target: a sunset with a passing shower.
//
// Three core channels introduced together: `animateEnv` lerps the sky gradient, fog, and
// background from golden hour to dusk MID-FILM (the sky-derived hemisphere ambient follows
// automatically); a `light.intensity` track dims the sun with it; and the shower is a
// `streak`ed particle system — each drop draws as a line along its own velocity, falling
// straight through the changing light.
import { scene } from "@vsim/authoring";

const DAY = { top: [0.38, 0.55, 0.88], bottom: [0.96, 0.8, 0.62] } as const;
const DUSK = { top: [0.05, 0.07, 0.17], bottom: [0.34, 0.17, 0.12] } as const;

export default scene({ fps: 30, duration: 240, width: 640, height: 360, background: [0.9, 0.78, 0.62] })
  .sky([...DAY.top], [...DAY.bottom], { ambient: 0.45 })
  .fog([0.93, 0.82, 0.68], 9, 36)
  .light({ type: "directional", intensity: 1.2, color: [1.0, 0.78, 0.5], direction: [-0.2, -0.35, 0.9] }, "sun")
  .material("ground", { color: [0.23, 0.4, 0.2], roughness: 0.95 })
  .material("trunk", { color: [0.38, 0.25, 0.13], roughness: 0.9 })
  .mesh("ground", { geometry: { kind: "plane", size: [60, 60] }, material: "ground" })
  .tree("t1", { position: [-2.5, 0, -3], height: 3.6 })
  .tree("t2", { position: [2.8, 0, -5], height: 4.2, variant: "broadleaf" })
  .rock("r1", { position: [1.2, 0, -1.5], radius: 0.5 })
  // The shower: streaked drops, pre-warmed so it rains from frame 0.
  .particles("rain", {
    position: [0, 8, -3], spread: [12, 1, 8], count: 900,
    velocity: [0.4, -10, 0], velocitySpread: [0.3, 1.2, 0.3], gravity: [0, 0, 0],
    lifeFrames: 30, startFrame: -30, size: 0.014, color: [0.6, 0.66, 0.78], opacity: 0.35,
    streak: 0.045, seed: 11,
  })
  // Day → dusk across the middle of the film. Every value below is an ordinary keyframe
  // track — pause the playhead anywhere and that exact sky renders, byte-identically.
  .animateEnv("sky.top", [{ frame: 60, value: [...DAY.top] }, { frame: 180, value: [...DUSK.top] }])
  .animateEnv("sky.bottom", [{ frame: 60, value: [...DAY.bottom] }, { frame: 180, value: [...DUSK.bottom] }])
  .animateEnv("background", [{ frame: 60, value: [0.9, 0.78, 0.62] }, { frame: 180, value: [0.05, 0.06, 0.12] }])
  .animateEnv("fog.color", [{ frame: 60, value: [0.93, 0.82, 0.68] }, { frame: 180, value: [0.06, 0.07, 0.12] }])
  .animateEnv("sky.ambient", [{ frame: 60, value: 0.45 }, { frame: 180, value: 0.22 }])
  .animate("sun", "light.intensity", [{ frame: 60, value: 1.2 }, { frame: 180, value: 0.15 }])
  .camera({ position: [0, 1.6, 5.5], lookAt: [0, 0.8, -2], fov: 50 })
  .build();
