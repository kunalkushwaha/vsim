// Film3DDoc → SceneDocument. The compiler is where story altitude becomes keyframes:
// it walks the beat list tracking each actor's (x, z, heading), turns `move` into
// position + turn keyframes and gait-clip crossfades, lowers shots to named cameras +
// cuts, and hands the result to the existing deterministic render pipeline. Pure
// function of the document (character rigs are committed assets), so the same film
// compiles to the same SceneDocument bytes forever.
import { scene, type SceneBuilder, type Vec3 } from "@vsim/authoring";
import { loadCharacter } from "@vsim/assets";
import type { SceneDocument } from "@vsim/core";
import { CHARACTERS, type Film3DDoc, type Film3DShot } from "./schema.js";
import { SET_LOOKS, applySet, placeProp, weather, applyTransition } from "./sets.js";

export const FILM3D_WIDTH = 960;
export const FILM3D_HEIGHT = 540;

type Key = { frame: number; value: number | number[]; easing?: string };

/** Yaw of a ground-plane direction under Y-rotation convention: R_y(θ)·(0,0,1) = (sinθ, cosθ). */
const yawOf = (dx: number, dz: number): number => Math.atan2(dx, dz);

/** The equivalent angle of `target` nearest to `prev` (so turns never spin the long way). */
function unwrap(prev: number, target: number): number {
  let t = target;
  while (t - prev > Math.PI) t -= 2 * Math.PI;
  while (prev - t > Math.PI) t += 2 * Math.PI;
  return t;
}

/** Piecewise-linear position track per actor, also used to aim/follow cameras. */
class Track {
  keys: { frame: number; x: number; z: number }[] = [];
  constructor(x: number, z: number) {
    this.keys.push({ frame: 0, x, z });
  }
  add(frame: number, x: number, z: number): void {
    this.keys = this.keys.filter((k) => k.frame !== frame); // later writes win
    this.keys.push({ frame, x, z });
    this.keys.sort((a, b) => a.frame - b.frame);
  }
  at(frame: number): { x: number; z: number } {
    const ks = this.keys;
    if (frame <= ks[0]!.frame) return ks[0]!;
    for (let i = 1; i < ks.length; i++) {
      const a = ks[i - 1]!, b = ks[i]!;
      if (frame <= b.frame) {
        const t = (frame - a.frame) / (b.frame - a.frame);
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      }
    }
    return ks[ks.length - 1]!;
  }
}

interface ActorState {
  character: keyof typeof CHARACTERS;
  track: Track;
  yawKeys: Key[];
  yaw: number;
}

