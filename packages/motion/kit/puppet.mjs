// Pip — a cutout mouse puppet: SVG groups pivoted at the joints, every motion a cue-ready
// function of 0..1. The character-kit counterpart to kit.mjs: blink/mouth/wave/bob/tail are
// composable applies, so a film gives Pip life with a handful of Timeline cues and drives
// the mouth straight from a narration envelope (see tools/narrate.mjs).
import { fmt } from "../src/timeline.mjs";
import { h } from "./kit.mjs";

// Pip's palette (character colors are part of his design; scene chrome still uses tokens)
const FUR = "#5B6270", FUR_DARK = "#474D59", INNER = "#F0A9B8", MUZZLE = "#E8DFD3",
  SHORTS = "#5B8CFF", NOSE = "#2A2E38", EYE_WHITE = "#FFFFFF", PUPIL = "#23262E";

/**
 * Build Pip standing at (x, y) = feet center, `size` ≈ total height in viewBox units.
 * Returns { el } plus cue-ready applies:
 *   blink(v)  0 open → 1 closed              mouth(v) 0 closed → 1 wide open (envelope!)
 *   wave(v)   right arm wave cycle            bob(v)   idle body bounce cycle
 *   tail(v)   tail sway cycle                 look(v) −1 left → +1 right (pupils)
 *   headTilt(v) −1..+1 gentle head tilt
 */
