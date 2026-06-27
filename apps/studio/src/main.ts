// vsim Studio — a minimal browser editor on top of the deterministic engine. Loads a scene, drives
// the real @vsim/player against a canvas, lets you scrub the timeline, select objects, edit their
// transform/material live, and KEYFRAME those properties (M4) — set a value at one frame, another at
// a later frame, and it animates. Edits mutate the scene document; the runtime reads it every frame,
// so preview == render and `vsim render` exports exactly what you see.
import { Player } from "@vsim/player";
import type { SceneDocument } from "@vsim/core";
import { sampleScene } from "./sample-scene.js";

const doc: SceneDocument = sampleScene();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const totalFrames = doc.meta.durationFrames;

const canvas = $<HTMLCanvasElement>("preview");
canvas.width = doc.meta.width;
canvas.height = doc.meta.height;
const player = new Player(doc, { canvas, loop: true });

// ---------- transport ----------
const playBtn = $<HTMLButtonElement>("play");
const scrub = $<HTMLInputElement>("scrub");
const frameLbl = $<HTMLSpanElement>("frame");
scrub.max = String(totalFrames - 1);
const stop = () => { if (player.isPlaying) { player.pause(); playBtn.textContent = "▶"; } };
playBtn.onclick = () => { player.toggle(); playBtn.textContent = player.isPlaying ? "⏸" : "▶"; };
scrub.oninput = () => { stop(); void player.seek(Number(scrub.value)); };
player.onFrame = (f, total) => { scrub.value = String(f); frameLbl.textContent = `${f} / ${total - 1}`; refreshValues(f); };

// ---------- keyframe model (the document's animation tracks) ----------
type KF = { frame: number; value: number | number[]; easing?: string };
type Track = { target: { nodeId?: string; materialId?: string; path: string }; keyframes: KF[] };
const anim = doc.animation as unknown as Track[];
const sameTarget = (a: Track["target"], b: Track["target"]) =>
  a.nodeId === b.nodeId && a.materialId === b.materialId && a.path === b.path;
const findTrack = (t: Track["target"]) => anim.find((x) => sameTarget(x.target, t));
function ensureTrack(t: Track["target"]): Track {
  let tr = findTrack(t);
  if (!tr) { tr = { target: t, keyframes: [] }; anim.push(tr); }
  return tr;
}
function upsertKey(tr: Track, frame: number, value: number[]) {
  const k = tr.keyframes.find((k) => k.frame === frame);
  if (k) k.value = value.slice(); else tr.keyframes.push({ frame, value: value.slice(), easing: "linear" });
  tr.keyframes.sort((a, b) => a.frame - b.frame);
}
function evalVec(tr: Track, frame: number): number[] {
  const ks = tr.keyframes;
  if (!ks.length) return [0, 0, 0];
  const v = (i: number) => ks[i]!.value as number[];
  if (frame <= ks[0]!.frame) return v(0).slice();
  if (frame >= ks[ks.length - 1]!.frame) return v(ks.length - 1).slice();
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i]!, b = ks[i + 1]!;
    if (frame >= a.frame && frame <= b.frame) {
      const u = (frame - a.frame) / (b.frame - a.frame);
      const av = a.value as number[], bv = b.value as number[];
      return [0, 1, 2].map((j) => av[j]! + (bv[j]! - av[j]!) * u);
    }
  }
  return v(0).slice();
}

// ---------- scene tree ----------
let selected: string | null = null;
const tree = $("tree");
const hidden = (n: any) => n.id.startsWith("__");
const kindOf = (n: any) => (n.light ? n.light.type : n.mesh ? n.mesh.geometry.kind : "group");
function buildTree() {
  tree.innerHTML = "";
  for (const n of doc.nodes as any[]) {
    if (hidden(n)) continue;
    const row = document.createElement("div");
    row.className = "row" + (n.parent ? " child" : "") + (n.id === selected ? " sel" : "");
    row.innerHTML = `<span>${n.id}</span><span class="kind">${kindOf(n)}</span>`;
    row.onclick = () => select(n.id);
    tree.appendChild(row);
  }
}

