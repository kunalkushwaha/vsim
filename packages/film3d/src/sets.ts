// Set presets — art-directed looks the compiler applies before placing props/actors.
// Each is lifted from the strongest example scene of that mood (06-fox golden hour,
// 24-campfire dusk), so an AI-authored film starts from proven lighting, not defaults.
import type { SceneBuilder, Vec3 } from "@vsim/authoring";
import { v3 } from "@vsim/core";
import type { Film3DProp } from "./schema.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadSurface, loadSurfaceFrames, loadModel, svgToMesh } from "@vsim/assets";

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
  /** Still-water surface color (ponds). */
  water: Vec3;
  /** Blossom colors for flower patches — three accents that survive the set's light. */
  bloom: [Vec3, Vec3, Vec3];
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
    water: [0.2, 0.34, 0.42],
    bloom: [[0.9, 0.3, 0.3], [0.95, 0.8, 0.3], [0.92, 0.9, 0.88]],
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
    water: [0.05, 0.07, 0.13],
    bloom: [[0.38, 0.16, 0.18], [0.4, 0.34, 0.16], [0.38, 0.38, 0.42]],
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
    water: [0.03, 0.05, 0.1],
    bloom: [[0.24, 0.11, 0.14], [0.25, 0.22, 0.12], [0.28, 0.3, 0.36]],
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
    water: [0.52, 0.62, 0.74],
    bloom: [[0.7, 0.36, 0.36], [0.74, 0.64, 0.4], [0.85, 0.85, 0.9]],
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
    water: [0.12, 0.14, 0.18],
    bloom: [[0.8, 0.3, 0.3], [0.82, 0.72, 0.36], [0.85, 0.85, 0.88]],
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

// --- Set dressing — the prop vocabulary beyond tree/rock/campfire -------------------------
// All deterministic: layouts come from a golden-angle scatter (a pure function of the
// index), colors from the set's palette, so the same document dresses the same set forever.


/** Golden-angle scatter inside a disc — even coverage, no RNG, same layout forever. */
const scatter = (n: number, radius: number) =>
  Array.from({ length: n }, (_, i) => {
    const a = i * 2.39996323;
    const r = radius * Math.sqrt((i + 0.5) / n);
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, i };
  });

/** A shrub: overlapping flattened leaf spheres, sized to read at film distance. */
export function bush(b: SceneBuilder, look: SetLook, id: string, x: number, z: number, radius: number): void {
  b.group(id, { position: [x, 0, z] });
  b.material(`${id}__leaf`, { color: v3.scale(look.leaf, 0.92), roughness: 0.92 });
  const lobes = Math.max(3, Math.min(6, Math.round(radius * 5)));
  for (const p of scatter(lobes, radius * 0.5)) {
    const r = radius * (0.46 + 0.14 * (p.i % 3));
    b.mesh(`${id}__l${p.i}`, {
      parent: id, geometry: { kind: "sphere", radius: r, segments: 10 },
      material: `${id}__leaf`, position: [p.x, r * 0.55, p.z], scale: [1, 0.72, 1],
    });
  }
}

/** A patch of blossoms: thin stems + small heads cycling the set's three bloom accents. */
export function flowers(b: SceneBuilder, look: SetLook, id: string, x: number, z: number, radius: number): void {
  b.group(id, { position: [x, 0, z] });
  b.material(`${id}__stem`, { color: v3.scale(look.leaf, 0.8), roughness: 0.95 });
  look.bloom.forEach((c, i) => b.material(`${id}__bloom${i}`, { color: c, roughness: 0.7 }));
  const n = Math.max(6, Math.min(16, Math.round(radius * 9)));
  for (const p of scatter(n, radius)) {
    const h = 0.14 + (0.06 * (p.i % 4)) / 3;
    b.mesh(`${id}__s${p.i}`, { parent: id, geometry: { kind: "cylinder", radius: 0.008, height: h, segments: 5 }, material: `${id}__stem`, position: [p.x, h / 2, p.z] })
      .mesh(`${id}__b${p.i}`, { parent: id, geometry: { kind: "sphere", radius: 0.028, segments: 6 }, material: `${id}__bloom${p.i % 3}`, position: [p.x, h + 0.02, p.z] });
  }
}

