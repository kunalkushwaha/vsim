// Named ease presets — the ONLY timing the library exports. No linear tween: the fastest
// way to make generated animation look hand-made is to make considered timing the default.
// All functions are pure and deterministic: f(0) = 0, f(1) = 1.

/**
 * Cubic-bezier easing (CSS semantics: P0=(0,0), P3=(1,1), control points x1,y1,x2,y2).
 * Newton–Raphson with bisection fallback — fixed iteration counts keep it deterministic.
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @returns {(p: number) => number}
 */
export function cubicBezier(x1, y1, x2, y2) {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sampleX = (/** @type {number} */ t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (/** @type {number} */ t) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (/** @type {number} */ t) => (3 * ax * t + 2 * bx) * t + cx;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) {
      const x = sampleX(t) - p;
      const d = sampleDX(t);
      if (Math.abs(x) < 1e-7) return sampleY(t);
      if (Math.abs(d) < 1e-7) break;
      t -= x / d;
    }
    let lo = 0, hi = 1;
    t = p;
    for (let i = 0; i < 24; i++) {
      const x = sampleX(t);
      if (Math.abs(x - p) < 1e-7) break;
      if (x < p) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

/** Back-out overshoot: shoots past 1 (~+10%) and settles. @param {number} p */
function overshootFn(p) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const c1 = 1.70158, c3 = c1 + 1;
  const q = p - 1;
  return 1 + c3 * q * q * q + c1 * q * q;
}

/** @type {Record<string, (p: number) => number>} */
export const EASES = {
  /** Crisp start, clean settle — UI moves, pops, cuts. */
  snappy: cubicBezier(0.3, 0.9, 0.35, 1),
  /** Gentle both ends — drifting clouds, breathing, ambience. */
  floaty: cubicBezier(0.37, 0, 0.63, 1),
  /** Big inertia: slow to move, arrives with weight. */
  heavy: cubicBezier(0.65, 0, 0.25, 1),
  /** Near-constant speed with softened corners — conveyor belts, packets, scans. */
  mechanical: cubicBezier(0.25, 0.1, 0.75, 0.9),
  /** Springs past the target and settles — playful emphasis. */
  overshoot: overshootFn,
  /** Instant switch at the end — state flips, cuts. */
  hold: (p) => (p >= 1 ? 1 : 0),
};

/** @typedef {keyof typeof EASES} EaseName */

/**
 * @param {string} name
 * @returns {(p: number) => number}
 */
export function ease(name) {
  const f = EASES[name];
  if (!f) throw new Error(`unknown ease "${name}" — use one of: ${Object.keys(EASES).join(", ")}`);
  return f;
}
