import { Clock } from "./clock.js";
import { Rng } from "./rng.js";
import { evaluateTrack } from "./animation.js";
import { evaluateClip, type JointPose } from "./clip.js";
import { clamp, mat4, quat, quatFromEuler, v3, DEG2RAD } from "./math.js";
import type { Mat4, Quat, Vec3 } from "./math.js";
import type { Camera, Clip, Material, Node, SceneDocument, Skin, TextOverlay } from "./document.js";
import type {
  FrameState,
  PhysicsAdapter,
  ResolvedCamera,
  ResolvedLight,
  ResolvedNode,
  ResolvedParticle,
} from "./engine.js";

interface LocalTransform {
  position: Vec3;
  rotation: Vec3; // euler radians
  scale: Vec3;
  quat?: Quat; // set directly by physics, overrides euler
}

const AXIS: Record<string, number> = { x: 0, y: 1, z: 2 };

function applyToTransform(lt: LocalTransform, path: string, value: number | number[]): void {
  const [prop, comp] = path.split(".");
  const target =
    prop === "position" ? lt.position : prop === "rotation" ? lt.rotation : prop === "scale" ? lt.scale : null;
  if (!target) return;
  if (comp === undefined) {
    if (Array.isArray(value)) {
      target[0] = value[0] ?? target[0];
      target[1] = value[1] ?? target[1];
      target[2] = value[2] ?? target[2];
    }
  } else if (comp in AXIS && typeof value === "number") {
    target[AXIS[comp]!] = value;
  }
}

/** Deterministic integer hash → [0, 1). Splits particle randomness into independent streams. */
function hashN(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2246822519) + 374761393) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 8) / 16777216;
}

/**
 * Evaluate one particle system at `frame` — pure closed form: births are staggered across the
 * lifetime, each (particle, cycle) pair hashes its own spawn offset and velocity, and motion is
 * ballistic. Fades out over the last quarter of the lifetime.
 */
function evaluateParticles(ps: import("./document.js").Particles, frame: number, fps: number, out: ResolvedParticle[]): void {
  const local = frame - ps.startFrame;
  if (local < 0) return;
  for (let i = 0; i < ps.count; i++) {
    // Looping streams stagger births across one lifetime for a steady population; a one-shot
    // burst spawns everything together at startFrame.
    const birthOffset = ps.loop ? hashN(ps.seed, i, 0) * ps.lifeFrames : 0;
    const since = local - birthOffset;
    if (since < 0) continue;
    const cycle = Math.floor(since / ps.lifeFrames);
    if (!ps.loop && cycle > 0) continue;
    const age = since - cycle * ps.lifeFrames;
    const k = i + cycle * ps.count + 1; // fresh randomness every respawn
    const t = age / fps;
    const px = ps.position[0] + (hashN(ps.seed, k, 1) * 2 - 1) * ps.spread[0] + (ps.velocity[0] + (hashN(ps.seed, k, 4) * 2 - 1) * ps.velocitySpread[0]) * t + 0.5 * ps.gravity[0] * t * t;
    const py = ps.position[1] + (hashN(ps.seed, k, 2) * 2 - 1) * ps.spread[1] + (ps.velocity[1] + (hashN(ps.seed, k, 5) * 2 - 1) * ps.velocitySpread[1]) * t + 0.5 * ps.gravity[1] * t * t;
    const pz = ps.position[2] + (hashN(ps.seed, k, 3) * 2 - 1) * ps.spread[2] + (ps.velocity[2] + (hashN(ps.seed, k, 6) * 2 - 1) * ps.velocitySpread[2]) * t + 0.5 * ps.gravity[2] * t * t;
    const lifeT = age / ps.lifeFrames;
    const fade = lifeT > 0.75 ? (1 - lifeT) / 0.25 : 1;
    const resolved: ResolvedParticle = { position: [px, py, pz], size: ps.size, color: ps.color, opacity: ps.opacity * fade };
    if (ps.streak > 0) {
      // Closed-form instantaneous velocity: per-particle initial velocity + gravity·t.
      resolved.velocity = [
        ps.velocity[0] + (hashN(ps.seed, k, 4) * 2 - 1) * ps.velocitySpread[0] + ps.gravity[0] * t,
        ps.velocity[1] + (hashN(ps.seed, k, 5) * 2 - 1) * ps.velocitySpread[1] + ps.gravity[1] * t,
        ps.velocity[2] + (hashN(ps.seed, k, 6) * 2 - 1) * ps.velocitySpread[2] + ps.gravity[2] * t,
      ];
      resolved.streak = ps.streak;
    }
    out.push(resolved);
  }
}

