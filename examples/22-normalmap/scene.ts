// Example 22 — PBR normal mapping: two identical brick walls under a raking light.
//
// Both walls are the SAME flat two-triangle quad with the same albedo texture; the right one
// also carries a procedurally generated tangent-space normal map, so the renderer's per-pixel
// lighting shades brick bevels and mortar grooves that don't exist in the geometry. Maps are
// generated deterministically in code — no assets, no randomness.
import { scene } from "@vsim/authoring";

const W = 256, H = 256;

// Brick height field: 4 rows of bricks with staggered joints; mortar grooves are low.
function height(u: number, v: number): number {
  const rows = 4, cols = 2;
  const y = v * rows;
  const row = Math.floor(y);
  const x = u * cols + (row % 2) * 0.5;
  const fy = y - row, fx = x - Math.floor(x);
  const mortar = 0.07;
  const edge = (f: number) => Math.min(f, 1 - f) / mortar;
  return Math.min(1, Math.min(edge(fx), edge(fy))); // 0 in grooves → 1 on brick face
}

function makeMaps() {
  const albedo = new Uint8Array(W * H * 4);
  const normal = new Uint8Array(W * H * 4);
  const eps = 1 / W;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const h = height(u, v);
      const p = (y * W + x) * 4;
      // Albedo: brick red on faces, grey mortar in grooves (plus a subtle per-brick tint shift).
      const brickTint = 0.85 + 0.15 * Math.sin(Math.floor(v * 4) * 12.9 + Math.floor(u * 2 + (Math.floor(v * 4) % 2) * 0.5) * 7.7);
      const t = h > 0.5 ? 1 : 0;
      albedo[p] = t ? 168 * brickTint : 150;
      albedo[p + 1] = t ? 74 * brickTint : 146;
      albedo[p + 2] = t ? 58 * brickTint : 140;
      albedo[p + 3] = 255;
      // Normal from the height gradient (tangent space, +Z out of the wall).
      const scale = 2.2;
      const dhdu = (height(u + eps, v) - height(u - eps, v)) / (2 * eps);
      const dhdv = (height(u, v + eps) - height(u, v - eps)) / (2 * eps);
      const nx = -dhdu * scale, ny = -dhdv * scale, nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      normal[p] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      normal[p + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      normal[p + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      normal[p + 3] = 255;
    }
  }
  return {
    albedo: { width: W, height: H, data: albedo },
    normal: { width: W, height: H, data: normal },
  };
}

const maps = makeMaps();
const wall = (withNormal: boolean) => ({
  positions: [-1.1, 2.2, 0, 1.1, 2.2, 0, 1.1, 0, 0, -1.1, 0, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  uvs: [0, 0, 1, 0, 1, 1, 0, 1],
  indices: [0, 1, 2, 0, 2, 3],
  texture: maps.albedo,
  ...(withNormal ? { normalMap: maps.normal } : {}),
});

export default scene({ fps: 30, duration: 90, width: 960, height: 540, background: [0.09, 0.1, 0.13] })
  .material("wall", { color: [1, 1, 1], roughness: 0.85 })
  .material("floor", { color: [0.22, 0.22, 0.25], roughness: 0.9 })
  .light({ type: "ambient", intensity: 0.16 })
  // Raking light from the left — grazing angles make bump relief pop.
  .light({ type: "directional", intensity: 1.25, color: [1, 0.92, 0.8], direction: [0.85, -0.35, -0.4] })
  .mesh("ground", { geometry: { kind: "plane", size: [30, 30] }, material: "floor" })
  .mesh("wallFlat", { geometry: { kind: "mesh", data: wall(false) as any }, material: "wall", position: [-1.25, 0, 0] })
  .mesh("wallBump", { geometry: { kind: "mesh", data: wall(true) as any }, material: "wall", position: [1.25, 0, 0] })
  // Slowly swivel both walls through the raking light: the bump-mapped wall's brick relief
  // visibly shifts with the grazing angle while the flat wall stays flat — same geometry.
  .animate("wallFlat", "rotation.y", [
    { frame: 0, value: -0.28 },
    { frame: 45, value: 0.28, easing: "easeInOut" },
    { frame: 90, value: -0.28, easing: "easeInOut" },
  ])
  .animate("wallBump", "rotation.y", [
    { frame: 0, value: -0.28 },
    { frame: 45, value: 0.28, easing: "easeInOut" },
    { frame: 90, value: -0.28, easing: "easeInOut" },
  ])
  .camera({ position: [0, 1.35, 4.4], lookAt: [0, 1.05, 0], fov: 42 })
  .build();
