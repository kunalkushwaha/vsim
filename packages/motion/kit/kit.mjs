// Explainer kit v1 — twelve token-styled SVG primitives for technical films.
//
// Every factory builds plain SVG DOM (styled ONLY through tokens.css custom properties) and
// returns { el, ...applies } where the applies are cue-ready functions of a 0..1 value —
// plug them straight into Timeline cues. No randomness, no wall clock, no getTotalLength:
// connectors carry their own arc-length math, so everything is deterministic and node-testable.
import { fmt } from "../src/timeline.mjs";

const NS = "http://www.w3.org/2000/svg";

/**
 * Create an SVG element. @param {string} tag @param {Record<string, string|number>} [attrs]
 * @param {Array<Element|string>} [children]
 */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

const T = (/** @type {string} */ name) => `var(--color-${name})`;

// ---------------------------------------------------------------------------------------------
// Boxes with faces: browser, server, database, queue, cloud
// ---------------------------------------------------------------------------------------------

/** Browser window chrome; put scene content inside `.content`. */
export function browserWindow({ x = 0, y = 0, w = 220, h: hh = 150, url = "example.com" } = {}) {
  const content = h("g", { class: "content", transform: `translate(${x + 8} ${y + 34})` });
  const urlText = h("text", { x: x + 34, y: y + 21, "font-size": 9, fill: T("muted"), "font-family": "var(--font)" }, [url]);
  const el = h("g", {}, [
    h("rect", { x, y, width: w, height: hh, rx: 8, fill: T("panel"), stroke: T("line"), "stroke-width": 1 }),
    h("circle", { cx: x + 12, cy: y + 14, r: 3, fill: T("hot") }),
    h("circle", { cx: x + 22, cy: y + 14, r: 3, fill: T("warn") }),
    h("circle", { cx: x + 32, cy: y + 14, r: 3, fill: T("ok") }),
    h("rect", { x: x + 42, y: y + 8, width: w - 50, height: 12, rx: 6, fill: T("panel2") }),
    urlText,
    h("line", { x1: x, y1: y + 28, x2: x + w, y2: y + 28, stroke: T("line"), "stroke-width": 1 }),
    content,
  ]);
  /** Typing effect for the URL: v 0..1 reveals characters. */
  const typeUrl = (/** @type {number} */ v) => {
    urlText.textContent = url.slice(0, Math.round(v * url.length));
  };
  return { el, content, typeUrl };
}

/** Server rack unit with a status LED. states: ok | busy | err */
export function server({ x = 0, y = 0, label = "server" } = {}) {
  const led = h("circle", { cx: x + 14, cy: y + 16, r: 4, fill: T("muted") });
  const inner = h("g", {}, [
    h("rect", { x, y, width: 84, height: 64, rx: 8, fill: T("panel"), stroke: T("line"), "stroke-width": 1 }),
    h("rect", { x: x + 8, y: y + 28, width: 68, height: 6, rx: 3, fill: T("panel2") }),
    h("rect", { x: x + 8, y: y + 40, width: 68, height: 6, rx: 3, fill: T("panel2") }),
    led,
    h("text", { x: x + 42, y: y + 60, "text-anchor": "middle", "font-size": 10, fill: T("muted"), "font-family": "var(--font)" }, [label]),
  ]);
  const el = h("g", {}, [inner]);
  const setState = (/** @type {"ok"|"busy"|"err"|"idle"} */ s) =>
    led.setAttribute("fill", s === "ok" ? T("ok") : s === "busy" ? T("warn") : s === "err" ? T("hot") : T("muted"));
  /** Busy pulse: run v 0..1 looped; scales LED. */
  const pulse = (/** @type {number} */ v) => led.setAttribute("r", fmt(4 + Math.sin(v * Math.PI) * 1.6));
  /** Error shake: v 0..1, damped horizontal judder on the whole unit. */
  const shake = (/** @type {number} */ v) =>
    inner.setAttribute("transform", `translate(${fmt(Math.sin(v * Math.PI * 6) * (1 - v) * 4)} 0)`);
  return { el, setState, pulse, shake };
}

