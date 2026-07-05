// Example 25 — data-driven weather report: "video as a nightly build".
//
// A forecast payload (data.ts — swap in a real API feed) drives a template: one weather
// diorama per city, filmed as a cut sequence. Conditions are built from engine features —
// rain/snow are closed-form particles, each city's mood is a LOCAL inverse-square point
// light (decay 2), clouds are squashed spheres, and the numbers are vector-text overlays.
// Same payload → byte-identical MP4, so the nightly job is safe to publish unreviewed.
import { scene } from "@vsim/authoring";
import { FORECAST, type CityWeather } from "./data.js";

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

  // --- the diorama: platform + a small hashed skyline --------------------------------------
  b.mesh(`plat${i}`, { geometry: { kind: "cylinder", radius: 3.4, height: 0.16, segments: 40 }, material: "platform", position: [X, 0.08, 0] });
  for (let k = 0; k < 7; k++) {
    const bw = 0.45 + hash(w.city, k) * 0.4;
    const bh = 0.7 + hash(w.city, k + 10) * 1.9;
    const bx = X - 2.1 + k * 0.65 + (hash(w.city, k + 20) - 0.5) * 0.3;
    const bz = -1.1 - hash(w.city, k + 30) * 0.9;
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
  } else if (w.condition === "rain") {
    cloud(`cl${i}a`, "cloud_dark", -0.7, 2.7, 0, 1.15); cloud(`cl${i}b`, "cloud_dark", 0.5, 2.9, -0.3, 0.95); cloud(`cl${i}c`, "cloud_dark", 0.1, 2.55, 0.35, 0.8);
    b.particles(`rain${i}`, {
      position: [X - 0.1, 2.4, 0], spread: [1.3, 0.15, 0.8], count: 340,
      velocity: [0.3, -7.5, 0], velocitySpread: [0.15, 0.8, 0.15], gravity: [0, -2.5, 0],
      lifeFrames: 16, size: 0.012, color: [0.45, 0.55, 0.85], opacity: 0.55, seed: 3 + i,
    }).light({ type: "point", intensity: 2.2, decay: 2, color: [0.5, 0.58, 0.8], position: [X, 2.4, 1.2] });
  } else if (w.condition === "snow") {
    cloud(`cl${i}a`, "cloud_snow", -0.6, 2.75, 0, 1.1); cloud(`cl${i}b`, "cloud_snow", 0.55, 2.9, -0.25, 0.9);
    b.particles(`snow${i}`, {
      position: [X, 2.5, 0], spread: [1.6, 0.2, 1.2], count: 150,
      velocity: [0.12, -0.85, 0], velocitySpread: [0.3, 0.2, 0.3], gravity: [0, -0.12, 0],
      lifeFrames: 85, size: 0.035, color: [0.95, 0.96, 1], opacity: 0.95, seed: 5 + i,
    }).light({ type: "point", intensity: 2.6, decay: 2, color: [0.75, 0.8, 1], position: [X, 2.6, 1.1] });
  } else {
    cloud(`cl${i}a`, "cloud_soft", -0.8, 2.7, 0.1, 1.2); cloud(`cl${i}b`, "cloud_soft", 0.45, 2.85, -0.3, 1.0); cloud(`cl${i}c`, "cloud_soft", 1.2, 2.6, 0.3, 0.75);
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
