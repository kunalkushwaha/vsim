// Set presets — art-directed looks the compiler applies before placing props/actors.
// Each is lifted from the strongest example scene of that mood (06-fox golden hour,
// 24-campfire dusk), so an AI-authored film starts from proven lighting, not defaults.
import type { SceneBuilder, Vec3 } from "@vsim/authoring";

export interface SetLook {
  background: Vec3;
  tone?: "aces";
  sky: { top: Vec3; bottom: Vec3; sun?: { size?: number; glow?: number; color?: Vec3 }; ambient?: number };
  fog?: { color: Vec3; near: number; far: number };
  lights: Parameters<SceneBuilder["light"]>[0][];
  ground: Vec3;
  grass?: { color: Vec3; colorDark: Vec3; count: number; height: number };
  /** Palette handed to tree()/rock() so props sit in the set's light. */
  trunk: Vec3;
  leaf: Vec3;
  stone: Vec3;
}

export const SET_LOOKS: Record<"meadow" | "dusk" | "night" | "snow" | "studio", SetLook> = {
  // Golden hour (from examples/06-fox): warm low sun ahead of camera, evening haze.
  meadow: {
    background: [0.9, 0.78, 0.62],
    sky: { top: [0.38, 0.55, 0.88], bottom: [0.96, 0.8, 0.62], sun: { size: 0.045, glow: 0.4, color: [1, 0.86, 0.6] } },
    fog: { color: [0.93, 0.82, 0.68], near: 9, far: 36 },
    lights: [
      { type: "hemisphere", intensity: 0.58, skyColor: [0.62, 0.62, 0.78], groundColor: [0.42, 0.4, 0.24] },
      { type: "directional", intensity: 1.3, color: [1.0, 0.78, 0.5], direction: [-0.2, -0.3, 0.93] },
    ],
    ground: [0.23, 0.42, 0.19],
    grass: { color: [0.32, 0.52, 0.2], colorDark: [0.23, 0.4, 0.15], count: 950, height: 0.3 },
    trunk: [0.4, 0.26, 0.13],
    leaf: [0.16, 0.42, 0.17],
    stone: [0.5, 0.5, 0.52],
  },
  // Post-sunset (from examples/24-campfire): indigo sky, last orange glow, moonlight fill.
  // Pairs with the campfire prop — ACES rolls the flame highlights off filmically.
  dusk: {
    background: [0.05, 0.06, 0.12],
    tone: "aces",
    sky: { top: [0.05, 0.07, 0.17], bottom: [0.34, 0.17, 0.12], ambient: 0.3 },
    fog: { color: [0.06, 0.07, 0.12], near: 9, far: 26 },
    lights: [
      { type: "hemisphere", intensity: 0.22, skyColor: [0.2, 0.26, 0.45], groundColor: [0.05, 0.045, 0.04] },
      { type: "directional", intensity: 0.12, color: [0.55, 0.65, 0.95], direction: [-0.3, -1, -0.2] },
    ],
    ground: [0.11, 0.11, 0.085],
    grass: { color: [0.13, 0.19, 0.1], colorDark: [0.09, 0.14, 0.075], count: 380, height: 0.22 },
    trunk: [0.13, 0.09, 0.06],
    leaf: [0.05, 0.11, 0.06],
    stone: [0.21, 0.2, 0.19],
  },
  // Deep night under a blue moon — darker than dusk, no sunset glow on the horizon.
  night: {
    background: [0.02, 0.03, 0.07],
    tone: "aces",
    sky: { top: [0.02, 0.03, 0.09], bottom: [0.07, 0.09, 0.16], ambient: 0.25 },
    fog: { color: [0.03, 0.04, 0.08], near: 7, far: 22 },
    lights: [
      { type: "hemisphere", intensity: 0.3, skyColor: [0.22, 0.3, 0.55], groundColor: [0.03, 0.03, 0.05] },
      { type: "directional", intensity: 0.35, color: [0.6, 0.7, 1.0], direction: [-0.4, -1, -0.3] },
    ],
    ground: [0.07, 0.08, 0.07],
    grass: { color: [0.08, 0.12, 0.08], colorDark: [0.05, 0.09, 0.06], count: 320, height: 0.22 },
    trunk: [0.1, 0.08, 0.06],
    leaf: [0.04, 0.09, 0.06],
    stone: [0.16, 0.17, 0.19],
  },
  // Overcast winter: white ground, pale cold sky, everything desaturated by the fog.
  snow: {
    background: [0.82, 0.86, 0.92],
    sky: { top: [0.55, 0.65, 0.8], bottom: [0.88, 0.9, 0.95] },
    fog: { color: [0.86, 0.89, 0.94], near: 8, far: 30 },
    lights: [
      { type: "hemisphere", intensity: 0.85, skyColor: [0.75, 0.8, 0.92], groundColor: [0.7, 0.72, 0.78] },
      { type: "directional", intensity: 0.5, color: [0.95, 0.96, 1.0], direction: [-0.3, -1, -0.4] },
    ],
    ground: [0.88, 0.9, 0.94],
    trunk: [0.28, 0.2, 0.14],
    leaf: [0.15, 0.3, 0.2],
    stone: [0.55, 0.58, 0.64],
  },
  // Neutral three-point studio — a dark stage for product/character turntables.
  studio: {
    background: [0.07, 0.075, 0.09],
    lights: [
      { type: "hemisphere", intensity: 0.35, skyColor: [0.5, 0.52, 0.6], groundColor: [0.12, 0.12, 0.14] },
      { type: "directional", intensity: 1.0, color: [1, 0.98, 0.94], direction: [-0.5, -0.8, -0.4] },
      { type: "directional", intensity: 0.35, color: [0.6, 0.7, 1.0], direction: [0.7, -0.4, 0.5] },
    ],
    sky: { top: [0.09, 0.1, 0.13], bottom: [0.05, 0.055, 0.07] },
    ground: [0.16, 0.165, 0.19],
    trunk: [0.35, 0.24, 0.13],
    leaf: [0.18, 0.4, 0.2],
    stone: [0.45, 0.46, 0.5],
  },
};

