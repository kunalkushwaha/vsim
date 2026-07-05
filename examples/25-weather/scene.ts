// Example 25 — data-driven weather report: "video as a nightly build".
//
// A forecast payload (data.ts — swap in a real API feed) drives a template: one weather
// diorama per city, filmed as a cut sequence. Conditions are built from engine features —
// rain/snow are closed-form particles, each city's mood is a LOCAL inverse-square point
// light (decay 2), clouds are squashed spheres, and the numbers are vector-text overlays.
// Same payload → byte-identical MP4, so the nightly job is safe to publish unreviewed.
import { fileURLToPath } from "node:url";
import { scene } from "@vsim/authoring";
import { FORECAST, type CityWeather } from "./data.js";
import { loadLandmark } from "./landmarks.js";
import { findBackdropImage, loadImageBackdrop } from "./backdrop.js";

// Broadcast typography: swap the bundled DejaVu for Bebas Neue (Google Fonts, OFL — see
// ./fonts/OFL-BebasNeue.txt). Exporting `fontPath` makes the CLI feed this TTF to the
// deterministic vector rasterizer (same pattern as `audioPath`); any TTF/OTF works, and
// the font bytes live in the repo → renders stay byte-identical.
export const fontPath = fileURLToPath(new URL("./fonts/BebasNeue-Regular.ttf", import.meta.url));

// Each city's landmark: an SVG base artifact (see ./landmarks/*.svg) triangulated into
// upright stage-scenery meshes. name → svg file; height → world-unit scale.
const LANDMARKS: Record<string, { name: string; height: number; bldg: number }> = {
  TOKYO: { name: "tokyo", height: 3.4, bldg: 0 }, // Fuji + Skytree + Tokyo Tower — SVG has its own skyline
  LONDON: { name: "london", height: 3.0, bldg: 0.55 }, // Tower Bridge — wide; keep buildings low
  DENVER: { name: "denver", height: 2.9, bldg: 0.75 }, // the Front Range
  MUMBAI: { name: "mumbai", height: 2.5, bldg: 0.6 }, // Gateway of India
};

const SEG = 75; // frames per city
const DUR = SEG * FORECAST.length;
const GAP = 16; // world-x spacing between dioramas

// Deterministic per-string hash for skyline variation (no Math.random in scenes).
const hash = (s: string, n: number) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= n * 2654435761;
  return ((h >>> 0) % 1000) / 1000;
};

const b = scene({ fps: 30, duration: DUR, width: 960, height: 540, tone: "aces", background: [0.09, 0.11, 0.18] })
  .sky([0.1, 0.13, 0.24], [0.24, 0.24, 0.34], { ambient: 0.25 }) // neutral studio dusk
  .light({ type: "hemisphere", intensity: 0.5, skyColor: [0.5, 0.55, 0.75], groundColor: [0.16, 0.15, 0.18] })
  .light({ type: "directional", intensity: 0.35, color: [0.8, 0.82, 0.95], direction: [-0.4, -1, -0.55] })
  .material("platform", { color: [0.16, 0.18, 0.24], roughness: 0.7 })
  .material("bldg", { color: [0.2, 0.23, 0.32], roughness: 0.85 })
  .material("bldg_lit", { color: [0.24, 0.26, 0.34], emissive: [0.25, 0.2, 0.08], roughness: 0.85 })
  .material("cloud_dark", { color: [0.21, 0.22, 0.27], roughness: 1 })
  .material("cloud_snow", { color: [0.55, 0.56, 0.62], roughness: 1 })
  .material("cloud_soft", { color: [0.45, 0.46, 0.52], roughness: 1 })
  .material("sunball", { color: [1, 0.75, 0.3], emissive: [1.7, 1.1, 0.35], roughness: 1 });

