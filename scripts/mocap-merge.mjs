#!/usr/bin/env node
// Merge retargeted mocap clips (scripts/blender/mocap/retarget-clips.py output) into the bundled
// MakeHuman GLBs, in place — meshes, skins, textures and morph targets are untouched; only
// animations are added or replaced (same name), and the library manifest's clip lists updated.
//
//   node scripts/mocap-merge.mjs <clips.json> <library.glb>...
//
// The clips carry each mapped bone's WORLD rotation delta from rest (glTF axes) and the hips'
// height/travel in metres for the reference body. Here they become joint-LOCAL channels against
// each GLB's own rest pose: world'(j) = delta(j) · restWorld(j) for mapped bones, world'(parent) ·
// restLocal(j) for the rest (fingers keep the GLB's idle pose), local = world'(parent)⁻¹ · world'(j).
// Hip offsets scale by this body's hip height / the reference's, so the kid sits on a kid's chair.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const [clipsPath, ...glbs] = process.argv.slice(2);
if (!clipsPath || !glbs.length) { console.error("usage: mocap-merge.mjs <clips.json> <library.glb>..."); process.exit(1); }
const data = JSON.parse(readFileSync(clipsPath, "utf8"));

// Composed clips (clips.json "compose": { base, upper }): legs + hips from `base` (looped), the
// spine and everything above it from `upper` — e.g. sit_talk = sitting legs, talking torso. Upper
// bones keep their WORLD orientation from `upper`, so the torso stays upright on the seat.
const LOWER = new Set(["pelvis", "thigh_l", "calf_l", "foot_l", "ball_l", "thigh_r", "calf_r", "foot_r", "ball_r"]);
// The recipe travels with the data (retarget-clips.py copies clips.json's "compose" entries).
for (const c of data.compose ?? []) {
  const base = data.clips.find((k) => k.name === c.base), upper = data.clips.find((k) => k.name === c.upper);
  if (!base || !upper) throw new Error(`compose ${c.name}: missing ${c.base} or ${c.upper} in ${clipsPath}`);
  const N = upper.frames, bi = (f) => (base.loop ? f % (base.frames - 1) : Math.min(f, base.frames - 1));
  const bones = {};
  for (const b of new Set([...Object.keys(base.bones), ...Object.keys(upper.bones)]))
    bones[b] = Array.from({ length: N }, (_, f) => (LOWER.has(b) ? base.bones[b][bi(f)] : upper.bones[b][f]));
  const composed = { name: c.name, loop: upper.loop, source: `${base.source} + ${upper.source}`, ground: base.ground, frames: N, bones,
    hip_dy: Array.from({ length: N }, (_, f) => base.hip_dy[bi(f)]),
    ...(base.hip_dxz ? { hip_dxz: Array.from({ length: N }, (_, f) => base.hip_dxz[bi(f)]) } : {}) };
  data.clips = data.clips.filter((k) => k.name !== c.name).concat(composed);
}

// --- quaternion helpers ([x, y, z, w]) ---
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => { const n = Math.hypot(...q) || 1; return q.map((v) => v / n); };
const qrot = (q, v) => qmul(qmul(q, [...v, 0]), qinv(q)).slice(0, 3);

// --- GLB I/O ---
function readGlb(path) {
  const b = readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  let off = 12, json, bin;
  while (off < b.length) {
    const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4);
    const chunk = b.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    else if (type === 0x004e4942) bin = Buffer.from(chunk);
    off += 8 + len;
  }
  return { json, bin };
}
function writeGlb(path, json, bin) {
  const pad = (buf, fill) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4, fill)]);
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20), bn = pad(bin, 0);
  const hdr = Buffer.alloc(12); hdr.writeUInt32LE(0x46546c67, 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(12 + 8 + j.length + 8 + bn.length, 8);
  const ch = (len, type) => { const c = Buffer.alloc(8); c.writeUInt32LE(len, 0); c.writeUInt32LE(type, 4); return c; };
  writeFileSync(path, Buffer.concat([hdr, ch(j.length, 0x4e4f534a), j, ch(bn.length, 0x004e4942), bn]));
}
function readAccessor(json, bin, i) {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  if (a.componentType !== 5126) throw new Error("only float accessors expected in animations");
  const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? n * 4;
  return Array.from({ length: a.count }, (_, k) => Array.from({ length: n }, (_, c) => bin.readFloatLE(base + k * stride + c * 4)));
}