/** A sawn stump: trunk-colored cylinder with a pale cut face on top. */
export function stump(b: SceneBuilder, look: SetLook, id: string, x: number, z: number, radius: number): void {
  b.group(id, { position: [x, 0, z] });
  b.material(`${id}__bark`, { color: look.trunk, roughness: 0.9 })
    .material(`${id}__cut`, { color: v3.scale([0.75, 0.62, 0.42], 0.9 + 0.1 * look.ground[1]), roughness: 0.8 })
    .mesh(`${id}__trunk`, { parent: id, geometry: { kind: "cylinder", radius, height: 0.32, segments: 10 }, material: `${id}__bark`, position: [0, 0.16, 0] })
    .mesh(`${id}__face`, { parent: id, geometry: { kind: "cylinder", radius: radius * 0.86, height: 0.02, segments: 10 }, material: `${id}__cut`, position: [0, 0.325, 0] });
}

/** A fallen log lying on the ground, yawed by `angleDeg`, with one stub branch. */
export function log(b: SceneBuilder, look: SetLook, id: string, x: number, z: number, length: number, angleDeg: number): void {
  const yaw = (angleDeg * Math.PI) / 180;
  const r = 0.13;
  b.group(id, { position: [x, r, z], rotation: [0, yaw, 0] });
  b.material(`${id}__bark`, { color: v3.scale(look.trunk, 0.85), roughness: 0.92 })
    .mesh(`${id}__trunk`, { parent: id, geometry: { kind: "cylinder", radius: r, height: length, segments: 9 }, material: `${id}__bark`, rotation: [0, 0, Math.PI / 2] })
    .mesh(`${id}__branch`, { parent: id, geometry: { kind: "cylinder", radius: r * 0.35, height: 0.34, segments: 7 }, material: `${id}__bark`, position: [length * 0.22, 0.1, 0.06], rotation: [0.5, 0, 0.4] });
}

/** A still pond: a low water disc ringed by shore stones. */
export function pond(b: SceneBuilder, look: SetLook, id: string, x: number, z: number, radius: number): void {
  b.group(id, { position: [x, 0, z] });
  b.material(`${id}__water`, { color: look.water, roughness: 0.12 })
    .mesh(`${id}__surface`, { parent: id, geometry: { kind: "cylinder", radius, height: 0.024, segments: 22 }, material: `${id}__water`, position: [0, 0.012, 0] });
  const stones = Math.max(5, Math.min(9, Math.round(radius * 3.2)));
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2 + 0.35 * ((2 * i) % 3);
    b.rock(`${id}__shore${i}`, { parent: id, position: [Math.cos(a) * radius * 1.03, 0, Math.sin(a) * radius * 1.03], radius: 0.09 + 0.045 * ((2 * i) % 3), color: look.stone });
  }
}

/** A standing lantern: dark post, glowing head, and a warm pooled light — night staging. */
export function lantern(b: SceneBuilder, look: SetLook, id: string, x: number, z: number): void {
  b.group(id, { position: [x, 0, z] });
  b.material(`${id}__iron`, { color: [0.1, 0.1, 0.12], roughness: 0.6, metalness: 0.4 })
    .material(`${id}__glow`, { color: [1, 0.85, 0.5], emissive: [1.7, 1.15, 0.5], roughness: 1 })
    .mesh(`${id}__post`, { parent: id, geometry: { kind: "cylinder", radius: 0.03, height: 1.05, segments: 8 }, material: `${id}__iron`, position: [0, 0.525, 0] })
    .mesh(`${id}__cap`, { parent: id, geometry: { kind: "box", size: [0.19, 0.05, 0.19] }, material: `${id}__iron`, position: [0, 1.2, 0] })
    .mesh(`${id}__base`, { parent: id, geometry: { kind: "cylinder", radius: 0.09, height: 0.05, segments: 10 }, material: `${id}__iron`, position: [0, 0.025, 0] })
    .mesh(`${id}__flame`, { parent: id, geometry: { kind: "sphere", radius: 0.055, segments: 8 }, material: `${id}__glow`, position: [0, 1.1, 0] });
  b.light({ type: "point", intensity: 2.4, decay: 2, color: [1, 0.76, 0.42], position: [0, 1.1, 0], parent: id }, `${id}__light`);
}