// ---------- inspector + keyframing ----------
const inspector = $("inspector");
const kfstrip = $("kfstrip");
const repaint = () => void player.seek(player.currentFrame); // re-present current frame with the mutated doc
const round = (x: number) => Math.round(x * 1000) / 1000;
const rad2deg = (r: number) => round((r * 180) / Math.PI);
const deg2rad = (d: number) => (d * Math.PI) / 180;
const hex2 = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, "0");
const toHex = (c: number[]) => `#${hex2(c[0]!)}${hex2(c[1]!)}${hex2(c[2]!)}`;
const fromHex = (h: string): number[] =>
  [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/** Animated fields whose inputs should follow the playhead (refreshed on every frame). */
let refs: { inputs: HTMLInputElement[]; kind: "vec" | "color"; fmt: (x: number) => number; track: () => Track | undefined }[] = [];

const select = (id: string) => { selected = id; buildTree(); buildInspector(); };

function buildInspector() {
  inspector.innerHTML = "";
  refs = [];
  const n: any = doc.nodes.find((x: any) => x.id === selected);
  if (!n) { inspector.innerHTML = '<p class="empty">Select an object.</p>'; renderStrip(); return; }
  const h = document.createElement("h3"); h.textContent = n.id; inspector.appendChild(h);
  vecRow("position", { nodeId: n.id, path: "position" }, () => n.position, (i, v) => (n.position[i] = v));
  vecRow("rotation°", { nodeId: n.id, path: "rotation" }, () => n.rotation, (i, v) => (n.rotation[i] = v), rad2deg, deg2rad);
  vecRow("scale", { nodeId: n.id, path: "scale" }, () => n.scale, (i, v) => (n.scale[i] = v));
  const matId: string | undefined = n.mesh?.materialId;
  if (matId) colorRow(matId);
  renderStrip();
}

function rowShell(label: string, animated: boolean, onKey: () => void) {
  const wrap = document.createElement("div"); wrap.className = "field";
  const l = document.createElement("label"); l.textContent = label; wrap.appendChild(l);
  const body = document.createElement("div"); body.className = "vec"; wrap.appendChild(body);
  const key = document.createElement("button"); key.className = "kbtn" + (animated ? " on" : ""); key.textContent = "◆";
  key.title = "Key this property at the current frame";
  key.onclick = onKey; wrap.appendChild(key);
  inspector.appendChild(wrap);
  return body;
}

function vecRow(label: string, target: Track["target"], base: () => number[], set: (i: number, v: number) => void,
                fmt = (x: number) => x, parse = (x: number) => x) {
  const track = () => findTrack(target);
  const current = () => (track() ? evalVec(track()!, player.currentFrame) : base());
  const inputs: HTMLInputElement[] = [];
  const body = rowShell(label, !!track(), () => { upsertKey(ensureTrack(target), player.currentFrame, current()); buildInspector(); repaint(); });
  for (let i = 0; i < 3; i++) {
    const inp = document.createElement("input"); inp.type = "number"; inp.step = "0.1"; inp.value = String(fmt(current()[i]!));
    inp.oninput = () => {
      const raw = parse(Number(inp.value));
      if (track()) { const v = current(); v[i] = raw; upsertKey(track()!, player.currentFrame, v); } // auto-key while animated
      else set(i, raw); // otherwise edit the base value live
      repaint(); renderStrip();
    };
    inputs.push(inp); body.appendChild(inp);
  }
  refs.push({ inputs, kind: "vec", fmt, track });
}

function colorRow(matId: string) {
  const target: Track["target"] = { materialId: matId, path: "color" };
  const mat: any = doc.materials.find((m: any) => m.id === matId);
  const track = () => findTrack(target);
  const current = () => (track() ? evalVec(track()!, player.currentFrame) : mat.color);
  const body = rowShell("color", !!track(), () => { upsertKey(ensureTrack(target), player.currentFrame, current()); buildInspector(); repaint(); });
  const inp = document.createElement("input"); inp.type = "color"; inp.value = toHex(current());
  inp.oninput = () => {
    const c = fromHex(inp.value);
    if (track()) upsertKey(track()!, player.currentFrame, c); else mat.color = c;
    repaint(); renderStrip();
  };
  body.appendChild(inp);
  refs.push({ inputs: [inp], kind: "color", fmt: (x) => x, track });
}

/** On scrub/play, animated fields follow the playhead (unless the user is editing that input). */
function refreshValues(frame: number) {
  for (const f of refs) {
    const t = f.track(); if (!t) continue;
    const v = evalVec(t, frame);
    if (f.kind === "color") { if (document.activeElement !== f.inputs[0]) f.inputs[0]!.value = toHex(v); }
    else f.inputs.forEach((inp, i) => { if (document.activeElement !== inp) inp.value = String(round(f.fmt(v[i]!))); });
  }
}

/** Diamonds on the timeline at the selected object's keyframe frames; click to seek. */
function renderStrip() {
  kfstrip.innerHTML = "";
  if (!selected) return;
  const n: any = doc.nodes.find((x: any) => x.id === selected);
  const matId: string | undefined = n?.mesh?.materialId;
  const frames = new Set<number>();
  for (const t of anim)
    if (t.target.nodeId === selected || (matId && t.target.materialId === matId))
      for (const k of t.keyframes) frames.add(k.frame);
  for (const fr of frames) {
    const d = document.createElement("div"); d.className = "kf";
    d.style.left = `${(fr / Math.max(1, totalFrames - 1)) * 100}%`;
    d.title = `frame ${fr} — click to seek`;
    d.onclick = () => { stop(); void player.seek(fr); };
    kfstrip.appendChild(d);
  }
}

// ---------- export ----------
$("export").onclick = () => {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "scene.json"; a.click();
};

buildTree();
void player.init().then(() => { frameLbl.textContent = `0 / ${totalFrames - 1}`; });
