import { scene } from "@vsim/authoring";

/**
 * Example 20 — text & titles.
 * Screen-space text composited on top of the 3D: a title card that fades in/out, a lower-third
 * caption that slides in, and a static corner credit. Text is true vector type (a bundled font
 * filled by @vsim/text), so it's crisp at any size and identical in draft + photoreal renders.
 *
 *   pnpm render examples/20-titles/scene.ts -o out/titles.mp4
 */
export default scene({
  fps: 30,
  duration: 120, // 4 seconds
  width: 1280,
  height: 720,
})
  .sky([0.10, 0.13, 0.22], [0.30, 0.36, 0.52])
  .material("cube", { color: [0.95, 0.45, 0.35], roughness: 0.5 })
  .material("floor", { color: [0.12, 0.13, 0.18] })
  .light({ type: "ambient", intensity: 0.4 })
  .light({ type: "directional", intensity: 1.2, direction: [-0.5, -1, -0.35] })
  .mesh("floor", { geometry: { kind: "plane", size: [30, 30] }, material: "floor", position: [0, -1, 0] })
  .mesh("cube", { geometry: { kind: "box", size: [1.6, 1.6, 1.6] }, material: "cube", position: [0, 0.3, 0] })
  .camera({ position: [3, 2.4, 4.8], lookAt: [0, 0.3, 0], fov: 45 })
  .animate("cube", "rotation.y", [
    { frame: 0, value: 0 },
    { frame: 120, value: Math.PI * 2 },
  ])

  // Title card: fades in, holds, fades out over frames 0–55.
  .title("title", "vsim", { y: 0.42, size: 150, startFrame: 0, endFrame: 55, fade: 12 })
  .text("subtitle", "code → 3D video", { y: 0.56, size: 44, color: [0.85, 0.9, 1] })
  .animateOverlay("subtitle", "opacity", [
    { frame: 0, value: 0 },
    { frame: 14, value: 1, easing: "easeOut" },
    { frame: 45, value: 1 },
    { frame: 55, value: 0, easing: "easeIn" },
  ])

  // Lower-third: slides in from the left at frame 60 and stays.
  .text("lower", "Deterministic. Open source.", {
    x: 0.05, y: 0.84, size: 40, align: "left",
    box: { color: [0.04, 0.05, 0.09], opacity: 0.62, padding: 16 },
  })
  .animateOverlay("lower", "opacity", [{ frame: 58, value: 0 }, { frame: 64, value: 1 }])
  .animateOverlay("lower", "x", [
    { frame: 58, value: -0.4 },
    { frame: 70, value: 0.05, easing: "easeOut" },
  ])

  // Static corner credit.
  .text("credit", "made with vsim", { x: 0.97, y: 0.95, size: 26, align: "right", color: [0.8, 0.84, 0.95], opacity: 0.85 })
  .build();
