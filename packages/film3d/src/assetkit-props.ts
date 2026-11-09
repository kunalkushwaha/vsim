// Pure layout helpers for assetkit props, shared by the schema (validation) and sets.ts
// (placement) so the validator checks exactly what the compiler builds. 1 film unit = 1 metre.
import { ASSETKIT_MODELS } from "./assetkit.js";

/** The ±14-unit stage every Film3D world coordinate lives on. */
export const STAGE_HALF = 14;
/** Most models one flower patch may hold (each instance copies a 40–50k-triangle mesh). */
export const MAX_PATCH_MODELS = 9;
/** Most flower models one film may hold across all patches (~2M triangles). */
export const MAX_FILM_FLOWER_MODELS = 36;

/** World-space XZ half-extents of a model rotated by `angleDeg` (yaw) at `scale`. */
export function footprintHalf(name: string, angleDeg: number, scale: number): [number, number] {
  const m = ASSETKIT_MODELS[name];
  if (!m) throw new Error(`unknown assetkit model "${name}"`);
  const [w, , d] = m.size_m;
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return [((w * c + d * s) / 2) * scale, ((w * s + d * c) / 2) * scale];
}

/**
 * Golden-angle layout of a real-flower patch: count grows with area / footprint², capped at
 * MAX_PATCH_MODELS; positions are relative to the patch centre and stay inside `radius`.
 * Deterministic: a pure function of (variant, radius, scale).
 */
export function flowerPatch(variant: string, radius: number, scale: number): { x: number; z: number; yaw: number; s: number }[] {
  const m = ASSETKIT_MODELS[variant];
  if (!m) throw new Error(`unknown assetkit flower "${variant}"`);
  const foot = Math.max(m.size_m[0], m.size_m[2]) * scale;
  const n = Math.max(1, Math.min(MAX_PATCH_MODELS, Math.round((Math.PI * radius * radius) / (foot * foot * 1.6))));
  // Keep each flower's footprint — at its largest jittered size (×1.1) — inside the patch disc.
  const r = Math.max(0, radius - (foot * 1.1) / 2);
  return Array.from({ length: n }, (_, i) => {
    const a = i * 2.39996323;
    const rr = n === 1 ? 0 : r * Math.sqrt((i + 0.5) / n);
    return { x: Math.cos(a) * rr, z: Math.sin(a) * rr, yaw: (i * 137.5) % 360, s: scale * (0.9 + 0.2 * ((i * 7) % 5) / 4) };
  });
}