/** Compile a validated Film3DDoc into a render-ready SceneDocument. */
export async function compileFilm3D(doc: Film3DDoc): Promise<SceneDocument> {
  const fps = doc.fps;
  const filmEndSec = doc.beats[doc.beats.length - 1]!.end;
  const DUR = Math.round(filmEndSec * fps);
  const F = (sec: number) => Math.max(0, Math.min(DUR, Math.round(sec * fps)));
  let look = SET_LOOKS[doc.set];
  // A sunless set transitioning to a sunny one seeds a zero-size disc so the transition's
  // sky.sun.size/glow tracks have something to grow — a sunrise instead of no disc at all.
  const toSun = doc.transition ? SET_LOOKS[doc.transition.to].sky.sun : undefined;
  if (toSun && !look.sky.sun) {
    look = { ...look, sky: { ...look.sky, sun: { size: 0, glow: 0, color: toSun.color } } };
  }

  const b = scene({
    fps,
    duration: DUR,
    width: FILM3D_WIDTH,
    height: FILM3D_HEIGHT,
    background: look.background,
    ...(look.tone ? { tone: look.tone } : {}),
    ...(look.glow ? { bloom: look.glow } : {}),
  });
  applySet(b, look);
  if (doc.weather) weather(b, doc.weather);
  if (doc.transition) applyTransition(b, look, SET_LOOKS[doc.transition.to], F(doc.transition.start), F(doc.transition.end));

  for (const p of doc.props) await placeProp(b, look, p, DUR, fps);

  // --- actors: place rigs, then walk the beat list tracking (x, z, heading) --------------
  const states = new Map<string, ActorState>();
  for (const a of doc.actors) {
    const info = CHARACTERS[a.character];
    const { rig, meta } = await loadCharacter(a.character, fps);
    const s = meta.scale * info.scale;
    const face = a.facing ?? [0, 0];
    const fdx = face[0] - a.x, fdz = face[1] - a.z;
    const baseYaw = yawOf(info.faces[0], info.faces[1]);
    // Face the requested point (default: the origin); if the actor sits ON it, keep rig-forward.
    const yaw0 = Math.hypot(fdx, fdz) < 1e-6 ? 0 : yawOf(fdx, fdz) - baseYaw;
    const tint = "tint" in info && info.tint ? (info.tint as unknown as Vec3) : undefined;
    if (tint) b.material(`${a.id}__tint`, { color: tint, roughness: 0.5 });
    b.character(a.id, rig, {
      clip: info.idle.clip,
      loop: true,
      speed: "speed" in info.idle ? info.idle.speed : undefined,
      material: tint ? `${a.id}__tint` : undefined,
      scale: [s, s, s],
      rotation: [0, yaw0, 0],
      position: [a.x, 0, a.z],
    });
    // Aim node at head height — cameras look at (and follow) this, not the actor's feet.
    b.group(`${a.id}__aim`, { parent: a.id, position: [0, info.eye, 0] });
    states.set(a.id, { character: a.character, track: new Track(a.x, a.z), yawKeys: [{ frame: 0, value: yaw0 }], yaw: yaw0 });
  }

  // Absolute-time action list, sorted so each actor's state advances chronologically.
  const acts = doc.beats
    .flatMap((beat) => beat.actions.map((action) => ({ sec: beat.start + action.at, action })))
    .sort((p, q) => p.sec - q.sec);

  for (const { sec, action } of acts) {
    const st = states.get(action.actor)!;
    const info = CHARACTERS[st.character];
    const baseYaw = yawOf(info.faces[0], info.faces[1]);
    const startF = F(sec);

    if (action.do === "move") {
      const endF = Math.max(startF + 1, F(sec + action.dur));
      const from = st.track.at(startF);
      const [tx, tz] = action.to;
      const dist = Math.hypot(tx - from.x, tz - from.z);
      if (dist < 1e-3) continue;
      st.track.add(startF, from.x, from.z);
      st.track.add(endF, tx, tz);
      // Turn into the travel direction over the first ~0.4s of the move.
      const heading = unwrap(st.yaw, yawOf(tx - from.x, tz - from.z) - baseYaw);
      const turnF = Math.max(1, Math.min(Math.round(0.4 * fps), Math.floor((endF - startF) / 3) || 1));
      st.yawKeys.push({ frame: startF, value: st.yaw }, { frame: startF + turnF, value: heading, easing: "easeInOut" });
      st.yaw = heading;
      // Gait: explicit, or picked from travel speed; settle back to idle on arrival.
      const speed = dist / action.dur;
      const gait = action.gait ?? (speed > info.runAt * 0.7 ? "run" : "walk");
      b.playClip(action.actor, info[gait].clip, { startFrame: startF, blendIn: 8, loop: true });
      b.playClip(action.actor, info.idle.clip, { startFrame: endF, blendIn: 10, loop: true, speed: "speed" in info.idle ? info.idle.speed : undefined });
    } else if (action.do === "face") {
      const pos = st.track.at(startF);
      const [tx, tz] = action.to;
      if (Math.hypot(tx - pos.x, tz - pos.z) < 1e-6) continue;
      const target = unwrap(st.yaw, yawOf(tx - pos.x, tz - pos.z) - baseYaw);
      st.yawKeys.push({ frame: startF, value: st.yaw }, { frame: F(sec + action.dur), value: target, easing: "easeInOut" });
      st.yaw = target;
    } else {
      // play: run a named clip, then settle back to idle.
      b.playClip(action.actor, action.clip, { startFrame: startF, blendIn: 8, loop: true });
      b.playClip(action.actor, info.idle.clip, { startFrame: F(sec + action.dur), blendIn: 10, loop: true, speed: "speed" in info.idle ? info.idle.speed : undefined });
    }
  }

  // Emit each actor's accumulated tracks (position piecewise-linear, yaw eased turns).
  for (const [id, st] of states) {
    if (st.track.keys.length > 1) {
      b.animate(id, "position.x", st.track.keys.map((k) => ({ frame: k.frame, value: k.x })));
      b.animate(id, "position.z", st.track.keys.map((k) => ({ frame: k.frame, value: k.z })));
    }
    if (st.yawKeys.length > 1) {
      // Deduplicate same-frame writes (later wins) — overlapping actions must not fight.
      const byFrame = new Map<number, Key>();
      for (const k of st.yawKeys) byFrame.set(k.frame, k);
      b.animate(id, "rotation.y", [...byFrame.values()].sort((p, q) => p.frame - q.frame));
    }
  }

  // --- camera: contiguous shot list → named cameras + cuts -------------------------------
  const shots: Film3DShot[] = doc.camera.length
    ? doc.camera
    : [{ at: 0, dur: filmEndSec, shot: "wide", angle: 25, sweep: 90 } as Film3DShot];
  const firstActor = doc.actors[0]?.id;

  const resolveTarget = (s: Film3DShot, frame: number): { point: Vec3; actor?: string } => {
    const t = s.target ?? firstActor ?? ([0, 0.6, 0] as Vec3);
    if (typeof t !== "string") return { point: t };
    const st = states.get(t)!;
    const p = st.track.at(frame);
    return { point: [p.x, CHARACTERS[st.character].eye, p.z], actor: t };
  };

  const rad = (deg: number) => (deg * Math.PI) / 180;
  const camPos = (target: Vec3, angleDeg: number, dist: number, height: number): Vec3 => [
    target[0] + Math.sin(rad(angleDeg)) * dist,
    height,
    target[2] + Math.cos(rad(angleDeg)) * dist,
  ];

  shots.forEach((s, i) => {
    const startF = F(s.at);
    const endF = i === shots.length - 1 ? DUR : F(s.at + s.dur);
    const shotEnd = i === shots.length - 1 ? DUR : endF - 1;
    const { point, actor } = resolveTarget(s, startF);
    const defaults = {
      wide: { dist: 9, height: 3, fov: 42 },
      close: { dist: 3.4, height: point[1] + 0.5, fov: 40 },
      follow: { dist: 5, height: 1.8, fov: 42 },
      orbit: { dist: 6.5, height: 2.6, fov: 42 },
    }[s.shot];
    const dist = s.distance ?? defaults.dist;
    const height = s.height ?? defaults.height;
    const fov = s.fov ?? defaults.fov;
    const camId = `shot${i}`;
    const aim = actor ? { lookAtNodeId: `${actor}__aim` } : { lookAt: point };

    // Where this shot's camera sits at any frame (before handheld drift).
    const basePosAt = (f: number): Vec3 => {
      if (s.shot === "orbit") {
        const t = (f - startF) / Math.max(1, endF - startF);
        return camPos(point, s.angle + t * s.sweep, dist, height);
      }
      if (s.shot === "follow" && actor) {
        const p = states.get(actor)!.track.at(f);
        return camPos([p.x, point[1], p.z], s.angle, dist, height);
      }
      return camPos(point, s.angle, dist, height);
    };
    // Handheld drift: two seeded sines per axis (slow sway + gentle tremor), a few cm of
    // amplitude. Pure math baked into keyframes at compile time — deterministic, and the
    // aim stays on the target so the drift reads as natural operator rock, not slippage.
    const drift = (f: number): Vec3 => {
      const w = (p: number) => Math.sin(f * 0.047 + p) * 0.7 + Math.sin(f * 0.19 + p * 3.1) * 0.3;
      const seed = i * 7.31;
      return [w(seed + 1.7) * 0.05, w(seed + 4.1) * 0.03, w(seed + 8.9) * 0.05];
    };
    const add = (a: Vec3, d: Vec3): Vec3 => [a[0] + d[0], a[1] + d[1], a[2] + d[2]];

    b.addCamera(camId, { position: basePosAt(startF), fov, ...aim });
    if (s.handheld) {
      // Dense keys (every 3 frames, linearly interpolated) carry both the shot's own
      // motion and the drift.
      const keys: Key[] = [];
      for (let f = startF; f <= endF; f += 3) keys.push({ frame: f, value: add(basePosAt(f), drift(f)) });
      if ((endF - startF) % 3 !== 0) keys.push({ frame: endF, value: add(basePosAt(endF), drift(endF)) });
      b.animate(`__cam_${camId}`, "position", keys);
    } else if (s.shot === "orbit") {
      const keys: Key[] = [];
      const samples = 24;
      for (let k = 0; k <= samples; k++) {
        const t = k / samples;
        keys.push({ frame: Math.round(startF + t * (endF - startF)), value: camPos(point, s.angle + t * s.sweep, dist, height) });
      }
      b.animate(`__cam_${camId}`, "position", keys);
    } else if (s.shot === "follow" && actor) {
      // Ride the actor's own track: a camera position key at every path key in range.
      const st = states.get(actor)!;
      const frames = [startF, ...st.track.keys.map((k) => k.frame).filter((f) => f > startF && f < endF), endF];
      b.animate(`__cam_${camId}`, "position", frames.map((f) => {
        const p = st.track.at(f);
        return { frame: f, value: camPos([p.x, point[1], p.z], s.angle, dist, height) };
      }));
    }
    b.shot(camId, startF, shotEnd);
  });

  // Fallback default camera (the runtime's pre-shot anchor) — mirror the first shot.
  {
    const s0 = shots[0]!;
    const { point, actor } = resolveTarget(s0, 0);
    const dist = s0.distance ?? 9;
    const height = s0.height ?? 3;
    b.camera({ position: camPos(point, s0.angle, dist, height), fov: s0.fov ?? 42, ...(actor ? { lookAtNodeId: `${actor}__aim` } : { lookAt: point }) });
  }

  // --- title card + beat captions ---------------------------------------------------------
  if (filmEndSec >= 4) {
    b.title("__title", doc.title, { startFrame: 0, endFrame: Math.min(F(2.6), DUR), fade: Math.round(0.35 * fps), y: 0.38, size: 52, color: [1, 1, 1] });
  }
  const fade = Math.max(1, Math.round(0.35 * fps));
  for (const beat of doc.beats) {
    if (!beat.caption) continue;
    const sF = F(beat.start), eF = F(beat.end);
    // Fit the type to the line: ~0.55·size per glyph must stay inside 92% of the frame.
    const size = Math.max(15, Math.min(26, Math.floor((FILM3D_WIDTH * 0.92) / (0.55 * beat.caption.length))));
    b.text(`__cap_${beat.id}`, beat.caption, {
      y: 0.93, size, align: "center", color: [1, 1, 1],
      box: { color: [0, 0, 0], opacity: 0.45, padding: 10 },
    });
    b.animateOverlay(`__cap_${beat.id}`, "opacity", [
      { frame: sF, value: 0 },
      { frame: Math.min(sF + fade, eF), value: 1, easing: "easeOut" },
      { frame: Math.max(eF - fade, sF + fade), value: 1 },
      { frame: eF, value: 0, easing: "easeIn" },
    ]);
  }

  return b.build();
}