/** A baked HTML surface on a wooden board between two posts (the trail-sign pattern). */
export async function sign(b: SceneBuilder, look: SetLook, id: string, x: number, z: number, art: string, angleDeg: number): Promise<void> {
  const tex = await loadSurface(art);
  const w = 1.5, h = (w * tex.height) / tex.width, postH = 0.85;
  b.group(id, { position: [x, 0, z], rotation: [0, (angleDeg * Math.PI) / 180, 0] });
  b.material(`${id}__post`, { color: v3.scale(look.trunk, 0.9), roughness: 0.9 });
  for (const [pid, px] of [["l", -w * 0.42], ["r", w * 0.42]] as const) {
    b.mesh(`${id}__post_${pid}`, { parent: id, geometry: { kind: "cylinder", radius: 0.05, height: postH + h * 0.75, segments: 8 }, material: `${id}__post`, position: [px, (postH + h * 0.75) / 2, 0] });
  }
  b.texturedQuad(`${id}__board`, { parent: id, texture: tex, width: w, height: h, back: true, position: [0, postH, 0.055] });
}

/**
 * An animated surface on a kiosk stand: the panel's texture is a baked HTML frame sequence
 * (surface type "anim") looped for the film's whole duration by a step-eased "texture.frame"
 * track — exact integer holds, no lerp drift. A soft point light in front keeps the panel
 * readable in night sets.
 */
export async function screen(b: SceneBuilder, look: SetLook, id: string, x: number, z: number, art: string, angleDeg: number, durationFrames: number, fps: number): Promise<void> {
  const seq = await loadSurfaceFrames(art);
  const w = 1.6, h = (w * seq.height) / seq.width, standH = 0.55;
  b.group(id, { position: [x, 0, z], rotation: [0, (angleDeg * Math.PI) / 180, 0] });
  b.material(`${id}__case`, { color: [0.16, 0.16, 0.19], roughness: 0.55, metalness: 0.35 });
  b.mesh(`${id}__frame`, { parent: id, geometry: { kind: "box", size: [w + 0.14, h + 0.14, 0.08] }, material: `${id}__case`, position: [0, standH + h / 2, 0] });
  for (const [pid, px] of [["l", -w * 0.3], ["r", w * 0.3]] as const) {
    b.mesh(`${id}__leg_${pid}`, { parent: id, geometry: { kind: "cylinder", radius: 0.04, height: standH, segments: 8 }, material: `${id}__case`, position: [px, standH / 2, 0] });
  }
  b.texturedQuad(`${id}__panel`, { parent: id, texture: seq.frames[0]!, frames: seq.frames, width: w, height: h, roughness: 0.35, position: [0, standH, 0.045] });
  const step = fps / seq.fps; // film frames per surface frame
  const keyframes = [];
  for (let i = 0; i * step <= durationFrames; i++) {
    keyframes.push({ frame: i * step, value: i % seq.frames.length, easing: "step" as const });
  }
  b.animate(`${id}__panel`, "texture.frame", keyframes);
  b.light({ type: "point", intensity: 1.1, decay: 2, color: [0.85, 0.88, 1], position: [0, standH + h / 2, 0.7], parent: id }, `${id}__glow`);
}

