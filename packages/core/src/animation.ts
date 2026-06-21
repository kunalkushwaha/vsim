import type { Keyframe, Track } from "./document.js";

/**
 * Evaluate keyframe tracks at a given frame. Pure & deterministic. Convention: a keyframe's
 * `easing` shapes the segment ARRIVING at it (the transition from the previous keyframe).
 * Values may be scalars or vectors; vectors interpolate component-wise.
 */

type Bezier = [number, number, number, number];

function applyEasing(easing: Keyframe["easing"], t: number): number {
  if (Array.isArray(easing)) return cubicBezier(easing, t);
  switch (easing) {
    case "linear": return t;
    case "easeIn": return t * t;
    case "easeOut": return t * (2 - t);
    case "easeInOut": return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    case "step": return t >= 1 ? 1 : 0;
    default: return t;
  }
}

/** CSS-style cubic-bezier(x1,y1,x2,y2): solve x(s)=t via Newton/bisection, return y(s). */
function cubicBezier([x1, y1, x2, y2]: Bezier, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = (s: number) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  const cy = (s: number) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  let lo = 0, hi = 1, s = t;
  for (let i = 0; i < 24; i++) {
    const x = cx(s);
    if (Math.abs(x - t) < 1e-6) break;
    if (x < t) lo = s; else hi = s;
    s = (lo + hi) / 2;
  }
  return cy(s);
}

function lerpValue(a: number | number[], b: number | number[], t: number): number | number[] {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * t;
  const av = a as number[], bv = b as number[];
  return av.map((x, i) => x + ((bv[i] ?? x) - x) * t);
}

/** Value of a track at `frame` (clamped to the first/last keyframe outside the range). */
export function evaluateTrack(track: Track, frame: number): number | number[] {
  const kfs = track.keyframes;
  const first = kfs[0]!;
  const last = kfs[kfs.length - 1]!;
  if (frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;

  let k0 = first, k1 = last;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (frame >= kfs[i]!.frame && frame < kfs[i + 1]!.frame) {
      k0 = kfs[i]!;
      k1 = kfs[i + 1]!;
      break;
    }
  }
  const span = k1.frame - k0.frame;
  const raw = span === 0 ? 0 : (frame - k0.frame) / span;
  const t = applyEasing(k1.easing, raw); // easing belongs to the arriving keyframe
  return lerpValue(k0.value, k1.value, t);
}

export const _internal = { applyEasing, cubicBezier };