/** Database: the classic cylinder stack; `flash(v)` highlights a query. */
export function database({ x = 0, y = 0, label = "db" } = {}) {
  const ring = h("ellipse", { cx: x + 30, cy: y + 10, rx: 30, ry: 10, fill: "none", stroke: T("accent2"), "stroke-width": 2, opacity: 0 });
  const el = h("g", {}, [
    h("path", { d: `M ${x} ${y + 10} v 40 a 30 10 0 0 0 60 0 v -40`, fill: T("panel"), stroke: T("line"), "stroke-width": 1 }),
    h("ellipse", { cx: x + 30, cy: y + 30, rx: 30, ry: 10, fill: "none", stroke: T("line"), "stroke-width": 1 }),
    h("ellipse", { cx: x + 30, cy: y + 10, rx: 30, ry: 10, fill: T("panel2"), stroke: T("line"), "stroke-width": 1 }),
    ring,
    h("text", { x: x + 30, y: y + 72, "text-anchor": "middle", "font-size": 10, fill: T("muted"), "font-family": "var(--font)" }, [label]),
  ]);
  const flash = (/** @type {number} */ v) => ring.setAttribute("opacity", fmt(Math.sin(Math.min(Math.max(v, 0), 1) * Math.PI)));
  return { el, flash };
}

/** Message queue: a rail of slots; `fill(v)` occupies them left→right. */
export function queue({ x = 0, y = 0, slots = 5, label = "queue" } = {}) {
  const cells = Array.from({ length: slots }, (_, i) =>
    h("rect", { x: x + 6 + i * 18, y: y + 6, width: 14, height: 20, rx: 3, fill: T("panel2") }),
  );
  const el = h("g", {}, [
    h("rect", { x, y, width: slots * 18 + 10, height: 32, rx: 6, fill: T("panel"), stroke: T("line"), "stroke-width": 1 }),
    ...cells,
    h("text", { x: x + (slots * 18 + 10) / 2, y: y + 46, "text-anchor": "middle", "font-size": 10, fill: T("muted"), "font-family": "var(--font)" }, [label]),
  ]);
  const fill = (/** @type {number} */ v) => {
    const n = Math.round(v * slots);
    cells.forEach((c, i) => c.setAttribute("fill", i < n ? T("accent") : T("panel2")));
  };
  return { el, fill };
}

/** Cloud boundary — groups things "on the internet". */
export function cloudBox({ x = 0, y = 0, w = 200, h: hh = 120, label = "cloud" } = {}) {
  const el = h("g", {}, [
    h("rect", { x, y, width: w, height: hh, rx: 18, fill: "none", stroke: T("line"), "stroke-width": 1.5, "stroke-dasharray": "6 5" }),
    h("ellipse", { cx: x + 30, cy: y, rx: 18, ry: 10, fill: T("paper"), stroke: T("line"), "stroke-width": 1.5 }),
    h("text", { x: x + 30, y: y + 3.5, "text-anchor": "middle", "font-size": 10, fill: T("muted"), "font-family": "var(--font)" }, [label]),
  ]);
  return { el };
}

// ---------------------------------------------------------------------------------------------
// Connectors: arc-length math in pure JS → packet flows + draw-on arrows, no getTotalLength
// ---------------------------------------------------------------------------------------------

/**
 * Polyline/quadratic connector with its own arc-length table.
 * `via` bends the line through a control point (sampled at 48 fixed steps — deterministic).
 * @param {{from: [number,number], to: [number,number], via?: [number,number]}} opts
 */