/** Blend a sampled joint pose onto a local transform with weight `w` (1 = overwrite). */
function applyPose(lt: LocalTransform, pose: JointPose, w: number): void {
  if (w >= 1) {
    if (pose.translation) lt.position = pose.translation;
    if (pose.scale) lt.scale = pose.scale;
    if (pose.rotation) lt.quat = pose.rotation;
    return;
  }
  if (pose.translation) lt.position = v3.lerp(lt.position, pose.translation, w);
  if (pose.scale) lt.scale = v3.lerp(lt.scale, pose.scale, w);
  if (pose.rotation) {
    const from = lt.quat ?? quatFromEuler(lt.rotation[0], lt.rotation[1], lt.rotation[2]);
    lt.quat = quat.slerp(from, pose.rotation, w);
  }
}

/**
 * Map a scene frame to a clip-local frame. Returns null before the clip starts; after the end it
 * holds the last frame (non-loop) or wraps (loop). Frame-based → reproducible.
 */
function clipLocalFrame(
  pb: { startFrame: number; speed: number; loop: boolean },
  frame: number,
  durationFrames: number,
): number | null {
  const local = (frame - pb.startFrame) * pb.speed;
  if (local < 0) return null;
  if (pb.loop) return durationFrames > 0 ? local % durationFrames : 0;
  return Math.min(local, durationFrames);
}

function applyToMaterial(mat: Material, path: string, value: number | number[]): void {
  if ((path === "color" || path === "emissive") && Array.isArray(value)) {
    mat[path] = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
  } else if ((path === "opacity" || path === "roughness" || path === "metalness") && typeof value === "number") {
    mat[path] = value;
  }
}

function applyToOverlay(ov: TextOverlay, path: string, value: number | number[]): void {
  if (path === "color" && Array.isArray(value)) {
    ov.color = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
  } else if ((path === "opacity" || path === "x" || path === "y" || path === "size") && typeof value === "number") {
    ov[path] = value;
  }
}

/**
 * The runtime: advances the deterministic clock, steps physics, evaluates animation, and
 * resolves a full FrameState (world matrices, lights, camera) for an Engine to draw.
 * Forward-only stepping; call `reset()` to replay from the start.
 */
export class SceneRuntime {
  readonly doc: SceneDocument;
  readonly clock: Clock;
  readonly rng: Rng;
  private physics?: PhysicsAdapter;
  private nodeMap = new Map<string, Node>();
  private skinMap = new Map<string, Skin>();
  private clipMap = new Map<string, Clip>();
  private cameraById = new Map<string, Camera>();
  private channelKeysCache = new Map<string, Set<string>>();
  private springState = new Map<string, Quat>(); // smoothed rotation per spring node
  private springFrame = -1; // last frame the springs advanced to (same-frame recompute guard)
  private lockState = new Map<string, { ox: number; oz: number; foot?: string; ax: number; az: number }>();
  private lockFrame = -1;

  constructor(doc: SceneDocument, opts: { physics?: PhysicsAdapter } = {}) {
    this.doc = doc;
    this.physics = opts.physics;
    this.clock = new Clock({ fps: doc.meta.fps, substeps: doc.meta.substeps });
    this.rng = new Rng(doc.meta.seed);
    for (const n of doc.nodes) this.nodeMap.set(n.id, n);
    for (const s of doc.skins) this.skinMap.set(s.id, s);
    for (const c of doc.clips) this.clipMap.set(c.id, c);
    for (const c of doc.cameras) if (c.id) this.cameraById.set(c.id, c);
    if (doc.camera.id) this.cameraById.set(doc.camera.id, doc.camera);
  }

  async init(): Promise<void> {
    if (this.physics) await this.physics.init(this.doc);
  }

  async reset(): Promise<void> {
    this.clock.reset();
    this.springState.clear();
    this.springFrame = -1;
    this.lockState.clear();
    this.lockFrame = -1;
    if (this.physics) await this.physics.reset();
  }

  get durationFrames(): number {
    return this.doc.meta.durationFrames;
  }

