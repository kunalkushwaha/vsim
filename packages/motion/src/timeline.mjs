// A frame-pure seekable timeline: the determinism contract of the whole studio.
//
// seek(frame) fully re-evaluates EVERY cue from the frame index alone — no play-head state,
// no deltas, no wall clock. Seeking 0→50→10→50 lands pixel-identically on both 50s, which is
// exactly what the frame-step recorder (and golden-frame tests) require. Interactive "play"
// is just the host calling seek(f) from rAF; the recorder calls it frame by frame.
import { ease } from "./ease.mjs";

/**
 * @typedef {Object} Cue
 * @property {number} start   first frame of the tween
 * @property {number} end     last frame (value holds at `to` after it)
 * @property {number} [from]  start value (default 0)
 * @property {number} [to]    end value (default 1)
 * @property {string} [ease]  preset name (default "floaty")
 * @property {(v: number, frame: number) => void} apply  writes the value somewhere idempotent
 */

export class Timeline {
  /** @param {number} fps */
  constructor(fps = 30) {
    this.fps = fps;
    /** @type {Array<Required<Pick<Cue,"start"|"end"|"from"|"to"|"apply">> & {fn:(p:number)=>number}>} */
    this.cues = [];
    this.length = 0;
  }

  /** Register a cue. Returns `this` for chaining. @param {Cue} c */
  cue(c) {
    if (!(c.end > c.start)) throw new Error(`cue end (${c.end}) must be > start (${c.start})`);
    this.cues.push({ start: c.start, end: c.end, from: c.from ?? 0, to: c.to ?? 1, apply: c.apply, fn: ease(c.ease ?? "floaty") });
    this.length = Math.max(this.length, c.end);
    return this;
  }

  /**
   * Evaluate every cue at `frame` (pure function of the frame index) and invoke its apply.
   * @param {number} frame
   */
  seek(frame) {
    for (const c of this.cues) {
      const p = frame <= c.start ? 0 : frame >= c.end ? 1 : (frame - c.start) / (c.end - c.start);
      c.apply(c.from + (c.to - c.from) * c.fn(p), frame);
    }
  }

  /** Seconds → frames at this timeline's fps (rounded — cues sit on whole frames). @param {number} s */
  sec(s) {
    return Math.round(s * this.fps);
  }
}

/** Deterministic number formatting for DOM attributes (kills float print noise). @param {number} v */
export const fmt = (v) => (Object.is(v, -0) ? "0" : String(Math.round(v * 1000) / 1000));

/**
 * Apply-factory: set a numeric attribute. `attr(el, "cy")` → (v) => el.setAttribute("cy", fmt(v))
 * @param {{setAttribute(n: string, val: string): void}} el
 * @param {string} name
 */
export const attr = (el, name) => (/** @type {number} */ v) => el.setAttribute(name, fmt(v));

/**
 * Apply-factory: style property with unit/template. `style(el, "opacity")`, `style(el, "width", "%")`.
 * @param {{style: Record<string, string>}} el @param {string} prop @param {string} [unit]
 */
export const style = (el, prop, unit = "") => (/** @type {number} */ v) => { el.style[prop] = `${fmt(v)}${unit}`; };

/**
 * Apply-factory: translate transform. `xy(el, 10, (v)=>[v, 0])` — mapper turns the cue value
 * into [x, y] so one cue can drive curved motion.
 * @param {{setAttribute(n: string, val: string): void}} el
 * @param {(v: number) => [number, number]} map
 */
export const translate = (el, map) => (/** @type {number} */ v) => {
  const [x, y] = map(v);
  el.setAttribute("transform", `translate(${fmt(x)} ${fmt(y)})`);
};