for (const path of glbs) {
  const { json, bin } = readGlb(path);
  const nodes = json.nodes;
  const parent = new Map();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const byName = new Map(nodes.map((n, i) => [n.name, i]));
  const joints = json.skins[0].joints;
  const jointSet = new Set(joints);
  const restQ = (i) => nodes[i].rotation ?? [0, 0, 0, 1];
  const restT = (i) => nodes[i].translation ?? [0, 0, 0];
  // World rest rotation + position, through every ancestor (joints and the armature node).
  const worldR = new Map(), worldP = new Map();
  const world = (i) => {
    if (worldR.has(i)) return [worldR.get(i), worldP.get(i)];
    const p = parent.get(i);
    const [pr, pp] = p === undefined ? [[0, 0, 0, 1], [0, 0, 0]] : world(p);
    const s = nodes[i].scale ?? [1, 1, 1];
    if (s.some((v) => Math.abs(v - 1) > 1e-4) && !jointSet.has(i)) throw new Error(`${path}: scaled ancestor "${nodes[i].name}" not supported`);
    const r = qmul(pr, restQ(i)), pos = restT(i).map((v, k) => v), wp = qrot(pr, pos).map((v, k) => v + pp[k]);
    worldR.set(i, r); worldP.set(i, wp); return [r, wp];
  };
  joints.forEach(world);
  const pelvis = byName.get("pelvis");
  const hipScale = world(pelvis)[1][1] / data.hip_rest_m;
  // Unmapped joints (fingers, Root) keep the GLB's own idle pose (frame 0) — mocap has no fingers.
  const idle = json.animations.find((a) => a.name === "idle");
  const idleLocal = new Map();
  for (const ch of idle?.channels ?? []) {
    if (ch.target.path !== "rotation") continue;
    idleLocal.set(ch.target.node, readAccessor(json, bin, idle.samplers[ch.sampler].output)[0]);
  }
  const order = [...joints].sort((a, b) => depth(a) - depth(b));
  function depth(i) { let d = 0; for (let p = parent.get(i); p !== undefined; p = parent.get(p)) d++; return d; }

  let blob = [bin];
  let binLen = bin.length;
  const addAccessor = (values, type, minmax) => {
    const pad = (4 - (binLen % 4)) % 4;
    if (pad) { blob.push(Buffer.alloc(pad)); binLen += pad; }
    const flat = values.flat();
    const buf = Buffer.alloc(flat.length * 4);
    flat.forEach((v, k) => buf.writeFloatLE(v, k * 4));
    json.bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: buf.length });
    blob.push(buf); binLen += buf.length;
    const acc = { bufferView: json.bufferViews.length - 1, componentType: 5126, count: values.length, type };
    if (minmax) { acc.min = [Math.min(...flat)]; acc.max = [Math.max(...flat)]; }
    json.accessors.push(acc);
    return json.accessors.length - 1;
  };

  for (const clip of data.clips) {
    const N = clip.frames;
    const times = Array.from({ length: N }, (_, f) => [f / data.fps]);
    const input = addAccessor(times, "SCALAR", true);
    const rot = new Map(joints.map((j) => [j, []]));
    const pelvisT = [];
    const worldRots = [];
    for (let f = 0; f < N; f++) {
      const wr = new Map();
      for (const j of order) {
        const name = nodes[j].name, p = parent.get(j);
        const pw = p !== undefined && jointSet.has(p) ? wr.get(p) : (p !== undefined ? world(p)[0] : [0, 0, 0, 1]);
        const w = clip.bones[name] ? qnorm(qmul(clip.bones[name][f], world(j)[0])) : qmul(pw, idleLocal.get(j) ?? restQ(j));
        wr.set(j, w);
        rot.get(j).push(qnorm(qmul(qinv(pw), w)));
      }
      worldRots.push(wr);
      // Hips: rest translation + height (and travel) offset, expressed in the pelvis' parent space.
      const dxz = clip.hip_dxz?.[f] ?? [0, 0];
      const dWorld = [dxz[0] * hipScale, clip.hip_dy[f] * hipScale, dxz[1] * hipScale];
      const pr = world(parent.get(pelvis))[0];
      pelvisT.push(restT(pelvis).map((v, k) => v + qrot(qinv(pr), dWorld)[k]));
    }
    // Ground contact ("lock", default): forward kinematics on THIS body, then shift the hips so the
    // lowest foot contact — ankle or ball, each relative to its rest height — sits on the floor.
    // Squats and sits then land on the ground whatever the mocap floor/subject size; a run's
    // flight phase keeps its mocap height ("ground": "free").
    if ((clip.ground ?? "lock") === "lock") {
      const feet = ["foot_l", "foot_r", "ball_l", "ball_r"].map((n) => byName.get(n));
      const contact = worldRots.map((wr, f) => {
        const pos = new Map();
        for (const j of order) {
          const p = parent.get(j);
          const t = j === pelvis ? pelvisT[f] : restT(j);
          if (p === undefined || !jointSet.has(p)) { pos.set(j, p === undefined ? t : qrot(world(p)[0], t).map((v, k) => v + world(p)[1][k])); continue; }
          pos.set(j, qrot(wr.get(p), t).map((v, k) => v + pos.get(p)[k]));
        }
        return Math.min(...feet.map((j) => pos.get(j)[1] - world(j)[1][1]));
      });
      // light smoothing so contact switches between feet don't jitter the body
      const sm = contact.map((_, f) => { const w = [f - 1, f, f + 1].map((k) => contact[clip.loop ? (k + N) % N : Math.min(N - 1, Math.max(0, k))]); return (w[0] + 2 * w[1] + w[2]) / 4; });
      const up = qrot(qinv(world(parent.get(pelvis))[0]), [0, 1, 0]);
      for (let f = 0; f < N; f++) pelvisT[f] = pelvisT[f].map((v, k) => v - up[k] * sm[f]);
    }
    const channels = [], samplers = [];
    const add = (node, path, values, type) => {
      samplers.push({ input, output: addAccessor(values, type), interpolation: "LINEAR" });
      channels.push({ sampler: samplers.length - 1, target: { node, path } });
    };
    // Constant tracks (every translation but the hips) get two keys, not N — same pose, a tenth the bytes.
    const hold = addAccessor([[0], [(N - 1) / data.fps]], "SCALAR", true);
    const add2 = (node, path, value, type) => {
      samplers.push({ input: hold, output: addAccessor([value, value], type), interpolation: "LINEAR" });
      channels.push({ sampler: samplers.length - 1, target: { node, path } });
    };
    for (const j of joints) {
      add(j, "rotation", rot.get(j), "VEC4");
      if (j === pelvis) add(j, "translation", pelvisT, "VEC3");
      else add2(j, "translation", restT(j), "VEC3");
    }
    // Replace in place (order is API: a character with no clip named plays animations[0]).
    const anim = { name: clip.name, channels, samplers };
    const at = json.animations.findIndex((a) => a.name === clip.name);
    if (at >= 0) json.animations[at] = anim; else json.animations.push(anim);
  }
  const out = compact(json, Buffer.concat(blob));
  json.buffers[0].byteLength = out.length;
  writeGlb(path, json, out);
  console.log(`✓ ${basename(path)}: ${data.clips.map((c) => c.name).join(", ")} (hip scale ${hipScale.toFixed(2)}) — ${json.animations.map((a) => a.name).join(", ")}`);
}

