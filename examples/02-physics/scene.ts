import { scene } from "@vsim/authoring";

/**
 * Example 02 — deterministic physics.
 * A stack of boxes topples under gravity (Rapier). Render it twice → identical video.
 *
 *   pnpm render examples/02-physics/scene.ts -o out/physics.mp4
 */
const b = scene({
  fps: 30,
  duration: 120, // 4 seconds
  width: 640,
  height: 360,
  substeps: 4,
  background: [0.05, 0.06, 0.09],
})
  .material("ground", { color: [0.16, 0.17, 0.22] })
  .material("box", { color: [0.4, 0.72, 0.95], roughness: 0.5 })
  .light({ type: "ambient", intensity: 0.4 })
  .light({ type: "directional", intensity: 1.15, direction: [-0.4, -1, -0.5] })
  .mesh("ground", { geometry: { kind: "plane", size: [30, 30] }, material: "ground", position: [0, 0, 0] })
  .camera({ position: [6, 4.5, 8], lookAt: [0, 1.5, 0], fov: 45 })
  .gravity([0, -9.81, 0])
  .body("ground", { type: "fixed", collider: { shape: "plane" } });

// A leaning tower: each box is offset further out, so the centre of mass clears the base
// and the whole stack topples — deterministically (same seed/timestep → same collapse).
for (let i = 0; i < 6; i++) {
  const id = `box${i}`;
  b.mesh(id, {
    geometry: { kind: "box", size: [1, 1, 1] },
    material: "box",
    position: [i * 0.22, 0.55 + i * 1.02, 0],
    rotation: [0, i * 0.12, 0],
  }).body(id, {
    type: "dynamic",
    collider: { shape: "box", halfExtents: [0.5, 0.5, 0.5] },
    restitution: 0.1,
    friction: 0.6,
  });
}

export default b.build();