/** An extruded SVG silhouette — stage-scenery shapes, logos, cutout landmarks. */
export async function cutout(b: SceneBuilder, look: SetLook, id: string, x: number, z: number, art: string, height: number, depth: number, angleDeg: number): Promise<void> {
  const dir = fileURLToPath(new URL("../../assets/surfaces/", import.meta.url));
  const svg = await readFile(`${dir}${art}/source.svg`, "utf8");
  b.group(id, { position: [x, 0, z], rotation: [0, (angleDeg * Math.PI) / 180, 0] });
  svgToMesh(svg, { height, depth }).forEach((m, i) => {
    b.material(`${id}__c${i}`, { color: m.color as Vec3, roughness: 0.75 });
    b.mesh(`${id}__m${i}`, { parent: id, geometry: { kind: "mesh", data: { positions: m.positions, normals: m.normals, indices: m.indices } }, material: `${id}__c${i}` });
  });
}

/**
 * World scale per bundled model (they ship at hex-tile scale, ~1 unit per tile): a hut
 * becomes a ~2.2-unit cottage, a barrel ~0.6 units — sized against the ~1.5-unit cast.
 */
const MODEL_SCALE: Record<string, number> = {
  hut: 2.4, tavern: 2.2, windmill: 2.2, well: 1.6, tower: 1.6,
  barrel: 3, crate: 3, tent: 2.6, wheelbarrow: 3, sack: 3.5,
};

/** A bundled CC0 model (building or clutter) at (x, 0, z) — palette texture, white material. */
export async function model(b: SceneBuilder, id: string, name: string, x: number, z: number, angleDeg: number): Promise<void> {
  const md = await loadModel(name);
  const s = MODEL_SCALE[name] ?? 1;
  b.material(`${id}__palette`, { color: [1, 1, 1], roughness: 0.85 });
  b.mesh(id, {
    geometry: { kind: "mesh", data: md as never },
    material: `${id}__palette`,
    position: [x, 0, z],
    rotation: [0, (angleDeg * Math.PI) / 180, 0],
    scale: [s, s, s],
  });
}

/** The fan hub in windmill-body space (tower-top + fan node translations of the source glTF). */
const WINDMILL_FAN_PIVOT: Vec3 = [0, 0.957, 0.332];

/**
 * The windmill with TURNING blades: the bundled model is split (body + fan re-rooted at its
 * hub — scripts/bundle-medieval.mjs), so a linear rotation track spins the fan for the whole
 * film. One stately revolution every 8 seconds.
 */
export async function windmill(b: SceneBuilder, id: string, x: number, z: number, angleDeg: number, durationFrames: number, fps: number): Promise<void> {
  const [body, fan] = await Promise.all([loadModel("windmill"), loadModel("windmill-fan")]);
  const s = MODEL_SCALE.windmill!;
  b.group(id, { position: [x, 0, z], rotation: [0, (angleDeg * Math.PI) / 180, 0], scale: [s, s, s] });
  b.material(`${id}__palette`, { color: [1, 1, 1], roughness: 0.85 });
  b.mesh(`${id}__body`, { parent: id, geometry: { kind: "mesh", data: body as never }, material: `${id}__palette` });
  b.mesh(`${id}__fan`, { parent: id, geometry: { kind: "mesh", data: fan as never }, material: `${id}__palette`, position: WINDMILL_FAN_PIVOT });
  b.animate(`${id}__fan`, "rotation.z", [
    { frame: 0, value: 0 },
    { frame: Math.max(1, durationFrames), value: (2 * Math.PI * Math.max(1, durationFrames)) / (8 * fps) },
  ]);
}

/**
 * Ambient weather: one tuned, seeded particle system spanning the stage. Slow drifts use
 * zero gravity with a constant fall velocity (real gravity reads as hail); fireflies are
 * short-lived wanderers near the ground so they blink as they respawn.
 */