/** Apply a set look: sky, fog, lights, tone, the ground plane, and a grass patch. */
export function applySet(b: SceneBuilder, look: SetLook): void {
  b.sky(look.sky.top, look.sky.bottom, { sun: look.sky.sun, ambient: look.sky.ambient });
  if (look.fog) b.fog(look.fog.color, look.fog.near, look.fog.far);
  for (const l of look.lights) b.light(l);
  b.material("__set_ground", { color: look.ground, roughness: 0.95 });
  b.mesh("__set_earth", { geometry: { kind: "plane", size: [70, 70] }, material: "__set_ground" });
  if (look.grass) {
    b.grass("__set_lawn", { area: [22, 16], count: look.grass.count, height: look.grass.height, color: look.grass.color, colorDark: look.grass.colorDark });
  }
}

// Deterministic flicker curves (from examples/24-campfire) — layered sines sampled every
// few frames: pure functions of the frame index, identical on every render.
const flick = (f: number, a: number, b: number) =>
  0.5 + 0.5 * (Math.sin(f * a) * 0.6 + Math.sin(f * b + 1.7) * 0.4);
const every = (dur: number, step: number, fn: (f: number) => number) => {
  const keys: { frame: number; value: number }[] = [];
  for (let f = 0; f <= dur; f += step) keys.push({ frame: f, value: fn(f) });
  return keys;
};

/**
 * The campfire set piece, ported from examples/24-campfire: a stone ring, a teepee of
 * charred logs over an ember bed, layered emissive flame tongues flickering on their own
 * phases, spark/smoke particles, and THE fire light — a warm inverse-square point light
 * whose position breathes so every cube-shadow edge moves. Everything hangs off a group
 * `id` at (x, 0, z); flicker keyframes span the whole film (`durationFrames`).
 */
