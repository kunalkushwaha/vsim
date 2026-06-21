import { scene } from "@vsim/authoring";

/**
 * Example 01 — the "code → video" magic moment.
 * A spinning, bouncing cube over a floor, lit by an ambient + directional light.
 *
 *   pnpm render examples/01-cube/scene.ts -o out/cube.mp4
 */
export default scene({
  fps: 30,
  duration: 90, // 3 seconds
  width: 640,
  height: 360,
  background: [0.04, 0.05, 0.08],
})
  .material("cube", { color: [0.95, 0.4, 0.4], roughness: 0.5 })
  .material("floor", { color: [0.14, 0.15, 0.2] })
  .light({ type: "ambient", intensity: 0.35 })
  .light({ type: "directional", intensity: 1.2, direction: [-0.5, -1, -0.35] })
  .mesh("floor", { geometry: { kind: "plane", size: [20, 20] }, material: "floor", position: [0, -1, 0] })
  .mesh("cube", { geometry: { kind: "box", size: [1.4, 1.4, 1.4] }, material: "cube", position: [0, 0.2, 0] })
  .camera({ position: [3, 2.2, 4.5], lookAt: [0, 0.3, 0], fov: 45 })
  .animate("cube", "rotation.y", [
    { frame: 0, value: 0 },
    { frame: 90, value: Math.PI * 2 },
  ])
  .animate("cube", "position.y", [
    { frame: 0, value: 0.2, easing: "easeInOut" },
    { frame: 45, value: 1.4, easing: "easeInOut" },
    { frame: 90, value: 0.2, easing: "easeInOut" },
  ])
  .build();