export function connector({ from, to, via }) {
  /** @type {[number,number][]} */
  const pts = [];
  if (via) {
    for (let i = 0; i <= 48; i++) {
      const t = i / 48, u = 1 - t;
      pts.push([u * u * from[0] + 2 * u * t * via[0] + t * t * to[0], u * u * from[1] + 2 * u * t * via[1] + t * t * to[1]]);
    }
  } else {
    pts.push(from, to);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  const length = cum[cum.length - 1];
  /** Position at normalized arc length t∈[0,1]. @param {number} t @returns {[number,number]} */
  const posAt = (t) => {
    const d = Math.min(Math.max(t, 0), 1) * length;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const k = (d - cum[i - 1]) / seg;
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    return [ax + (bx - ax) * k, ay + (by - ay) * k];
  };
  const d = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"} ${fmt(px)} ${fmt(py)}`).join(" ");
  const el = h("path", { d, fill: "none", stroke: T("line"), "stroke-width": 1.5 });
  return { el, posAt, length, d };
}

/** Packets traveling along a connector: `flow(v)` moves `count` dots (v loops 0..1). */
export function packetFlow(conn, { count = 3, r = 3.5, color = "accent" } = {}) {
  const dots = Array.from({ length: count }, () => h("circle", { r, fill: T(color), opacity: 0 }));
  const el = h("g", {}, dots);
  const flow = (/** @type {number} */ v) => {
    dots.forEach((dot, i) => {
      const t = v - i * (0.65 / count);
      if (t <= 0 || t > 1) {
        dot.setAttribute("opacity", "0");
        return;
      }
      const [px, py] = conn.posAt(t);
      dot.setAttribute("cx", fmt(px));
      dot.setAttribute("cy", fmt(py));
      dot.setAttribute("opacity", fmt(Math.min(1, 6 * Math.min(t, 1 - t))));
    });
  };
  return { el, flow };
}

/** Arrow that draws itself on: `draw(v)` reveals the stroke, head pops at the end. */
export function drawArrow(connOpts, { color = "accent2" } = {}) {
  const conn = connector(connOpts);
  conn.el.setAttribute("stroke", T(color));
  conn.el.setAttribute("stroke-width", "2");
  conn.el.setAttribute("stroke-dasharray", fmt(conn.length));
  conn.el.setAttribute("stroke-dashoffset", fmt(conn.length));
  const [hx, hy] = conn.posAt(1);
  const [px, py] = conn.posAt(0.96);
  const ang = (Math.atan2(hy - py, hx - px) * 180) / Math.PI;
  const head = h("path", { d: "M 0 -4 L 8 0 L 0 4 Z", fill: T(color), transform: `translate(${fmt(hx)} ${fmt(hy)}) rotate(${fmt(ang)})`, opacity: 0 });
  const el = h("g", {}, [conn.el, head]);
  const draw = (/** @type {number} */ v) => {
    conn.el.setAttribute("stroke-dashoffset", fmt(conn.length * (1 - v)));
    head.setAttribute("opacity", v >= 0.98 ? "1" : "0");
  };
  return { el, draw, conn };
}

// ---------------------------------------------------------------------------------------------
// Panels: code block, callout, step chip, bar chart, kinetic title
// ---------------------------------------------------------------------------------------------

/** Code block with typing + line highlight. `type(v)` reveals chars; `highlight(i)` marks a line. */
export function codeBlock({ x = 0, y = 0, w = 240, lines = ["GET / HTTP/1.1"] } = {}) {
  const lineH = 16, pad = 12;
  const hh = pad * 2 + lines.length * lineH;
  const hl = h("rect", { x: x + 3, y: 0, width: w - 6, height: lineH, rx: 3, fill: T("panel2"), opacity: 0 });
  const texts = lines.map((s, i) =>
    h("text", { x: x + pad, y: y + pad + i * lineH + 11, "font-size": 11, fill: T("ink"), "font-family": "ui-monospace, monospace", "xml:space": "preserve" }, [""]),
  );
  const el = h("g", {}, [
    h("rect", { x, y, width: w, height: hh, rx: 8, fill: T("paper"), stroke: T("line"), "stroke-width": 1 }),
    hl,
    ...texts,
  ]);
  const total = lines.reduce((n, s) => n + s.length, 0);
  const type = (/** @type {number} */ v) => {
    let budget = Math.round(v * total);
    lines.forEach((s, i) => {
      const take = Math.min(s.length, Math.max(0, budget));
      texts[i].textContent = s.slice(0, take);
      budget -= s.length;
    });
  };
  const highlight = (/** @type {number} */ i) => {
    hl.setAttribute("opacity", i < 0 ? "0" : "1");
    if (i >= 0) hl.setAttribute("y", String(y + pad + i * lineH));
  };
  return { el, type, highlight };
}

/** Callout pill with a leader line; `pop(v)` scales it in (pair with ease "overshoot"). */
export function callout({ x = 0, y = 0, text = "", anchor = /** @type {[number,number]} */ ([0, 0]) } = {}) {
  const wEst = text.length * 6.6 + 20;
  const pill = h("g", { transform: `translate(${x} ${y}) scale(0)` }, [
    h("rect", { x: -wEst / 2, y: -12, width: wEst, height: 24, rx: 12, fill: T("accent"), opacity: 0.95 }),
    h("text", { x: 0, y: 4, "text-anchor": "middle", "font-size": 11, fill: T("paper"), "font-family": "var(--font)" }, [text]),
  ]);
  const leader = h("line", { x1: anchor[0], y1: anchor[1], x2: x, y2: y, stroke: T("accent"), "stroke-width": 1, opacity: 0 });
  const el = h("g", {}, [leader, pill]);
  const pop = (/** @type {number} */ v) => {
    pill.setAttribute("transform", `translate(${x} ${y}) scale(${fmt(Math.max(v, 0))})`);
    leader.setAttribute("opacity", fmt(Math.min(Math.max(v, 0), 1) * 0.6));
  };
  return { el, pop };
}

/** Numbered step chip; `activate(v)` lights it up. */
export function stepChip({ x = 0, y = 0, n = 1, text = "" } = {}) {
  const badge = h("circle", { cx: x + 12, cy: y + 12, r: 10, fill: T("panel2"), stroke: T("line"), "stroke-width": 1 });
  const num = h("text", { x: x + 12, y: y + 16, "text-anchor": "middle", "font-size": 11, fill: T("muted"), "font-family": "var(--font)" }, [String(n)]);
  const el = h("g", {}, [
    badge, num,
    h("text", { x: x + 28, y: y + 16, "font-size": 12, fill: T("muted"), "font-family": "var(--font)", class: "chip-label" }, [text]),
  ]);
  const activate = (/** @type {number} */ v) => {
    const on = v >= 0.5;
    badge.setAttribute("fill", on ? T("accent") : T("panel2"));
    num.setAttribute("fill", on ? T("paper") : T("muted"));
    /** @type {Element} */ (el.querySelector(".chip-label")).setAttribute("fill", on ? T("ink") : T("muted"));
  };
  return { el, activate };
}

/** Bar chart: `grow(v)` raises all bars to v of their value. */
export function barChart({ x = 0, y = 0, w = 180, h: hh = 100, values = [0.4, 0.7, 0.55, 0.9] } = {}) {
  const bw = w / values.length - 8;
  const bars = values.map((val, i) =>
    h("rect", { x: x + 4 + i * (bw + 8), y: y + hh, width: bw, height: 0, rx: 3, fill: i === values.length - 1 ? T("accent2") : T("accent") }),
  );
  const el = h("g", {}, [
    h("line", { x1: x, y1: y + hh, x2: x + w, y2: y + hh, stroke: T("line"), "stroke-width": 1 }),
    h("line", { x1: x, y1: y + hh / 2, x2: x + w, y2: y + hh / 2, stroke: T("line"), "stroke-width": 0.5, opacity: 0.5 }),
    ...bars,
  ]);
  const grow = (/** @type {number} */ v) =>
    bars.forEach((b, i) => {
      const bh = values[i] * hh * Math.min(Math.max(v, 0), 1);
      b.setAttribute("height", fmt(bh));
      b.setAttribute("y", fmt(y + hh - bh));
    });
  return { el, grow };
}

/** Kinetic title: words rise in one by one. `reveal(v)` with ease "snappy". */
export function title({ x = 0, y = 0, text = "", size = 28, color = "ink" } = {}) {
  const words = text.split(" ");
  let cx = 0;
  const parts = words.map((wd) => {
    // textLength pins each word to an exact advance — layout is deterministic across fonts.
    const wLen = wd.length * size * 0.55;
    const t = h("text", {
      x: x + cx, y, "font-size": size, fill: T(color), "font-family": "var(--font)",
      textLength: fmt(wLen), lengthAdjust: "spacingAndGlyphs", opacity: 0,
    }, [wd]);
    cx += wLen + size * 0.38;
    return t;
  });
  const el = h("g", {}, parts);
  const reveal = (/** @type {number} */ v) =>
    parts.forEach((t, i) => {
      const p = Math.min(Math.max(v * words.length - i, 0), 1);
      t.setAttribute("opacity", fmt(p));
      t.setAttribute("transform", `translate(0 ${fmt((1 - p) * size * 0.5)})`);
    });
  return { el, reveal };
}