  /** The set of "joint|path" channel keys a clip animates (cached — used to skip masked clips). */
  private clipChannelKeys(clip: Clip): Set<string> {
    let keys = this.channelKeysCache.get(clip.id);
    if (!keys) {
      keys = new Set(clip.channels.map((ch) => `${ch.jointNodeId}|${ch.path}`));
      this.channelKeysCache.set(clip.id, keys);
    }
    return keys;
  }

  /** Advance simulation to `frame` and resolve a FrameState. */
  computeFrameState(frame: number): FrameState {
    this.clock.advanceTo(frame, (subDt) => this.physics?.step(subDt));

    const locals = new Map<string, LocalTransform>();
    for (const n of this.doc.nodes) {
      locals.set(n.id, {
        position: [...n.position] as Vec3,
        rotation: [...n.rotation] as Vec3,
        scale: [...n.scale] as Vec3,
        quat: n.quaternion ? ([...n.quaternion] as Quat) : undefined,
      });
    }

    const materials = new Map<string, Material>();
    for (const m of this.doc.materials) {
      materials.set(m.id, { ...m, color: [...m.color] as Vec3, emissive: [...m.emissive] as Vec3 });
    }

    // Text overlays: clone so animation tracks can override per-frame values without mutating the doc.
    const overlays = new Map<string, TextOverlay>();
    for (const o of this.doc.overlays) {
      overlays.set(o.id, { ...o, color: [...o.color] as Vec3, box: o.box ? { ...o.box, color: [...o.box.color] as Vec3 } : undefined });
    }

    // Morph-target weights per node (aligned to the mesh's morphTargets order), seeded from the
    // mesh's `morphWeights` defaults (keyed by name). Animation tracks with a "morph.<name|index>"
    // path override them; the engine then displaces vertices by Σ weight·delta before skinning.
    const morphByNode = new Map<string, number[]>();
    const morphNames = new Map<string, (string | undefined)[]>();
    for (const n of this.doc.nodes) {
      const g = n.mesh?.geometry;
      if (g?.kind !== "mesh" || !g.data.morphTargets) continue;
      const names = g.data.morphTargets.map((t) => t.name);
      const defaults = n.mesh!.morphWeights;
      morphByNode.set(n.id, names.map((nm) => (nm && defaults ? (defaults[nm] ?? 0) : 0)));
      morphNames.set(n.id, names);
    }

    // Skeletal clips: sample each playing clip and blend it onto the joints' local transforms.
    // Playbacks composite in startFrame order (stable for ties), each ramping in over its
    // blendInFrames (smoothstep) ON TOP of the result so far: the first blends from the static
    // bind pose the locals still hold, every later one crossfades over the previous (idle →
    // walk → run). Lerp for translation/scale, slerp for rotation; weights are pure functions
    // of the frame index → deterministic. NOTE the layering semantics: a later clip only takes
    // over the channels it animates — channels unique to an earlier clip keep following it.
    for (const node of this.doc.nodes) {
      // A non-empty clips[] supersedes the legacy single clip; empty/omitted falls back.
      const playbacks = node.clips?.length ? node.clips : node.clip ? [node.clip] : [];
      if (playbacks.length === 0) continue;
      const ordered = playbacks.length > 1 ? [...playbacks].sort((a, b) => a.startFrame - b.startFrame) : playbacks;

      // Resolve each playback's clip, local frame, and blend weight for this frame.
      const active: { clip: Clip; local: number; w: number }[] = [];
      for (const pb of ordered) {
        const clip = this.clipMap.get(pb.clipId);
        if (!clip) continue;
        const local = clipLocalFrame(pb, frame, clip.durationFrames);
        if (local === null) continue; // not yet started
        let w = 1;
        if (pb.blendInFrames > 0) {
          const raw = clamp((frame - pb.startFrame) / pb.blendInFrames, 0, 1);
          w = raw * raw * (3 - 2 * raw); // smoothstep ease
        }
        if (w === 0) continue; // contributes nothing yet (and keeps the bind pose bit-exact)
        active.push({ clip, local, w });
      }

      // Dead-work elimination: once a later playback is at full weight, any earlier playback
      // whose channels it entirely covers can no longer affect the result — skip sampling it.
      for (let k = active.length - 1; k >= 1; k--) {
        if (active[k]!.w < 1) continue;
        const cover = this.clipChannelKeys(active[k]!.clip);
        const kept = active.slice(0, k).filter((e) => {
          for (const key of this.clipChannelKeys(e.clip)) if (!cover.has(key)) return true;
          return false;
        });
        active.splice(0, k, ...kept);
        break;
      }

      for (const { clip, local, w } of active) {
        for (const [jointId, pose] of evaluateClip(clip, local)) {
          const lt = locals.get(jointId);
          if (lt) applyPose(lt, pose, w);
        }
      }
    }

    const texFrameByNode = new Map<string, number>();
    const cameraOverrides = new Map<string, { fov?: number; lookAt?: Vec3 }>();
    // Environment overrides ("sky.top", "fog.near", "background", …): applied onto per-frame
    // copies of the doc's sky/fog below — the doc itself is never mutated.
    const env = new Map<string, number | Vec3>();
    const lightIntensityByNode = new Map<string, number>();
    const lightDirectionByNode = new Map<string, Vec3>();
    for (const track of this.doc.animation) {
      const value = evaluateTrack(track, frame);
      if (track.target.environment) {
        env.set(track.target.path, Array.isArray(value) ? [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0] : value);
      } else if (track.target.nodeId && track.target.path === "light.intensity") {
        if (typeof value === "number") lightIntensityByNode.set(track.target.nodeId, value);
      } else if (track.target.nodeId && track.target.path === "light.direction") {
        if (Array.isArray(value)) lightDirectionByNode.set(track.target.nodeId, [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0]);
      } else if (track.target.nodeId && track.target.path === "texture.frame") {
        if (typeof value === "number") texFrameByNode.set(track.target.nodeId, value);
      } else if (track.target.nodeId && track.target.path.startsWith("morph.")) {
        const weights = morphByNode.get(track.target.nodeId);
        const names = morphNames.get(track.target.nodeId);
        if (weights && typeof value === "number") {
          const key = track.target.path.slice(6);
          let idx = names ? names.indexOf(key) : -1;
          if (idx < 0 && Number.isInteger(Number(key))) idx = Number(key);
          if (idx >= 0 && idx < weights.length) weights[idx] = value;
        }
      } else if (track.target.nodeId) {
        const lt = locals.get(track.target.nodeId);
        if (lt) applyToTransform(lt, track.target.path, value);
      } else if (track.target.materialId) {
        const mt = materials.get(track.target.materialId);
        if (mt) applyToMaterial(mt, track.target.path, value);
      } else if (track.target.cameraId) {
        const o = cameraOverrides.get(track.target.cameraId) ?? {};
        if (track.target.path === "fov" && typeof value === "number") o.fov = value;
        else if (track.target.path === "lookAt" && Array.isArray(value)) o.lookAt = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
        cameraOverrides.set(track.target.cameraId, o);
      } else if (track.target.overlayId) {
        const ov = overlays.get(track.target.overlayId);
        if (ov) applyToOverlay(ov, track.target.path, value);
      }
    }

    // Spring bones: the rendered rotation exponentially chases the animated target. Advance
    // the state only when the frame moves forward; recomputing the same frame reuses it.
    for (const n of this.doc.nodes) {
      if (!n.spring) continue;
      const lt = locals.get(n.id)!;
      const target = lt.quat ?? quatFromEuler(lt.rotation[0], lt.rotation[1], lt.rotation[2]);
      if (frame > this.springFrame) {
        const prev = this.springState.get(n.id) ?? target;
        this.springState.set(n.id, quat.slerp(prev, target, 1 - n.spring.smoothing));
      }
      lt.quat = this.springState.get(n.id) ?? target;
    }
    if (frame > this.springFrame) this.springFrame = frame;

    if (this.physics) {
      for (const [nodeId, tr] of this.physics.getTransforms()) {
        const lt = locals.get(nodeId);
        if (lt) {
          lt.position = tr.position;
          lt.quat = tr.quaternion;
        }
      }
    }

    const worldMatrices = new Map<string, Mat4>();
    const computeWorld = (id: string): Mat4 => {
      return computeWorldInner(id);
    };
    const computeWorldInner = (id: string): Mat4 => {
      const cached = worldMatrices.get(id);
      if (cached) return cached;
      const node = this.nodeMap.get(id)!;
      const lt = locals.get(id)!;
      const quat = lt.quat ?? quatFromEuler(lt.rotation[0], lt.rotation[1], lt.rotation[2]);
      const localMat = mat4.compose(lt.position, quat, lt.scale);
      const world = node.parent ? mat4.multiply(computeWorld(node.parent), localMat) : localMat;
      worldMatrices.set(id, world);
      return world;
    };

    // Ground-contact IK: lift each ik-tagged node so its deepest foot joint touches (never
    // penetrates) the ground plane; with `lock`, additionally pin the planted foot's world X/Z
    // between frames (anti-slide / root-motion extraction). World caches are invalidated so
    // the final resolve sees the corrected pose.
    const advanceLock = frame > this.lockFrame;
    for (const n of this.doc.nodes) {
      if (!n.ik?.feet.length) continue;
      const lt = locals.get(n.id)!;

      // Carry the accumulated locomotion offset before measuring feet.
      const ls = n.ik.lock ? this.lockState.get(n.id) ?? { ox: 0, oz: 0, ax: 0, az: 0 } : undefined;
      if (ls) {
        lt.position[0] += ls.ox;
        lt.position[2] += ls.oz;
        worldMatrices.clear();
      }

      let deepest = Infinity;
      let deepestFoot: string | undefined;
      for (const foot of n.ik.feet) {
        if (!this.nodeMap.has(foot)) continue;
        const y = mat4.getTranslation(computeWorld(foot))[1];
        if (y < deepest) {
          deepest = y;
          deepestFoot = foot;
        }
      }
      if (deepest === Infinity) continue;
      const penetration = n.ik.ground - deepest;
      if (penetration > 0) {
        lt.position[1] += penetration;
        worldMatrices.clear();
      }

      // Stance lock: if the deepest foot is on (or was pushed onto) the ground, pin its world
      // X/Z to where it first planted; the correction accumulates into the locomotion offset.
      if (ls && deepestFoot && advanceLock) {
        const planted = penetration >= -1e-6; // touching the ground after the lift
        if (planted) {
          const fp = mat4.getTranslation(computeWorld(deepestFoot));
          if (ls.foot !== deepestFoot) {
            ls.foot = deepestFoot; // new stance foot: anchor where it landed
            ls.ax = fp[0];
            ls.az = fp[2];
          } else {
            const dx = ls.ax - fp[0];
            const dz = ls.az - fp[2];
            if (dx !== 0 || dz !== 0) {
              lt.position[0] += dx;
              lt.position[2] += dz;
              ls.ox += dx;
              ls.oz += dz;
              worldMatrices.clear();
            }
          }
        } else {
          ls.foot = undefined; // airborne: next plant re-anchors
        }
        this.lockState.set(n.id, ls);
      }
    }
    if (advanceLock) this.lockFrame = frame;

    const nodes: ResolvedNode[] = [];
    const lights: ResolvedLight[] = [];
    // Sky-derived ambient (R2.2): a synthetic hemisphere light tinted by the sky itself, so
    // the environment "bounces" onto geometry. Engines treat it like any hemisphere light.
    const docSky = this.doc.environment?.sky;
    const v3v = (k: string, fb: Vec3): Vec3 => (Array.isArray(env.get(k)) ? (env.get(k) as Vec3) : fb);
    const nv = (k: string, fb: number | undefined): number | undefined => (typeof env.get(k) === "number" ? (env.get(k) as number) : fb);
    const sky = docSky?.type === "gradient"
      ? {
          ...docSky,
          top: v3v("sky.top", docSky.top),
          bottom: v3v("sky.bottom", docSky.bottom),
          ambient: nv("sky.ambient", docSky.ambient),
          sun: docSky.sun
            ? { ...docSky.sun, color: docSky.sun.color ? v3v("sky.sun.color", docSky.sun.color) : docSky.sun.color, size: nv("sky.sun.size", docSky.sun.size) ?? docSky.sun.size, glow: nv("sky.sun.glow", docSky.sun.glow) ?? docSky.sun.glow }
            : docSky.sun,
        }
      : undefined;
    if (sky && sky.ambient && sky.ambient > 0) {
      lights.push({
        type: "hemisphere",
        color: [1, 1, 1],
        intensity: sky.ambient,
        position: [0, 0, 0],
        direction: [0, -1, 0],
        skyColor: sky.top,
        groundColor: sky.bottom,
      });
    }
    const docFog = this.doc.environment?.fog;
    const fog = docFog
      ? { ...docFog, color: v3v("fog.color", docFog.color), near: nv("fog.near", docFog.near) ?? docFog.near, far: nv("fog.far", docFog.far) ?? docFog.far }
      : undefined;
    for (const n of this.doc.nodes) {
      const world = computeWorld(n.id);
      const material = n.mesh?.materialId ? materials.get(n.mesh.materialId) : undefined;
      let skin: { jointMatrices: Mat4[] } | undefined;
      if (n.mesh?.skinId) {
        const sk = this.skinMap.get(n.mesh.skinId);
        if (sk) {
          // glTF skinning: jointMatrix = jointWorld · inverseBind. The skinned mesh's own node
          // transform is intentionally ignored — joints carry the full transform.
          const jointMatrices = sk.joints.map((jid, i) =>
            mat4.multiply(computeWorld(jid), sk.inverseBindMatrices[i]!),
          );
          skin = { jointMatrices };
        }
      }
      nodes.push({ id: n.id, worldMatrix: world, mesh: n.mesh, light: n.light, material, skin, morphWeights: morphByNode.get(n.id), textureFrame: texFrameByNode.get(n.id) });
      if (n.light) {
        // A "light.direction" track lerps the raw vector between keys; normalizing here keeps
        // the resolved direction unit-length mid-lerp.
        const dir = lightDirectionByNode.get(n.id) ?? n.light.direction;
        lights.push({
          type: n.light.type,
          color: n.light.color,
          intensity: lightIntensityByNode.get(n.id) ?? n.light.intensity,
          position: mat4.getTranslation(world),
          direction: dir
            ? v3.normalize(dir)
            : v3.normalize(mat4.transformDir(world, [0, 0, -1])),
          skyColor: n.light.skyColor,
          groundColor: n.light.groundColor,
          decay: n.light.decay,
        });
      }
    }

    const particles: ResolvedParticle[] = [];
    for (const ps of this.doc.particles) evaluateParticles(ps, frame, this.doc.meta.fps, particles);

    const toneMix = env.get("tone.mix");
    return {
      frame,
      time: frame / this.doc.meta.fps,
      width: this.doc.meta.width,
      height: this.doc.meta.height,
      background: v3v("background", this.doc.meta.background),
      sky: sky ? { top: sky.top, bottom: sky.bottom, sun: sky.sun } : undefined,
      fog,
      style: this.doc.meta.style,
      tone: this.doc.meta.tone,
      ...(typeof toneMix === "number" ? { toneMix: Math.min(1, Math.max(0, toneMix)) } : {}),
      bloom: this.doc.meta.bloom,
      nodes,
      lights,
      camera: this.resolveCamera(frame, computeWorld, cameraOverrides),
      overlays: this.doc.overlays.map((o) => overlays.get(o.id)!),
      particles,
    };
  }

