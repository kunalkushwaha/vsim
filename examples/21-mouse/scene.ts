// Example 21 — "Pip", an original big-eared cartoon mouse, waving at the camera.
//
// An original character built entirely from procedural primitives (NOT any branded character):
// a round black body, oversized disc ears, a tan muzzle with a glossy button nose (the specular
// highlight comes from the software renderer's per-pixel Blinn-Phong shading), white gloves,
// brown shoes and blue shorts. No skeleton needed — each limb is a node hierarchy pivoted at
// its joint and driven by plain rotation tracks: a wave, an idle bounce, a tail wag.
import { scene, type Vec3 } from "@vsim/authoring";

const BLACK: Vec3 = [0.06, 0.06, 0.07];

/** Build the scene in either render style ("manga" gives the cel-shaded + outlined look). */
export const build = (style: "realistic" | "manga" = "realistic") =>
  scene({ fps: 30, duration: 90, width: 640, height: 360, background: [0.72, 0.82, 0.94], style })
  .sky([0.45, 0.62, 0.9], [0.85, 0.9, 0.96])
  .material("fur", { color: BLACK, roughness: 0.65 })
  .material("face", { color: [0.93, 0.78, 0.62], roughness: 0.7 })
  .material("nose", { color: [0.05, 0.05, 0.06], roughness: 0.12 }) // glossy button nose
  .material("eye", { color: [0.97, 0.97, 0.97], roughness: 0.3 })
  .material("pupil", { color: [0.03, 0.03, 0.04], roughness: 0.25 })
  .material("glove", { color: [0.96, 0.96, 0.94], roughness: 0.45 })
  .material("shoe", { color: [0.5, 0.26, 0.13], roughness: 0.3 })
  .material("shorts", { color: [0.18, 0.32, 0.72], roughness: 0.7 })
  .material("floor", { color: [0.62, 0.7, 0.55], roughness: 0.85 })
  .light({ type: "hemisphere", intensity: 0.55, skyColor: [0.6, 0.72, 0.92], groundColor: [0.42, 0.44, 0.38] })
  .light({ type: "directional", intensity: 0.9, direction: [-0.3, -1, -0.45] })
  .light({ type: "point", intensity: 0.35, position: [1.8, 2.6, 3.2] }) // catchlight for the nose/eyes
  .mesh("ground", { geometry: { kind: "plane", size: [60, 60] }, material: "floor" })

  // ---- the mouse (root group; bounce + turn animate this) ------------------------------------
  .group("mouse", { position: [0, 0, 0] })
  .mesh("shorts", { parent: "mouse", geometry: { kind: "sphere", radius: 0.5, segments: 24 }, material: "shorts", position: [0, 0.78, 0], scale: [0.95, 0.8, 0.82] })
  .mesh("torso", { parent: "mouse", geometry: { kind: "sphere", radius: 0.46, segments: 24 }, material: "fur", position: [0, 1.12, 0], scale: [0.88, 0.95, 0.78] })

  // head on a neck pivot so it can tilt (ears/eyes/muzzle ride along)
  .group("head", { parent: "mouse", position: [0, 1.78, 0] })
  .mesh("skull", { parent: "head", geometry: { kind: "sphere", radius: 0.42, segments: 28 }, material: "fur" })
  .mesh("earL", { parent: "head", geometry: { kind: "sphere", radius: 0.3, segments: 24 }, material: "fur", position: [-0.38, 0.42, -0.02], scale: [1, 1, 0.28] })
  .mesh("earR", { parent: "head", geometry: { kind: "sphere", radius: 0.3, segments: 24 }, material: "fur", position: [0.38, 0.42, -0.02], scale: [1, 1, 0.28] })
  .mesh("muzzle", { parent: "head", geometry: { kind: "sphere", radius: 0.27, segments: 24 }, material: "face", position: [0, -0.1, 0.27], scale: [1, 0.78, 0.9] })
  .mesh("nose", { parent: "head", geometry: { kind: "sphere", radius: 0.1, segments: 20 }, material: "nose", position: [0, -0.02, 0.55] })
  .mesh("eyeL", { parent: "head", geometry: { kind: "sphere", radius: 0.11, segments: 20 }, material: "eye", position: [-0.14, 0.14, 0.32], scale: [1, 1.35, 0.55] })
  .mesh("eyeR", { parent: "head", geometry: { kind: "sphere", radius: 0.11, segments: 20 }, material: "eye", position: [0.14, 0.14, 0.32], scale: [1, 1.35, 0.55] })
  .mesh("pupilL", { parent: "head", geometry: { kind: "sphere", radius: 0.045, segments: 12 }, material: "pupil", position: [-0.14, 0.13, 0.395] })
  .mesh("pupilR", { parent: "head", geometry: { kind: "sphere", radius: 0.045, segments: 12 }, material: "pupil", position: [0.14, 0.13, 0.395] })

  // arms: shoulder pivot groups; the right one waves
  .group("armL", { parent: "mouse", position: [-0.38, 1.36, 0], rotation: [0, 0, -0.3] })
  .mesh("armL_shoulder", { parent: "armL", geometry: { kind: "sphere", radius: 0.1, segments: 12 }, material: "fur" })
  .mesh("armL_limb", { parent: "armL", geometry: { kind: "cylinder", radius: 0.07, height: 0.46, segments: 12 }, material: "fur", position: [0, -0.23, 0] })
  .mesh("armL_glove", { parent: "armL", geometry: { kind: "sphere", radius: 0.14, segments: 16 }, material: "glove", position: [0, -0.52, 0] })
  .group("armR", { parent: "mouse", position: [0.38, 1.36, 0], rotation: [0, 0, 0.3] })
  .mesh("armR_shoulder", { parent: "armR", geometry: { kind: "sphere", radius: 0.1, segments: 12 }, material: "fur" })
  .mesh("armR_limb", { parent: "armR", geometry: { kind: "cylinder", radius: 0.07, height: 0.46, segments: 12 }, material: "fur", position: [0, -0.23, 0] })
  .mesh("armR_glove", { parent: "armR", geometry: { kind: "sphere", radius: 0.14, segments: 16 }, material: "glove", position: [0, -0.52, 0] })

  // legs + big cartoon shoes
  .group("legL", { parent: "mouse", position: [-0.2, 0.46, 0] })
  .mesh("legL_limb", { parent: "legL", geometry: { kind: "cylinder", radius: 0.085, height: 0.4, segments: 12 }, material: "fur", position: [0, -0.2, 0] })
  .mesh("legL_shoe", { parent: "legL", geometry: { kind: "sphere", radius: 0.19, segments: 16 }, material: "shoe", position: [0, -0.42, 0.1], scale: [1, 0.75, 1.55] })
  .group("legR", { parent: "mouse", position: [0.2, 0.46, 0] })
  .mesh("legR_limb", { parent: "legR", geometry: { kind: "cylinder", radius: 0.085, height: 0.4, segments: 12 }, material: "fur", position: [0, -0.2, 0] })
  .mesh("legR_shoe", { parent: "legR", geometry: { kind: "sphere", radius: 0.19, segments: 16 }, material: "shoe", position: [0, -0.42, 0.1], scale: [1, 0.75, 1.55] })

  // thin tail, wagging from a pivot behind the shorts
  .group("tail", { parent: "mouse", position: [0, 0.72, -0.42] })
  .mesh("tail_limb", { parent: "tail", geometry: { kind: "cylinder", radius: 0.03, height: 0.62, segments: 10 }, material: "fur", position: [0, 0.05, -0.24], rotation: [1.15, 0, 0] })

  // ---- animation: idle bounce, a big arm wave, head tilt, tail wag ---------------------------
  .animate("mouse", "position.y", [
    { frame: 0, value: 0 }, { frame: 8, value: 0.06, easing: "easeOut" }, { frame: 15, value: 0, easing: "easeIn" },
    { frame: 23, value: 0.06, easing: "easeOut" }, { frame: 30, value: 0, easing: "easeIn" },
    { frame: 38, value: 0.06, easing: "easeOut" }, { frame: 45, value: 0, easing: "easeIn" },
    { frame: 53, value: 0.06, easing: "easeOut" }, { frame: 60, value: 0, easing: "easeIn" },
    { frame: 68, value: 0.06, easing: "easeOut" }, { frame: 75, value: 0, easing: "easeIn" },
    { frame: 90, value: 0 },
  ])
  .animate("armR", "rotation.z", [
    { frame: 0, value: 0 },
    { frame: 12, value: 2.25, easing: "easeOut" }, // raise
    { frame: 22, value: 1.9, easing: "easeInOut" }, // wave in…
    { frame: 32, value: 2.6, easing: "easeInOut" }, // …and out
    { frame: 42, value: 1.9, easing: "easeInOut" },
    { frame: 52, value: 2.6, easing: "easeInOut" },
    { frame: 62, value: 2.25, easing: "easeInOut" },
    { frame: 78, value: 0, easing: "easeInOut" }, // drop back down
    { frame: 90, value: 0 },
  ])
  .animate("armL", "rotation.x", [
    { frame: 0, value: 0.18 }, { frame: 22, value: -0.18, easing: "easeInOut" },
    { frame: 45, value: 0.18, easing: "easeInOut" }, { frame: 68, value: -0.18, easing: "easeInOut" },
    { frame: 90, value: 0.18, easing: "easeInOut" },
  ])
  .animate("head", "rotation.z", [
    { frame: 0, value: 0 }, { frame: 18, value: 0.12, easing: "easeInOut" },
    { frame: 48, value: -0.1, easing: "easeInOut" }, { frame: 72, value: 0.06, easing: "easeInOut" },
    { frame: 90, value: 0, easing: "easeInOut" },
  ])
  .animate("tail", "rotation.y", [
    { frame: 0, value: 0.5 }, { frame: 11, value: -0.5, easing: "easeInOut" },
    { frame: 22, value: 0.5, easing: "easeInOut" }, { frame: 33, value: -0.5, easing: "easeInOut" },
    { frame: 45, value: 0.5, easing: "easeInOut" }, { frame: 56, value: -0.5, easing: "easeInOut" },
    { frame: 67, value: 0.5, easing: "easeInOut" }, { frame: 78, value: -0.5, easing: "easeInOut" },
    { frame: 90, value: 0.5, easing: "easeInOut" },
  ])

  .camera({ position: [0.4, 1.6, 4.4], lookAt: [0, 1.15, 0], fov: 40 })
    .build();

export default build();