export function pip({ x = 0, y = 0, size = 220 } = {}) {
  const s = size / 220; // author at 220 tall, scale to request

  // --- tail (behind everything), pivot at the hip -------------------------------------------
  const tailG = h("g", { transform: "rotate(0)" });
  tailG.append(h("path", {
    d: "M 0 0 C -34 6 -44 -18 -36 -34 C -31 -44 -20 -44 -18 -36 C -16 -28 -26 -26 -28 -33",
    fill: "none", stroke: FUR_DARK, "stroke-width": 7, "stroke-linecap": "round",
  }));
  const tailPivot = h("g", { transform: `translate(-26 -52)` }, [tailG]);

  // --- body ----------------------------------------------------------------------------------
  const body = h("g", {}, [
    h("ellipse", { cx: 0, cy: -62, rx: 40, ry: 46, fill: FUR }),
    // shorts
    h("path", { d: "M -38 -52 A 40 46 0 0 0 38 -52 L 34 -18 L 10 -18 L 6 -34 L -6 -34 L -10 -18 L -34 -18 Z", fill: SHORTS }),
    // feet
    h("ellipse", { cx: -16, cy: -7, rx: 14, ry: 8, fill: "#C98A5B" }),
    h("ellipse", { cx: 16, cy: -7, rx: 14, ry: 8, fill: "#C98A5B" }),
    // left arm (resting)
    h("path", { d: "M -34 -78 C -52 -70 -56 -56 -50 -46", fill: "none", stroke: FUR, "stroke-width": 11, "stroke-linecap": "round" }),
    h("circle", { cx: -50, cy: -45, r: 7, fill: EYE_WHITE }),
  ]);

  // --- right arm, pivot at the shoulder (authored HANGING; wave() rotates it up) --------------
  const armG = h("g", {}, [
    h("path", { d: "M 0 0 C 12 10 16 22 14 32", fill: "none", stroke: FUR, "stroke-width": 11, "stroke-linecap": "round" }),
    h("circle", { cx: 14, cy: 34, r: 7, fill: EYE_WHITE }),
  ]);
  const armPivot = h("g", { transform: "translate(34 -80)" }, [armG]);

  // --- head group, pivot at the neck ---------------------------------------------------------
  const pupilL = h("circle", { cx: -14, cy: -6, r: 4.4, fill: PUPIL });
  const pupilR = h("circle", { cx: 14, cy: -6, r: 4.4, fill: PUPIL });
  const eyeL = h("g", {}, [h("ellipse", { cx: -14, cy: -6, rx: 9, ry: 11, fill: EYE_WHITE }), pupilL]);
  const eyeR = h("g", {}, [h("ellipse", { cx: 14, cy: -6, rx: 9, ry: 11, fill: EYE_WHITE }), pupilR]);
  const lidL = h("rect", { x: -24, y: -18, width: 20, height: 0, rx: 4, fill: FUR });
  const lidR = h("rect", { x: 4, y: -18, width: 20, height: 0, rx: 4, fill: FUR });
  // mouth: jaw ellipse whose openness the envelope drives, over a resting smile
  const smile = h("path", { d: "M -8 16 Q 0 21 8 16", fill: "none", stroke: NOSE, "stroke-width": 2.2, "stroke-linecap": "round" });
  const jaw = h("ellipse", { cx: 0, cy: 18, rx: 6, ry: 0.8, fill: NOSE, opacity: 0 });

  const headG = h("g", {}, [
    // ears (behind the head circle)
    h("circle", { cx: -34, cy: -34, r: 21, fill: FUR }),
    h("circle", { cx: 34, cy: -34, r: 21, fill: FUR }),
    h("circle", { cx: -34, cy: -34, r: 12, fill: INNER }),
    h("circle", { cx: 34, cy: -34, r: 12, fill: INNER }),
    h("circle", { cx: 0, cy: 0, r: 40, fill: FUR }),
    // muzzle + nose + whiskers
    h("ellipse", { cx: 0, cy: 14, rx: 20, ry: 14, fill: MUZZLE }),
    h("circle", { cx: 0, cy: 8, r: 4.5, fill: NOSE }),
    h("path", { d: "M 18 10 L 34 6 M 18 14 L 35 14", stroke: FUR_DARK, "stroke-width": 1.2, "stroke-linecap": "round" }),
    h("path", { d: "M -18 10 L -34 6 M -18 14 L -35 14", stroke: FUR_DARK, "stroke-width": 1.2, "stroke-linecap": "round" }),
    smile, jaw, eyeL, eyeR, lidL, lidR,
    // brows
    h("path", { d: "M -21 -20 Q -14 -24 -7 -21", fill: "none", stroke: FUR_DARK, "stroke-width": 2.4, "stroke-linecap": "round" }),
    h("path", { d: "M 7 -21 Q 14 -24 21 -20", fill: "none", stroke: FUR_DARK, "stroke-width": 2.4, "stroke-linecap": "round" }),
  ]);
  const headPivot = h("g", { transform: "translate(0 -118)" }, [headG]);

  // --- assembly: bob group wraps everything so idle bounce moves the whole puppet -------------
  const bobG = h("g", {}, [tailPivot, body, armPivot, headPivot]);
  const el = h("g", { transform: `translate(${fmt(x)} ${fmt(y)}) scale(${fmt(s)})` }, [bobG]);

  // --- cue-ready applies ----------------------------------------------------------------------
  const blink = (/** @type {number} */ v) => {
    const hgt = 22 * Math.min(Math.max(v, 0), 1);
    lidL.setAttribute("height", fmt(hgt));
    lidR.setAttribute("height", fmt(hgt));
  };
  const mouth = (/** @type {number} */ v) => {
    const o = Math.min(Math.max(v, 0), 1);
    jaw.setAttribute("ry", fmt(0.8 + o * 9));
    jaw.setAttribute("rx", fmt(6 + o * 3));
    jaw.setAttribute("opacity", fmt(o < 0.06 ? 0 : 1));
    smile.setAttribute("opacity", fmt(o < 0.06 ? 1 : 0));
  };
  const wave = (/** @type {number} */ v) => {
    // v 0..1 = one full wave cycle: raise the hanging arm ~155°, two shakes, lower
    const raise = Math.min(v * 4, 1) * Math.min(Math.max((1 - v) * 6, 0), 1);
    const shake = Math.sin(v * Math.PI * 5) * 18;
    // cap ≈ −136°: past that the hand disappears behind the head (draw order)
    armG.setAttribute("transform", `rotate(${fmt(-(raise * 118) - shake * raise)})`);
  };
  const bob = (/** @type {number} */ v) =>
    bobG.setAttribute("transform", `translate(0 ${fmt(Math.sin(v * Math.PI * 2) * 3)})`);
  const tail = (/** @type {number} */ v) =>
    tailG.setAttribute("transform", `rotate(${fmt(Math.sin(v * Math.PI * 2) * 14)})`);
  const look = (/** @type {number} */ v) => {
    const dx = Math.min(Math.max(v, -1), 1) * 3.5;
    pupilL.setAttribute("cx", fmt(-14 + dx));
    pupilR.setAttribute("cx", fmt(14 + dx));
  };
  const headTilt = (/** @type {number} */ v) =>
    headG.setAttribute("transform", `rotate(${fmt(Math.min(Math.max(v, -1), 1) * 7)})`);

  return { el, blink, mouth, wave, bob, tail, look, headTilt };
}

/**
 * Deterministic periodic blink helper: returns an apply for a full-length cue that closes
 * the lids for ~5 frames every `every` frames (offset de-syncs multiple characters).
 * @param {(v: number) => void} blinkFn
 * @param {{every?: number, offset?: number}} [opts]
 */
export function autoBlink(blinkFn, { every = 78, offset = 0 } = {}) {
  return (/** @type {number} */ _v, /** @type {number} */ f) => {
    const t = (f + offset) % every;
    blinkFn(t < 3 ? t / 3 : t < 6 ? (6 - t) / 3 : 0);
  };
}
