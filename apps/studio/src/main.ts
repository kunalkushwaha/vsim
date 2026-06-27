// vsim Studio — a minimal browser editor on top of the deterministic engine. Loads a scene, drives
// the real @vsim/player against a canvas, and lets you scrub the timeline, select objects, and edit
// their transform/material live (mutate the document → re-present the current frame). "Preview ==
// render" holds, so what you edit here is what `vsim render` will export.
import { Player } from "@vsim/player";
import type { SceneDocument } from "@vsim/core";
import { sampleScene } from "./sample-scene.js";

const doc: SceneDocument = sampleScene();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("preview");
canvas.width = doc.meta.width;
canvas.height = doc.meta.height;
const player = new Player(doc, { canvas, loop: true });

// --- transport (play / scrub / frame counter) ---
const playBtn = $<HTMLButtonElement>("play");
const scrub = $<HTMLInputElement>("scrub");
const frameLbl = $<HTMLSpanElement>("frame");
scrub.max = String(doc.meta.durationFrames - 1);
playBtn.onclick = () => { player.toggle(); playBtn.textContent = player.isPlaying ? "⏸" : "▶"; };
scrub.oninput = () => {
  if (player.isPlaying) { player.pause(); playBtn.textContent = "▶"; }
  void player.seek(Number(scrub.value));
};
player.onFrame = (f, total) => { scrub.value = String(f); frameLbl.textContent = `${f} / ${total - 1}`; };

// --- scene tree ---
let selected: string | null = null;
const tree = $("tree");
const hidden = (n: any) => n.id.startsWith("__"); // auto-generated camera/light ids
const kindOf = (n: any) => (n.light ? n.light.type : n.mesh ? n.mesh.geometry.kind : "group");
function buildTree() {
  tree.innerHTML = "";
  for (const n of doc.nodes) {
    if (hidden(n)) continue;
    const row = document.createElement("div");
    row.className = "row" + (n.parent ? " child" : "") + (n.id === selected ? " sel" : "");
    row.innerHTML = `<span>${n.id}</span><span class="kind">${kindOf(n)}</span>`;
    row.onclick = () => select(n.id);
    tree.appendChild(row);
  }
}

// --- inspector (live edit) ---
const inspector = $("inspector");
const select = (id: string) => { selected = id; buildTree(); buildInspector(); };
const repaint = () => void player.seek(player.currentFrame); // re-present current frame with the mutated doc
const rad2deg = (r: number) => Math.round((r * 180) / Math.PI * 10) / 10;
const deg2rad = (d: number) => (d * Math.PI) / 180;
const hex2 = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, "0");
const toHex = (c: number[]) => `#${hex2(c[0]!)}${hex2(c[1]!)}${hex2(c[2]!)}`;
const fromHex = (h: string): [number, number, number] =>
  [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

function vecField(label: string, get: () => number[], set: (i: number, v: number) => void,
                  fmt = (x: number) => x, parse = (x: number) => x) {
  const wrap = document.createElement("div"); wrap.className = "field";
  const l = document.createElement("label"); l.textContent = label; wrap.appendChild(l);
  const vec = document.createElement("div"); vec.className = "vec";
  for (let i = 0; i < 3; i++) {
    const inp = document.createElement("input");
    inp.type = "number"; inp.step = "0.1"; inp.value = String(fmt(get()[i]!));
    inp.oninput = () => { set(i, parse(Number(inp.value))); repaint(); };
    vec.appendChild(inp);
  }
  wrap.appendChild(vec); return wrap;
}

function buildInspector() {
  inspector.innerHTML = "";
  const n: any = doc.nodes.find((x) => x.id === selected);
  if (!n) { inspector.innerHTML = '<p class="empty">Select an object.</p>'; return; }
  const h = document.createElement("h3"); h.textContent = n.id; inspector.appendChild(h);
  inspector.appendChild(vecField("position", () => n.position, (i, v) => { n.position[i] = v; }));
  inspector.appendChild(vecField("rotation°", () => n.rotation, (i, v) => { n.rotation[i] = v; }, rad2deg, deg2rad));
  inspector.appendChild(vecField("scale", () => n.scale, (i, v) => { n.scale[i] = v; }));
  const mat: any = n.mesh?.materialId ? doc.materials.find((m) => m.id === n.mesh.materialId) : undefined;
  if (mat) {
    const wrap = document.createElement("div"); wrap.className = "field";
    const l = document.createElement("label"); l.textContent = "color"; wrap.appendChild(l);
    const c = document.createElement("input"); c.type = "color"; c.value = toHex(mat.color);
    c.oninput = () => { mat.color = fromHex(c.value); repaint(); };
    wrap.appendChild(c); inspector.appendChild(wrap);
  }
}

// --- export (the edited document → JSON; `vsim render scene.json` makes the MP4) ---
$("export").onclick = () => {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "scene.json"; a.click();
};

buildTree();
void player.init().then(() => {
  frameLbl.textContent = `0 / ${doc.meta.durationFrames - 1}`;
});