  /** The camera filming `frame` — the first matching shot's camera, else the default `camera`. */
  private pickCamera(frame: number): Camera {
    for (const shot of this.doc.shots) {
      if (frame >= shot.startFrame && frame <= shot.endFrame) {
        const c = this.cameraById.get(shot.cameraId);
        if (c) return c;
      }
    }
    return this.doc.camera;
  }

  private resolveCamera(
    frame: number,
    computeWorld: (id: string) => Mat4,
    overrides: Map<string, { fov?: number; lookAt?: Vec3 }>,
  ): ResolvedCamera {
    const cam = this.pickCamera(frame);
    const ov = (cam.id ? overrides.get(cam.id) : undefined) ?? {};
    const world = computeWorld(cam.nodeId);
    const position = mat4.getTranslation(world);

    // Look-at target precedence: animated override → tracked node → static lookAt → node forward.
    const target =
      ov.lookAt ?? (cam.lookAtNodeId ? mat4.getTranslation(computeWorld(cam.lookAtNodeId)) : cam.lookAt);
    let viewMatrix: Mat4;
    if (target) {
      viewMatrix = mat4.lookAt(position, target, [0, 1, 0]);
    } else {
      const fwd = v3.add(position, v3.normalize(mat4.transformDir(world, [0, 0, -1])));
      const up = v3.normalize(mat4.transformDir(world, [0, 1, 0]));
      viewMatrix = mat4.lookAt(position, fwd, up);
    }
    const aspect = this.doc.meta.width / this.doc.meta.height;
    return {
      viewMatrix,
      projMatrix: mat4.perspective((ov.fov ?? cam.fov) * DEG2RAD, aspect, cam.near, cam.far),
      position,
    };
  }
}