export function campfire(b: SceneBuilder, id: string, x: number, z: number, durationFrames: number): void {
  b.group(id, { position: [x, 0, z] });
  b.light(
    { type: "point", intensity: 6.5, decay: 2, color: [1.0, 0.58, 0.22], position: [0, 0.62, 0], parent: id },
    `${id}__light`,
  );
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.rock(`${id}__ring${i}`, { parent: id, position: [Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62], radius: 0.14 + (i % 3) * 0.025, color: [0.21, 0.2, 0.19] });
  }
  b.material(`${id}__log`, { color: [0.2, 0.12, 0.06], roughness: 0.85 })
    .material(`${id}__char`, { color: [0.09, 0.07, 0.06], roughness: 0.95 })
    .mesh(`${id}__log1`, { parent: id, geometry: { kind: "cylinder", radius: 0.05, height: 0.72, segments: 8 }, material: `${id}__char`, position: [0, 0.2, 0], rotation: [0, 0.4, 1.15] })
    .mesh(`${id}__log2`, { parent: id, geometry: { kind: "cylinder", radius: 0.05, height: 0.72, segments: 8 }, material: `${id}__char`, position: [0, 0.2, 0], rotation: [0, 2.5, 1.15] })
    .mesh(`${id}__log3`, { parent: id, geometry: { kind: "cylinder", radius: 0.05, height: 0.72, segments: 8 }, material: `${id}__char`, position: [0, 0.2, 0], rotation: [0, 4.6, 1.15] })
    .mesh(`${id}__log4`, { parent: id, geometry: { kind: "cylinder", radius: 0.06, height: 0.7, segments: 8 }, material: `${id}__log`, position: [0.08, 0.07, 0.1], rotation: [0, 1.1, Math.PI / 2] })
    .mesh(`${id}__log5`, { parent: id, geometry: { kind: "cylinder", radius: 0.055, height: 0.65, segments: 8 }, material: `${id}__log`, position: [-0.1, 0.06, -0.06], rotation: [0, 2.3, Math.PI / 2] });

  b.material(`${id}__flame_core`, { color: [1, 0.9, 0.5], emissive: [2.0, 1.5, 0.55], roughness: 1 })
    .material(`${id}__flame_mid`, { color: [1, 0.55, 0.12], emissive: [1.6, 0.62, 0.1], roughness: 1 })
    .material(`${id}__flame_wisp`, { color: [1, 0.4, 0.08], emissive: [1.1, 0.34, 0.06], opacity: 0.55, roughness: 1 })
    .material(`${id}__ember`, { color: [1, 0.32, 0.05], emissive: [1.3, 0.32, 0.05], roughness: 1 })
    .mesh(`${id}__embers`, { parent: id, geometry: { kind: "sphere", radius: 0.2, segments: 10 }, material: `${id}__ember`, position: [0, 0.015, 0], scale: [1.4, 0.22, 1.4] });

  // Base-pivoted flame tongues: scale flicker stretches them upward out of the embers.
  const tongue = (tid: string, mat: string, r: number, h: number, pos: Vec3, a: number, b2: number, amp: number) => {
    b.group(tid, { parent: id, position: pos })
      .mesh(`${tid}__cone`, { parent: tid, position: [0, h / 2, 0], geometry: { kind: "cone", radius: r, height: h, segments: 10 }, material: mat })
      .animate(tid, "scale.y", every(durationFrames, 3, (f) => 1 - amp / 2 + amp * flick(f, a, b2)))
      .animate(tid, "scale.x", every(durationFrames, 4, (f) => 1 + (amp / 2) * (flick(f, b2, a) - 0.5)))
      .animate(tid, "scale.z", every(durationFrames, 4, (f) => 1 + (amp / 2) * (flick(f, a * 1.4, b2 * 0.7) - 0.5)))
      .animate(tid, "rotation.z", every(durationFrames, 5, (f) => 0.14 * (flick(f, a * 0.8, b2 * 1.3) - 0.5)));
  };
  tongue(`${id}__fl_core`, `${id}__flame_core`, 0.09, 0.44, [0, 0.06, 0], 1.1, 2.7, 0.5);
  tongue(`${id}__fl_mid1`, `${id}__flame_mid`, 0.11, 0.38, [0.14, 0.05, 0.06], 0.9, 2.2, 0.65);
  tongue(`${id}__fl_mid2`, `${id}__flame_mid`, 0.1, 0.33, [-0.13, 0.05, -0.07], 1.5, 3.1, 0.65);
  tongue(`${id}__fl_mid3`, `${id}__flame_mid`, 0.08, 0.27, [0.03, 0.05, -0.14], 1.9, 0.7, 0.75);
  tongue(`${id}__fl_mid4`, `${id}__flame_mid`, 0.07, 0.24, [-0.05, 0.05, 0.13], 0.6, 2.9, 0.75);
  tongue(`${id}__fl_wisp`, `${id}__flame_wisp`, 0.11, 0.78, [0.01, 0.09, 0], 1.3, 3.4, 0.8);

  b.animate(`${id}__light`, "position.y", every(durationFrames, 6, (f) => 0.58 + 0.1 * flick(f, 1.3, 3.1)))
    .animate(`${id}__light`, "position.x", every(durationFrames, 7, (f) => 0.06 * (flick(f, 2.1, 0.8) - 0.5)));

  b.particles(`${id}__sparks`, {
    position: [x, 0.45, z], spread: [0.12, 0.1, 0.12], count: 46,
    velocity: [0, 1.5, 0], velocitySpread: [0.5, 0.5, 0.5], gravity: [0, -0.55, 0],
    lifeFrames: 34, size: 0.014, color: [1, 0.55, 0.16], opacity: 0.95, seed: 7,
  }).particles(`${id}__smoke`, {
    position: [x + 0.05, 1.0, z], spread: [0.08, 0.12, 0.08], count: 20,
    velocity: [0.18, 0.5, 0.05], velocitySpread: [0.12, 0.18, 0.12], gravity: [0, 0.1, 0],
    lifeFrames: 85, size: 0.11, color: [0.16, 0.17, 0.21], opacity: 0.14, seed: 11,
  });
}