export function weather(b: SceneBuilder, kind: "snowfall" | "rain" | "fireflies" | "leaves"): void {
  const presets = {
    snowfall: { position: [0, 8, -3], spread: [14, 2, 10], count: 1100, velocity: [0.15, -0.55, 0], velocitySpread: [0.2, 0.15, 0.2], gravity: [0, 0, 0], lifeFrames: 460, size: 0.042, color: [0.99, 0.99, 1], opacity: 0.95 },
    rain: { position: [0, 9, -3], spread: [14, 1, 10], count: 1300, velocity: [0.4, -10.5, 0], velocitySpread: [0.3, 1.4, 0.3], gravity: [0, 0, 0], lifeFrames: 34, size: 0.013, color: [0.55, 0.62, 0.75], opacity: 0.3 },
    fireflies: { position: [0, 0.8, -2], spread: [9, 0.5, 7], count: 70, velocity: [0, 0.06, 0], velocitySpread: [0.28, 0.18, 0.28], gravity: [0, 0, 0], lifeFrames: 55, size: 0.02, color: [1, 0.88, 0.45], opacity: 0.95 },
    leaves: { position: [0, 6, -3], spread: [13, 1.5, 9], count: 220, velocity: [-0.5, -0.5, 0.1], velocitySpread: [0.4, 0.2, 0.3], gravity: [0, 0, 0], lifeFrames: 420, size: 0.045, color: [0.78, 0.5, 0.2], opacity: 0.95 },
  } as const;
  const p = presets[kind];
  b.particles("__weather", { ...p, position: [...p.position] as Vec3, spread: [...p.spread] as Vec3, velocity: [...p.velocity] as Vec3, velocitySpread: [...p.velocitySpread] as Vec3, gravity: [...p.gravity] as Vec3, color: [...p.color] as Vec3, loop: true, seed: 7,
    // Pre-warm one full lifetime: births stagger from startFrame, so starting at 0 would
    // leave the first ~lifeFrames with an empty lower sky (snow that hasn't fallen yet).
    startFrame: -p.lifeFrames });
}

/** Place ANY Film3DProp — the single dispatch the compiler (and tests) call. */
export async function placeProp(b: SceneBuilder, look: SetLook, p: Film3DProp, durationFrames: number, fps = 30): Promise<void> {
  switch (p.kind) {
    case "tree": b.tree(p.id, { position: [p.x, 0, p.z], height: p.height, variant: p.variant, trunkColor: look.trunk, leafColor: look.leaf }); return;
    case "rock": b.rock(p.id, { position: [p.x, 0, p.z], radius: p.radius, color: look.stone }); return;
    case "campfire": return campfire(b, p.id, p.x, p.z, durationFrames);
    case "bush": return bush(b, look, p.id, p.x, p.z, p.radius);
    case "flowers": return flowers(b, look, p.id, p.x, p.z, p.radius);
    case "stump": return stump(b, look, p.id, p.x, p.z, p.radius);
    case "log": return log(b, look, p.id, p.x, p.z, p.length, p.angle);
    case "pond": return pond(b, look, p.id, p.x, p.z, p.radius);
    case "lantern": return lantern(b, look, p.id, p.x, p.z);
    case "sign": return sign(b, look, p.id, p.x, p.z, p.art, p.angle);
    case "cutout": return cutout(b, look, p.id, p.x, p.z, p.art, p.height, p.depth, p.angle);
    case "screen": return screen(b, look, p.id, p.x, p.z, p.art, p.angle, durationFrames, fps);
    case "building": return p.variant === "windmill"
      ? windmill(b, p.id, p.x, p.z, p.angle, durationFrames, fps)
      : model(b, p.id, p.variant, p.x, p.z, p.angle);
    case "clutter": return model(b, p.id, p.variant, p.x, p.z, p.angle);
    default: { const exhaustive: never = p; throw new Error(`unhandled prop kind ${(exhaustive as Film3DProp).kind}`); }
  }
}
