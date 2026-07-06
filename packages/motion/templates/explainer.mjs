// The explainer template: FilmDoc (data) → a running film. This is the ONLY place cue
// wiring happens for generated films, so the hard-won discipline lives here once:
//   · piecewiseCue/stateCue — exactly one owner per animated property, per entity
//   · opacity, flow, state, camera can never fight, no matter what the document says
// The AI writes the document; this interprets it; the recorder/player drive seek(f).
import { Timeline, piecewiseCue, stateCue, fmt, createPlayer } from "../src/index.mjs";
import * as K from "../kit/kit.mjs";

/**
 * Build a film from a validated FilmDoc into `stage` (an <svg>) + `capEl` (caption div).
 * Returns the window.__film contract { fps, frames, seek }.
 */
export function buildFilm(doc, stage, capEl) {
  const FPS = doc.fps;
  const S = (sec) => Math.round(sec * FPS);
  const FRAMES = S(doc.beats[doc.beats.length - 1].end);
  const tl = new Timeline(FPS);

  // ---------------------------------------------------------------- stage: entities from kit
  const ents = new Map(); // id → { spec, obj }
  const conns = new Map(); // connector id → { fwd, rev }
  for (const e of doc.stage) {
    let obj;
    if (e.kind === "title") obj = K.title({ x: e.x, y: e.y, text: e.text, size: e.size, color: e.color });
    else if (e.kind === "server") obj = K.server(e);
    else if (e.kind === "database") obj = K.database(e);
    else if (e.kind === "queue") obj = K.queue(e);
    else if (e.kind === "browser") obj = K.browserWindow(e);
    else if (e.kind === "cloud") obj = K.cloudBox(e);
    else if (e.kind === "chart") obj = K.barChart(e);
    else if (e.kind === "code") obj = K.codeBlock(e);
    else if (e.kind === "callout") obj = K.callout(e);
    else if (e.kind === "connector") {
      obj = K.connector(e);
      if (e.dashed) obj.el.setAttribute("stroke-dasharray", "3 4");
      conns.set(e.id, { fwd: obj, rev: K.connector({ from: e.to, to: e.from, via: e.via }) });
    } else if (e.kind === "packets") {
      obj = null; // resolved in the second pass, once all connectors exist
    }
    ents.set(e.id, { spec: e, obj });
  }
  // second pass: packets (their connector now surely exists — the schema guarantees the ref)
  for (const ent of ents.values()) {
    if (ent.spec.kind !== "packets") continue;
    const c = conns.get(ent.spec.along);
    ent.obj = K.packetFlow(ent.spec.reverse ? c.rev : c.fwd, { count: ent.spec.count, color: ent.spec.color });
  }
  // mount: connectors under boxes, packets + labels above
  const zOrder = { connector: 0, cloud: 1, browser: 2, server: 2, database: 2, queue: 2, chart: 2, packets: 3, code: 4, callout: 5, title: 6 };
  for (const { spec, obj } of [...ents.values()].sort((a, b) => zOrder[a.spec.kind] - zOrder[b.spec.kind])) {
    stage.append(obj.el);
  }

  // ---------------------------------------------------------------- reset FIRST
  // seek(f) applies cues in registration order — the reset restores every stateful default
  // before any owner cue speaks (the cue-discipline rule, owned by the template).
  // an entity starts hidden only if its FIRST opacity-channel action makes it appear
  const firstOpacity = new Map();
  for (const b of doc.beats) for (const a of b.actions) {
    if (["fadeIn", "fadeOut", "pop", "unpop"].includes(a.do) && !firstOpacity.has(a.target)) firstOpacity.set(a.target, a.do);
  }
  const startsHidden = new Set([...firstOpacity].filter(([, d]) => d === "fadeIn").map(([t]) => t));
  tl.cue({ start: 0, end: FRAMES, ease: "hold", apply: () => {
    for (const { spec, obj } of ents.values()) {
      if (spec.kind === "callout") obj.pop(0);
      else if (startsHidden.has(spec.id)) obj.el.setAttribute("opacity", "0");
      if (spec.kind === "code") { obj.type(0); obj.highlight(-1); }
      if (spec.kind === "title") obj.reveal(0);
      if (spec.kind === "browser") obj.typeUrl(0);
      if (spec.kind === "chart") obj.grow(0);
    }
  } });

  // ---------------------------------------------------------------- captions (karaoke)
  const beats = doc.beats.map((b) => ({ ...b, s: S(b.start), e: S(b.end) }));
  let capBeat = -1;
  tl.cue({ start: 0, end: FRAMES, ease: "hold", apply: (_, f) => {
    const i = beats.findIndex((b) => f >= b.s && f < b.e);
    const bi = i === -1 ? beats.length - 1 : i;
    if (bi !== capBeat) {
      capBeat = bi;
      capEl.innerHTML = beats[bi].caption.split(" ").map((w) => `<span>${w}</span>`).join(" ");
    }
    const b = beats[bi];
    const p = Math.min((f - b.s) / ((b.e - b.s) * 0.55), 1);
    [...capEl.children].forEach((w, wi, all) => w.classList.toggle("lit", wi < p * all.length));
  } });

  // ---------------------------------------------------------------- actions → one owner per channel
  // ids are schema-constrained to [a-zA-Z][\w-]* so "::" can never collide.
  const chanOf = { fadeIn: "opacity", fadeOut: "opacity", pop: "opacity", unpop: "opacity" };
  const groups = new Map();
  for (const b of beats) {
    for (const a of b.actions) {
      const key = `${a.target}::${chanOf[a.do] ?? a.do}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ f0: b.s + S(a.at), f1: b.s + S(a.at) + Math.max(S(a.dur), 1), a });
    }
  }

  for (const [key, list] of groups) {
    const [id, chan] = key.split("::");
    const { spec, obj } = ents.get(id);
    list.sort((x, y) => x.f0 - y.f0);

    if (chan === "opacity") {
      // visible-by-default entities whose first move is a fadeOut start at 1
      let prev = list[0].a.do === "fadeOut" || list[0].a.do === "unpop" ? 1 : 0;
      const segs = list.map(({ f0, f1, a }) => {
        const s = { f0, f1, from: prev, to: a.do === "fadeIn" || a.do === "pop" ? 1 : 0, ease: a.do === "pop" ? "overshoot" : "snappy" };
        prev = s.to;
        return s;
      });
      const apply = spec.kind === "callout"
        ? (v) => obj.pop(v)
        : (v) => obj.el.setAttribute("opacity", fmt(Math.min(Math.max(v, 0), 1)));
      piecewiseCue(tl, apply, segs);
    } else if (chan === "state") {
      stateCue(tl, (v) => obj.setState(v), [{ f: 0, value: "idle" }, ...list.map(({ f0, a }) => ({ f: f0, value: String(a.value ?? "ok") }))]);
    } else if (chan === "highlight") {
      stateCue(tl, (v) => obj.highlight(v), [{ f: 0, value: -1 }, ...list.map(({ f0, a }) => ({ f: f0, value: Number(a.value ?? 0) }))]);
    } else if (chan === "fill") {
      let prev = 0;
      const segs = list.map(({ f0, f1, a }) => {
        const s = { f0, f1, from: prev, to: Math.min(Math.max(Number(a.value ?? 1), 0), 1), ease: "floaty" };
        prev = s.to;
        return s;
      });
      piecewiseCue(tl, (v) => obj.fill(v), segs);
    } else {
      // progress/cyclic channels; `value` = repeat cycles for the cyclic ones
      const segs = list.map(({ f0, f1, a }) => ({ f0, f1, from: 0, to: Math.max(Number(a.value ?? 1) || 1, 1), ease: "mechanical" }));
      const cyc = (fn) => (v) => fn(v > 0 && v % 1 === 0 ? 1 : v % 1); // integer end = rest pose
      const applyFns = {
        flow: cyc((p) => obj.flow(p)),
        pulse: cyc((p) => obj.pulse(p)),
        shake: cyc((p) => obj.shake(p)),
        flash: cyc((p) => obj.flash(p)),
        type: (v) => obj.type(Math.min(v, 1)),
        typeUrl: (v) => obj.typeUrl(Math.min(v, 1)),
        reveal: (v) => obj.reveal(Math.min(v, 1)),
        grow: (v) => obj.grow(Math.min(v, 1)),
      };
      piecewiseCue(tl, applyFns[chan] ?? (() => {}), segs);
    }
  }

  // ---------------------------------------------------------------- camera (one owner)
  if (doc.camera.length) {
    const cams = [...doc.camera].sort((a, b) => a.at - b.at);
    const segs = cams.map((c, i) => ({ f0: S(c.at), f1: S(c.at) + S(c.dur), from: i, to: i + 1, ease: "heavy" }));
    const views = [[0, 0, 1280, 600], ...cams.map((c) => c.view)];
    piecewiseCue(tl, (v) => {
      const i = Math.min(Math.floor(v), views.length - 2);
      const p = Math.min(Math.max(v - i, 0), 1);
      const a = views[i], b = views[i + 1];
      stage.setAttribute("viewBox", a.map((x, k) => fmt(x + (b[k] - x) * p)).join(" "));
    }, segs);
  }

  return { fps: FPS, frames: FRAMES, seek: (f) => tl.seek(f) };
}

/** Boot a film page: mount, expose window.__film, park on ?f= or start wall-clock playback. */
export function bootFilm(doc, { stageId = "stage", captionId = "caption" } = {}) {
  const stage = document.getElementById(stageId);
  const capEl = document.getElementById(captionId);
  const film = buildFilm(doc, stage, capEl);
  window.__film = film;
  const parked = new URLSearchParams(location.search).get("f");
  film.seek(Math.max(0, Math.min(film.frames, Number(parked) || 0)));
  if (!window.__recording && parked === null) createPlayer(film, { loop: true });
  return film;
}
