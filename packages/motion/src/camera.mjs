// The camera IS the viewBox: pans, zooms, and push-ins are one cue tweening four numbers.
// Agents reason about "[x y w h] → [x y w h]" trivially, and because it's a Timeline cue it
// inherits frame-purity for free.
import { fmt } from "./timeline.mjs";

/**
 * Register a camera move on a timeline.
 * @param {import("./timeline.mjs").Timeline} tl
 * @param {{setAttribute(n: string, v: string): void}} svg  the root <svg>
 * @param {{start: number, end: number, from: [number,number,number,number], to: [number,number,number,number], ease?: string}} opts
 */
export function cameraCue(tl, svg, opts) {
  const { from, to } = opts;
  tl.cue({
    start: opts.start,
    end: opts.end,
    ease: opts.ease ?? "heavy",
    apply: (v) => {
      const box = from.map((f, i) => f + ((to[i] ?? f) - f) * v);
      svg.setAttribute("viewBox", box.map(fmt).join(" "));
    },
  });
}
