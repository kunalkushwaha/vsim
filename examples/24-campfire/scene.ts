// Example 24 — campfire at dusk: the "real-life" lighting showcase.
//
// One warm point light IS the scene: it flickers (deterministic keyframes), throws
// six-face cube shadows from the logs, stones, and fox, and ACES tone mapping rolls
// the flame highlights off filmically. Sparks and smoke are closed-form particles;
// the dusk sky, hemisphere ambient, and fog do the rest. Every frame is reproducible.
import { scene } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";

const DUR = 150;

// Deterministic flicker curves — layered sines sampled every few frames. Pure functions
// of the frame index, so the "randomness" is identical on every render.
const flick = (f: number, a: number, b: number) =>
  0.5 + 0.5 * (Math.sin(f * a) * 0.6 + Math.sin(f * b + 1.7) * 0.4);
const every = (step: number, fn: (f: number) => number) => {
  const keys: { frame: number; value: number }[] = [];
  for (let f = 0; f <= DUR; f += step) keys.push({ frame: f, value: fn(f) });
  return keys;
};

export default (async () => {
  const { rig, meta } = await loadCharacter("fox", 30);

  const b = scene({ fps: 30, duration: DUR, width: 960, height: 540, tone: "aces", background: [0.05, 0.06, 0.12] })
    // Post-sunset sky: deep indigo overhead fading to the last burnt-orange glow.
    .sky([0.05, 0.07, 0.17], [0.34, 0.17, 0.12], { ambient: 0.3 })
    .fog([0.06, 0.07, 0.12], 9, 26) // night swallows the far trees
    // Faint blue moonlight fill so the unlit side isn't pure black.
    .light({ type: "hemisphere", intensity: 0.22, skyColor: [0.2, 0.26, 0.45], groundColor: [0.05, 0.045, 0.04] })
    .light({ type: "directional", intensity: 0.12, color: [0.55, 0.65, 0.95], direction: [-0.3, -1, -0.2] })
    // THE fire — a warm point light at the flame heart with inverse-square falloff
    // (decay 2), so the light pools around the pit and the woods stay night. Cube
    // shadows on; position jitters a little each few frames so shadows breathe.
    .light({ type: "point", intensity: 6.5, decay: 2, color: [1.0, 0.58, 0.22], position: [0, 0.62, 0] }, "fire_light")
    .material("ground", { color: [0.11, 0.11, 0.085], roughness: 0.95 })
    .mesh("earth", { geometry: { kind: "plane", size: [60, 60] }, material: "ground" })
    .grass("tuft", { area: [14, 10], count: 380, height: 0.22, color: [0.13, 0.19, 0.1], colorDark: [0.09, 0.14, 0.075] });

  // --- fire pit ---------------------------------------------------------------------------
  // (rock()/tree() share prop materials; the FIRST call sets the palette — night-dark here.)
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.rock(`ring${i}`, { position: [Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62], radius: 0.14 + (i % 3) * 0.025, color: [0.21, 0.2, 0.19] });
  }
  b.material("log", { color: [0.2, 0.12, 0.06], roughness: 0.85 })
    .material("log_char", { color: [0.09, 0.07, 0.06], roughness: 0.95 });
  // Teepee of three charred logs whose tips meet inside the flames…
  b.mesh("log1", { geometry: { kind: "cylinder", radius: 0.05, height: 0.72, segments: 8 }, material: "log_char", position: [0, 0.2, 0], rotation: [0, 0.4, 1.15] })
    .mesh("log2", { geometry: { kind: "cylinder", radius: 0.05, height: 0.72, segments: 8 }, material: "log_char", position: [0, 0.2, 0], rotation: [0, 2.5, 1.15] })
    .mesh("log3", { geometry: { kind: "cylinder", radius: 0.05, height: 0.72, segments: 8 }, material: "log_char", position: [0, 0.2, 0], rotation: [0, 4.6, 1.15] })
    // …two fresh logs lying across the ember bed…
    .mesh("log4", { geometry: { kind: "cylinder", radius: 0.06, height: 0.7, segments: 8 }, material: "log", position: [0.08, 0.07, 0.1], rotation: [0, 1.1, Math.PI / 2] })
    .mesh("log5", { geometry: { kind: "cylinder", radius: 0.055, height: 0.65, segments: 8 }, material: "log", position: [-0.1, 0.06, -0.06], rotation: [0, 2.3, Math.PI / 2] })
    // …and a log bench for scale + a big shadow-caster facing the camera side.
    .mesh("bench", { geometry: { kind: "cylinder", radius: 0.16, height: 1.7, segments: 10 }, material: "log", position: [-1.7, 0.16, 1.15], rotation: [0, 0.5, Math.PI / 2] });

  // --- flames: a cluster of slim emissive tongues, each flickering on its own phase ---------
  // Every tongue is a cone inside a BASE-PIVOTED group, so scale flicker stretches it upward
  // out of the embers instead of through the ground. Emissive = unlit → they read as light,
  // and ACES rolls the hot cores off filmically instead of clipping.
  b.material("flame_core", { color: [1, 0.9, 0.5], emissive: [2.0, 1.5, 0.55], roughness: 1 })
    .material("flame_mid", { color: [1, 0.55, 0.12], emissive: [1.6, 0.62, 0.1], roughness: 1 })
    .material("flame_wisp", { color: [1, 0.4, 0.08], emissive: [1.1, 0.34, 0.06], opacity: 0.55, roughness: 1 })
    .material("ember", { color: [1, 0.32, 0.05], emissive: [1.3, 0.32, 0.05], roughness: 1 })
    .mesh("embers", { geometry: { kind: "sphere", radius: 0.2, segments: 10 }, material: "ember", position: [0, 0.015, 0], scale: [1.4, 0.22, 1.4] });

  const tongue = (
    id: string, mat: string, r: number, h: number,
    pos: [number, number, number], a: number, b2: number, amp: number,
  ) => {
    b.group(id, { position: pos })
      .mesh(`${id}__cone`, { parent: id, position: [0, h / 2, 0], geometry: { kind: "cone", radius: r, height: h, segments: 10 }, material: mat })
      .animate(id, "scale.y", every(3, (f) => 1 - amp / 2 + amp * flick(f, a, b2)))
      .animate(id, "scale.x", every(4, (f) => 1 + (amp / 2) * (flick(f, b2, a) - 0.5)))
      .animate(id, "scale.z", every(4, (f) => 1 + (amp / 2) * (flick(f, a * 1.4, b2 * 0.7) - 0.5)))
      .animate(id, "rotation.z", every(5, (f) => 0.14 * (flick(f, a * 0.8, b2 * 1.3) - 0.5)));
  };
  tongue("fl_core", "flame_core", 0.09, 0.44, [0, 0.06, 0], 1.1, 2.7, 0.5);
  tongue("fl_mid1", "flame_mid", 0.11, 0.38, [0.14, 0.05, 0.06], 0.9, 2.2, 0.65);
  tongue("fl_mid2", "flame_mid", 0.1, 0.33, [-0.13, 0.05, -0.07], 1.5, 3.1, 0.65);
  tongue("fl_mid3", "flame_mid", 0.08, 0.27, [0.03, 0.05, -0.14], 1.9, 0.7, 0.75);
  tongue("fl_mid4", "flame_mid", 0.07, 0.24, [-0.05, 0.05, 0.13], 0.6, 2.9, 0.75);
  tongue("fl_wisp", "flame_wisp", 0.11, 0.78, [0.01, 0.09, 0], 1.3, 3.4, 0.8);

  // The light itself breathes: tiny position jitter shifts every cube-shadow edge.
  b.animate("fire_light", "position.y", every(6, (f) => 0.58 + 0.1 * flick(f, 1.3, 3.1)))
    .animate("fire_light", "position.x", every(7, (f) => 0.06 * (flick(f, 2.1, 0.8) - 0.5)));

  // --- sparks & smoke (closed-form, scrub-safe) --------------------------------------------
  b.particles("sparks", {
    position: [0, 0.45, 0], spread: [0.12, 0.1, 0.12], count: 46,
    velocity: [0, 1.5, 0], velocitySpread: [0.5, 0.5, 0.5], gravity: [0, -0.55, 0],
    lifeFrames: 34, size: 0.014, color: [1, 0.55, 0.16], opacity: 0.95, seed: 7,
  }).particles("smoke", {
    position: [0.05, 1.0, 0], spread: [0.08, 0.12, 0.08], count: 20,
    velocity: [0.18, 0.5, 0.05], velocitySpread: [0.12, 0.18, 0.12], gravity: [0, 0.1, 0],
    lifeFrames: 85, size: 0.11, color: [0.16, 0.17, 0.21], opacity: 0.14, seed: 11,
  });

  // --- the fox, resting in the light, looking around (Survey clip) -------------------------
  b.material("fox", { color: [0.72, 0.38, 0.16], roughness: 0.55 });
  const fs = meta.scale * 0.66; // a fox is small next to a fire pit
  b.character("fox", rig, {
    clip: "Survey", loop: true, material: "fox",
    scale: [fs, fs, fs],
    rotation: [0, 0.5, 0], // the fox faces −x at rest; yaw it to look at the fire
    position: [1.5, 0, -0.85],
  });

  // --- the woods, swallowed by fog ----------------------------------------------------------
  b.tree("t1", { position: [-4.5, 0, -5.5], height: 3.4, trunkColor: [0.13, 0.09, 0.06], leafColor: [0.05, 0.11, 0.06] })
    .tree("t2", { position: [-6.5, 0, -1.5], height: 2.9 })
    .tree("t3", { position: [3.8, 0, -6.5], height: 3.8, variant: "broadleaf" })
    .tree("t4", { position: [6.4, 0, -3], height: 3.1 })
    .tree("t5", { position: [-2.2, 0, -8.5], height: 3.3 })
    .tree("t6", { position: [8, 0, -7.5], height: 3.6 })
    .rock("r1", { position: [-2.9, 0, -2.1], radius: 0.34 })
    .rock("r2", { position: [2.5, 0, 1.9], radius: 0.22 });

  // --- camera: slow push-in toward the fire ------------------------------------------------
  b.camera({ position: [2.9, 1.15, 4.4], lookAt: [0.1, 0.55, 0], fov: 40 })
    .animate("__camera", "position.x", [{ frame: 0, value: 2.9 }, { frame: DUR, value: 2.2, easing: "easeInOut" }])
    .animate("__camera", "position.z", [{ frame: 0, value: 4.4 }, { frame: DUR, value: 3.6, easing: "easeInOut" }])
    .animate("__camera", "position.y", [{ frame: 0, value: 1.15 }, { frame: DUR, value: 1.0, easing: "easeInOut" }]);

  return b.build();
})();