FORECAST.forEach((w: CityWeather, i: number) => {
  const X = i * GAP;
  const s = i * SEG, e = (i + 1) * SEG - 1;

  // --- the diorama: platform + the SVG landmark + a low hashed skyline ----------------------
  b.mesh(`plat${i}`, { geometry: { kind: "cylinder", radius: 3.4, height: 0.16, segments: 40 }, material: "platform", position: [X, 0.08, 0] });

  // The landmark, standing center-stage behind the skyline. An image drop-in
  // (landmarks/<city>.jpg — e.g. a real illustration) becomes a textured backdrop card;
  // otherwise the committed SVG is triangulated into flat silhouette meshes.
  const lm = LANDMARKS[w.city]!;
  const img = findBackdropImage(lm.name);
  if (img) {
    const card = loadImageBackdrop(img, lm.height);
    b.material(`lmimg${i}`, { color: [1, 1, 1], roughness: 0.95 });
    b.mesh(`lmk${i}`, {
      geometry: { kind: "mesh", data: card as never },
      material: `lmimg${i}`,
      position: [X, 0.16, -1.9],
    });
  } else {
    loadLandmark(lm.name, lm.height).forEach((piece, p) => {
      const matId = `lm${i}_${p}`;
      b.material(matId, { color: piece.color, roughness: 0.85 });
      b.mesh(`lmk${i}_${p}`, {
        geometry: { kind: "mesh", data: { positions: piece.positions, normals: piece.normals, indices: piece.indices } },
        material: matId,
        position: [X, 0.16, -1.9],
      });
    });
  }

  // Low buildings flank the landmark instead of hiding it (scaled per landmark width;
  // 0 = the illustration carries its own skyline).
  for (let k = 0; k < (lm.bldg ? 6 : 0); k++) {
    const bw = (0.4 + hash(w.city, k) * 0.35) * lm.bldg;
    const bh = (0.4 + hash(w.city, k + 10) * 0.85) * lm.bldg;
    const side = k < 3 ? -1 : 1;
    const bx = X + side * (1.9 + (k % 3) * 0.55) + (hash(w.city, k + 20) - 0.5) * 0.3;
    const bz = -0.7 - hash(w.city, k + 30) * 0.8;
    b.mesh(`bldg${i}_${k}`, {
      geometry: { kind: "box", size: [bw, bh, bw] },
      material: k % 3 === 1 ? "bldg_lit" : "bldg",
      position: [bx, 0.16 + bh / 2, bz],
      rotation: [0, hash(w.city, k + 40) * 0.4, 0],
    });
  }

  // --- condition: local light + props + particles -------------------------------------------
  const cloud = (id: string, mat: string, x: number, y: number, z: number, sc: number) =>
    b.mesh(id, { geometry: { kind: "sphere", radius: 0.55, segments: 12 }, material: mat, position: [X + x, y, z], scale: [sc * 1.6, sc * 0.75, sc] });

  if (w.condition === "clear") {
    b.mesh(`sun${i}`, { geometry: { kind: "sphere", radius: 0.34, segments: 16 }, material: "sunball", position: [X - 1.7, 2.7, -0.4] })
      .light({ type: "point", intensity: 11, decay: 2, color: [1, 0.72, 0.38], position: [X - 1.5, 2.4, 0.7] });
    // Sakura in bloom (the Tokyo reference: a cherry tree by the tower) + base greenery.
    const sakura = (id: string, sx: number, sz: number, s: number) =>
      b.mesh(`${id}_t`, { geometry: { kind: "cylinder", radius: 0.05 * s, height: 0.55 * s, segments: 8 }, material: "bark", position: [X + sx, 0.16 + 0.27 * s, sz] })
        .mesh(`${id}_c1`, { geometry: { kind: "sphere", radius: 0.34 * s, segments: 12 }, material: "blossom", position: [X + sx, 0.16 + 0.68 * s, sz], scale: [1.25, 0.85, 1.1] })
        .mesh(`${id}_c2`, { geometry: { kind: "sphere", radius: 0.24 * s, segments: 12 }, material: "blossom_lt", position: [X + sx + 0.2 * s, 0.16 + 0.82 * s, sz - 0.06 * s], scale: [1.1, 0.8, 1] })
        .mesh(`${id}_c3`, { geometry: { kind: "sphere", radius: 0.2 * s, segments: 12 }, material: "blossom", position: [X + sx - 0.24 * s, 0.16 + 0.58 * s, sz + 0.08 * s] });
    b.material("blossom", { color: [0.85, 0.42, 0.52], roughness: 0.9 })
      .material("blossom_lt", { color: [0.92, 0.55, 0.62], roughness: 0.9 })
      .material("bark", { color: [0.26, 0.17, 0.12], roughness: 0.9 })
      .material("bush", { color: [0.09, 0.2, 0.11], roughness: 0.95 });
    sakura(`sak${i}a`, 2.2, 0.7, 1.15);
    sakura(`sak${i}b`, -2.4, 0.3, 0.85);
    b.mesh(`bush${i}a`, { geometry: { kind: "sphere", radius: 0.3, segments: 10 }, material: "bush", position: [X + 0.7, 0.28, -0.9], scale: [1.5, 0.7, 1.2] })
      .mesh(`bush${i}b`, { geometry: { kind: "sphere", radius: 0.26, segments: 10 }, material: "bush", position: [X - 0.8, 0.26, -1], scale: [1.4, 0.65, 1] });
  } else if (w.condition === "rain") {
    cloud(`cl${i}a`, "cloud_dark", -0.8, 3.15, 0, 0.95); cloud(`cl${i}b`, "cloud_dark", 0.45, 3.3, -0.3, 0.8); cloud(`cl${i}c`, "cloud_dark", 0, 3.05, 0.35, 0.68);
    b.particles(`rain${i}`, {
      position: [X - 0.1, 2.9, 0], spread: [1.3, 0.15, 0.8], count: 340,
      velocity: [0.3, -7.5, 0], velocitySpread: [0.15, 0.8, 0.15], gravity: [0, -2.5, 0],
      lifeFrames: 16, size: 0.012, color: [0.45, 0.55, 0.85], opacity: 0.55, seed: 3 + i,
    }).light({ type: "point", intensity: 2.2, decay: 2, color: [0.5, 0.58, 0.8], position: [X, 2.4, 1.2] });
  } else if (w.condition === "snow") {
    cloud(`cl${i}a`, "cloud_snow", -0.6, 3.2, 0, 0.95); cloud(`cl${i}b`, "cloud_snow", 0.55, 3.35, -0.25, 0.8);
    b.particles(`snow${i}`, {
      position: [X, 3.0, 0], spread: [1.6, 0.2, 1.2], count: 150,
      velocity: [0.12, -0.85, 0], velocitySpread: [0.3, 0.2, 0.3], gravity: [0, -0.12, 0],
      lifeFrames: 85, size: 0.035, color: [0.95, 0.96, 1], opacity: 0.95, seed: 5 + i,
    }).light({ type: "point", intensity: 2.6, decay: 2, color: [0.75, 0.8, 1], position: [X, 2.6, 1.1] });
  } else {
    cloud(`cl${i}a`, "cloud_soft", -0.9, 3.1, 0.1, 1.0); cloud(`cl${i}b`, "cloud_soft", 0.45, 3.25, -0.3, 0.85); cloud(`cl${i}c`, "cloud_soft", 1.25, 3.0, 0.3, 0.65);
    b.light({ type: "point", intensity: 2.4, decay: 2, color: [0.75, 0.75, 0.82], position: [X + 0.3, 2.6, 1.3] });
  }

  // --- camera: slow push-in on this diorama, cut via shots ----------------------------------
  b.addCamera(`cam${i}`, { position: [X + 2.4, 1.9, 6.4], lookAt: [X, 1.35, 0], fov: 42 })
    .animate(`__cam_cam${i}`, "position.z", [
      { frame: s, value: 6.4 }, { frame: e, value: 5.5, easing: "easeInOut" },
    ])
    .shot(`cam${i}`, s, e);

  // --- overlays: the data, typeset -----------------------------------------------------------
  const deg = (n: number) => `${n}°`;
  const fadeIn = 8, hold = e - fadeIn;
  const seg = (id: string) => b.animateOverlay(id, "opacity", [
    { frame: s, value: 0 },
    { frame: s + fadeIn, value: 1, easing: "easeOut" },
    { frame: hold, value: 1 },
    { frame: e, value: 0, easing: "easeIn" },
  ]);
  b.text(`name${i}`, w.city, { x: 0.075, y: 0.83, size: 46, align: "left", opacity: 0, box: { color: [0.04, 0.05, 0.1], opacity: 0.72, padding: 18 } });
  seg(`name${i}`);
  b.text(`temp${i}`, deg(w.temp), { x: 0.855, y: 0.3, size: 148, align: "center", opacity: 0 });
  seg(`temp${i}`);
  b.text(`cond${i}`, `${w.condition.toUpperCase()}  H ${deg(w.hi)} / L ${deg(w.lo)}  WIND ${w.wind} KM/H`, {
    x: 0.075, y: 0.915, size: 25, align: "left", color: [0.75, 0.8, 0.95], opacity: 0,
  });
  seg(`cond${i}`);
});

// Program branding: a persistent strap + an opening card over the first city.
b.text("strap", "EVENING FORECAST", { x: 0.925, y: 0.93, size: 24, align: "right", color: [0.55, 0.62, 0.85] })
  .title("open", "EVENING FORECAST", { startFrame: 0, endFrame: 34, size: 84, fade: 10 });

export default b.build();