/**
 * Drop accessors / bufferViews nothing references any more (the animations a re-run replaced),
 * remap indices and rebuild the binary chunk — so regenerating clips never grows the file.
 */
function compact(json, bin) {
  const usedAcc = new Set();
  for (const m of json.meshes ?? []) for (const p of m.primitives) {
    Object.values(p.attributes).forEach((a) => usedAcc.add(a));
    if (p.indices !== undefined) usedAcc.add(p.indices);
    for (const t of p.targets ?? []) Object.values(t).forEach((a) => usedAcc.add(a));
  }
  for (const sk of json.skins ?? []) if (sk.inverseBindMatrices !== undefined) usedAcc.add(sk.inverseBindMatrices);
  for (const an of json.animations ?? []) for (const sm of an.samplers) { usedAcc.add(sm.input); usedAcc.add(sm.output); }
  const accOrder = [...usedAcc].sort((a, b) => a - b);
  const accMap = new Map(accOrder.map((a, i) => [a, i]));
  const usedView = new Set(accOrder.map((a) => json.accessors[a].bufferView).filter((v) => v !== undefined));
  for (const im of json.images ?? []) if (im.bufferView !== undefined) usedView.add(im.bufferView);
  if (accOrder.some((a) => json.accessors[a].sparse)) throw new Error("sparse accessors not supported by compact()");
  const viewOrder = [...usedView].sort((a, b) => a - b);
  const viewMap = new Map(viewOrder.map((v, i) => [v, i]));
  const parts = []; let len = 0;
  const views = viewOrder.map((v) => {
    const bv = json.bufferViews[v];
    const pad = (4 - (len % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); len += pad; }
    const start = bv.byteOffset ?? 0;
    parts.push(bin.subarray(start, start + bv.byteLength));
    const nv = { ...bv, byteOffset: len }; len += bv.byteLength; return nv;
  });
  json.bufferViews = views;
  json.accessors = accOrder.map((a) => ({ ...json.accessors[a], bufferView: viewMap.get(json.accessors[a].bufferView) }));
  for (const m of json.meshes ?? []) for (const p of m.primitives) {
    for (const k in p.attributes) p.attributes[k] = accMap.get(p.attributes[k]);
    if (p.indices !== undefined) p.indices = accMap.get(p.indices);
    for (const t of p.targets ?? []) for (const k in t) t[k] = accMap.get(t[k]);
  }
  for (const sk of json.skins ?? []) if (sk.inverseBindMatrices !== undefined) sk.inverseBindMatrices = accMap.get(sk.inverseBindMatrices);
  for (const an of json.animations ?? []) for (const sm of an.samplers) { sm.input = accMap.get(sm.input); sm.output = accMap.get(sm.output); }
  for (const im of json.images ?? []) if (im.bufferView !== undefined) im.bufferView = viewMap.get(im.bufferView);
  return Buffer.concat(parts);
}

// Manifest: every merged character lists its clips (sorted, existing order kept first).
const manifestPath = join(dirname(glbs[0]), "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const path of glbs) {
  const c = manifest.characters.find((c) => c.file === basename(path));
  if (!c) continue;
  for (const clip of data.clips) if (!c.clips.includes(clip.name)) c.clips.push(clip.name);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
