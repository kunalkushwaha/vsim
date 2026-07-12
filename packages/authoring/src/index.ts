import {
  parseDocument, tessellate,
  type SceneDocument, type SceneDocumentInput,
  type GeometryInput, type Vec3, type Quat, type Mat4, type MeshData, type Clip,
} from "@vsim/core";

type Keyframes = { frame: number; value: number | number[]; easing?: any }[];

/** Deterministic FNV-1a hash of `s` + stream `k`, mapped to [0, 1). Prop variation, never random. */
function hash01(s: string, k: number): number {
  let h = 2166136261 >>> 0;
  const str = `${s}:${k}`;
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 8) / 16777216;
}

/**
 * An organic foliage blob: a sphere with vertices displaced radially by smooth deterministic
 * noise (product of phase-shifted sines — no randomness), then smooth normals recomputed with
 * position-welded accumulation so the tessellation's seam/pole duplicates shade seamlessly.
 */
function lumpyCanopy(radius: number, seed: number): { positions: number[]; normals: number[]; indices: number[] } {
  const md = tessellate({ kind: "sphere", radius, segments: 10 });
  const positions = [...md.positions];
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3]! / radius, y = positions[i * 3 + 1]! / radius, z = positions[i * 3 + 2]! / radius;
    const noise =
      Math.sin(3.1 * x + seed) * Math.sin(2.7 * y + seed * 1.7) * Math.sin(3.7 * z + seed * 2.3) +
      0.5 * Math.sin(6.3 * x + seed * 3.1) * Math.sin(5.9 * z + seed * 4.7);
    const d = 1 + 0.14 * noise; // radial bump/dent
    positions[i * 3] = positions[i * 3]! * d;
    positions[i * 3 + 1] = positions[i * 3 + 1]! * d;
    positions[i * 3 + 2] = positions[i * 3 + 2]! * d;
  }
  // Recompute smooth normals, accumulating per welded position so duplicated seam vertices match.
  const key = (i: number) =>
    `${Math.round(positions[i * 3]! * 1e5)},${Math.round(positions[i * 3 + 1]! * 1e5)},${Math.round(positions[i * 3 + 2]! * 1e5)}`;
  const acc = new Map<string, [number, number, number]>();
  const idx = md.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!;
    const ux = positions[b * 3]! - ax, uy = positions[b * 3 + 1]! - ay, uz = positions[b * 3 + 2]! - az;
    const vx = positions[c * 3]! - ax, vy = positions[c * 3 + 1]! - ay, vz = positions[c * 3 + 2]! - az;
    // The sphere tessellation winds so (b-a)×(c-a) points inward — negate for outward normals.
    const fx = -(uy * vz - uz * vy), fy = -(uz * vx - ux * vz), fz = -(ux * vy - uy * vx);
    for (const i of [a, b, c]) {
      const kk = key(i);
      const e = acc.get(kk) ?? [0, 0, 0];
      e[0] += fx; e[1] += fy; e[2] += fz;
      acc.set(kk, e);
    }
  }
  const normals = new Array<number>(positions.length);
  for (let i = 0; i < n; i++) {
    const e = acc.get(key(i)) ?? [0, 1, 0];
    const len = Math.hypot(e[0], e[1], e[2]) || 1;
    normals[i * 3] = e[0] / len; normals[i * 3 + 1] = e[1] / len; normals[i * 3 + 2] = e[2] / len;
  }
  return { positions, normals, indices: [...md.indices] };
}

/**
 * A loaded character rig (structurally `RiggedGltf` from `@vsim/assets`). Pass the result of
 * `loadGltfRig()` to `SceneBuilder.character()`.
 */
export interface CharacterRig {
  mesh: MeshData;
  /** All skinned meshes sharing the skeleton (body + garments). Defaults to `[mesh]` if absent. */
  meshes?: MeshData[];
  joints: string[];
  jointNodes: { id: string; parent?: string; translation: Vec3; rotation: Quat; scale: Vec3 }[];
  inverseBindMatrices: Mat4[];
  clips: Clip[];
}

interface CharacterInput extends TransformInput {
  /** Clip to play (by its id in the rig). Defaults to the first clip. */
  clip?: string;
  loop?: boolean;
  speed?: number;
  startFrame?: number;
  /** Ease from the static bind pose into the clip over this many frames (default 0 = snap). */
  blendIn?: number;
  material?: string;
  /** Ground-contact IK: joint NAMES (un-namespaced) of the feet + ground height (default 0).
   * `lock: true` also pins planted feet between frames (anti-slide root-motion extraction). */
  ik?: { feet: string[]; ground?: number; lock?: boolean };
}

interface MetaInput {
  fps?: number;
  /** Duration in frames. */
  duration: number;
  width?: number;
  height?: number;
  seed?: number;
  substeps?: number;
  background?: Vec3;
  /** "realistic" (default) or "manga" (cel-shading + outlines). */
  style?: "realistic" | "manga";
  /** Output tone mapping: "none" (default) or "aces" (filmic highlight rolloff). */
  tone?: "none" | "aces";
  /** Opt-in glow around bright pixels (see MetaSchema.bloom). */
  bloom?: { threshold?: number; strength?: number; radius?: number };
}

interface TransformInput {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  parent?: string;
}

interface MeshInput extends TransformInput {
  geometry: GeometryInput;
  material?: string;
}

interface LightInput extends TransformInput {
  type: "ambient" | "directional" | "point" | "hemisphere";
  color?: Vec3;
  intensity?: number;
  direction?: Vec3;
  /** Point light distance falloff: 0 (default) = none, 2 = inverse-square (`1/(1+d^decay)`). */
  decay?: number;
  /** Hemisphere light: sky/ground tints. */
  skyColor?: Vec3;
  groundColor?: Vec3;
}

interface CameraInput extends TransformInput {
  /** Optional id, so shots and camera-animation tracks can reference this camera. */
  id?: string;
  fov?: number;
  near?: number;
  far?: number;
  lookAt?: Vec3;
  /** Aim at this node's world position every frame (a tracking shot). */
  lookAtNodeId?: string;
}

interface TextInput {
  /** Normalized screen position [0..1], origin top-left (default center 0.5, 0.5). */
  x?: number;
  y?: number;
  /** Font size in output pixels. */
  size?: number;
  color?: Vec3;
  opacity?: number;
  align?: "left" | "center" | "right";
  /** Optional background box (lower-thirds / captions). */
  box?: { color?: Vec3; opacity?: number; padding?: number };
}

type ColliderInput =
  | { shape: "box"; halfExtents?: Vec3 }
  | { shape: "sphere"; radius?: number }
  | { shape: "plane" };

interface BodyInput {
  type?: "dynamic" | "fixed" | "kinematic";
  collider: ColliderInput;
  mass?: number;
  restitution?: number;
  friction?: number;
  linvel?: Vec3;
  angvel?: Vec3;
}

/**
 * Fluent builder for scene documents — the ergonomic "code → scene" surface. Everything it
 * produces is just a SceneDocument, so timeline/AI tooling can read & round-trip it.
 */
export class SceneBuilder {
  private propMats = new Set<string>();
  private doc: SceneDocumentInput;
  private lightCount = 0;

  constructor(meta: MetaInput) {
    this.doc = {
      meta: {
        fps: meta.fps ?? 30,
        durationFrames: meta.duration,
        width: meta.width ?? 1920,
        height: meta.height ?? 1080,
        seed: meta.seed ?? 0,
        substeps: meta.substeps ?? 4,
        background: meta.background ?? [0.05, 0.06, 0.09],
        style: meta.style ?? "realistic",
        tone: meta.tone ?? "none",
        ...(meta.bloom ? { bloom: meta.bloom } : {}),
      },
      assets: [],
      materials: [],
      nodes: [],
      animation: [],
      camera: { nodeId: "__camera" },
    };
  }

  material(id: string, props: { color?: Vec3; emissive?: Vec3; opacity?: number; roughness?: number; metalness?: number }): this {
    this.doc.materials!.push({ id, ...props });
    return this;
  }

  asset(id: string, type: "gltf" | "audio" | "texture", uri: string): this {
    this.doc.assets!.push({ id, type, uri });
    return this;
  }

  private node(id: string, t: TransformInput, extra: Record<string, unknown>): void {
    this.doc.nodes!.push({
      id,
      parent: t.parent,
      position: t.position,
      rotation: t.rotation,
      scale: t.scale,
      ...extra,
    } as any);
  }

  group(id: string, t: TransformInput = {}): this {
    this.node(id, t, {});
    return this;
  }

  mesh(id: string, m: MeshInput): this {
    this.node(id, m, { mesh: { geometry: m.geometry, materialId: m.material } });
    return this;
  }

  /** Add a shared prop material once (idempotent by id), so prop builders don't duplicate it. */
  private ensureMaterial(id: string, color: Vec3): void {
    if (this.propMats.has(id) || this.doc.materials!.some((m) => m.id === id)) return;
    this.doc.materials!.push({ id, color } as any);
    this.propMats.add(id);
  }

  /**
   * A procedural tree prop, parented to a group `id` you can position/scale. `position` is the
   * tree's base on the ground. Two variants:
   * - "conifer" (default): a cylinder trunk with a root flare + three stacked, slightly offset
   *   foliage cones (tiered like a fir), the base tier keeping the classic `__leaves` node id.
   * - "broadleaf": a taller trunk, two angled branches, and a lumpy organic canopy — a sphere
   *   whose vertices are displaced by smooth deterministic noise (welded normals, no seams).
   * Fully deterministic: all per-tree variation is hashed from the node `id`, never random —
   * two builds of the same scene are identical. Adds shared "prop_bark"/"prop_leaves" materials.
   */
  tree(
    id: string,
    opts: TransformInput & { height?: number; trunkColor?: Vec3; leafColor?: Vec3; variant?: "conifer" | "broadleaf" } = {},
  ): this {
    const h = opts.height ?? 2.4;
    const variant = opts.variant ?? "conifer";
    this.ensureMaterial("prop_bark", opts.trunkColor ?? [0.40, 0.26, 0.13]);
    this.ensureMaterial("prop_leaves", opts.leafColor ?? [0.16, 0.42, 0.17]);
    this.group(id, opts);
    // Per-tree variation, hashed from the id (deterministic).
    const j1 = hash01(id, 1) - 0.5, j2 = hash01(id, 2) - 0.5, j3 = hash01(id, 3) - 0.5;

    if (variant === "broadleaf") {
      const trunkH = h * 0.52, trunkR = h * 0.035;
      this.node(`${id}__trunk`, { parent: id, position: [0, trunkH / 2, 0], rotation: [0, 0, j1 * 0.12] },
        { mesh: { geometry: { kind: "cylinder", radius: trunkR, height: trunkH, segments: 10 }, materialId: "prop_bark" } });
      this.node(`${id}__flare`, { parent: id, position: [0, h * 0.05, 0] },
        { mesh: { geometry: { kind: "cone", radius: trunkR * 2.1, height: h * 0.12, segments: 10 }, materialId: "prop_bark" } });
      // Two angled branches reaching into the canopy.
      for (const [k, side] of [[1, -1], [2, 1]] as const) {
        this.node(`${id}__branch${k}`, {
          parent: id,
          position: [side * h * 0.04, trunkH * 0.88, 0],
          rotation: [j2 * 0.4, 0, side * (0.55 + Math.abs(j3) * 0.3)],
        }, { mesh: { geometry: { kind: "cylinder", radius: trunkR * 0.55, height: h * 0.34, segments: 8 }, materialId: "prop_bark" } });
      }
      // Lumpy organic canopy: a main crown + a smaller offset blob for silhouette variety.
      const crownR = h * 0.30;
      this.node(`${id}__leaves`, {
        parent: id,
        position: [j1 * h * 0.06, trunkH + crownR * 0.58, j2 * h * 0.06],
        scale: [1.2, 0.88, 1.2],
      }, { mesh: { geometry: { kind: "mesh", data: lumpyCanopy(crownR, hash01(id, 4) * 100) }, materialId: "prop_leaves" } });
      this.node(`${id}__leaves1`, {
        parent: id,
        position: [j3 * h * 0.3, trunkH + crownR * 0.35, j1 * h * 0.24],
        scale: [1, 0.85, 1],
      }, { mesh: { geometry: { kind: "mesh", data: lumpyCanopy(crownR * 0.62, hash01(id, 5) * 100) }, materialId: "prop_leaves" } });
      // Darker under-canopy blob: fakes the shaded interior mass beneath the crown. It
      // follows the tree's leaf tone (an autumn canopy must not shade to green); the
      // legacy green stays exact when no leafColor is given.
      const leaf = opts.leafColor;
      this.ensureMaterial("prop_leaves_dark", leaf ? [leaf[0] * 0.6, leaf[1] * 0.6, leaf[2] * 0.6] : [0.10, 0.28, 0.11]);
      this.node(`${id}__leaves2`, {
        parent: id,
        position: [-j3 * h * 0.16, trunkH + crownR * 0.12, -j2 * h * 0.16],
        scale: [1.05, 0.7, 1.05],
      }, { mesh: { geometry: { kind: "mesh", data: lumpyCanopy(crownR * 0.72, hash01(id, 6) * 100) }, materialId: "prop_leaves_dark" } });
      return this;
    }

    // Conifer: trunk + root flare + three tiered cones (base tier keeps the `__leaves` id).
    const trunkH = h * 0.42, trunkR = h * 0.05, leafR = h * 0.28;
    this.node(`${id}__trunk`, { parent: id, position: [0, trunkH / 2, 0] },
      { mesh: { geometry: { kind: "cylinder", radius: trunkR, height: trunkH, segments: 10 }, materialId: "prop_bark" } });
    this.node(`${id}__flare`, { parent: id, position: [0, h * 0.04, 0] },
      { mesh: { geometry: { kind: "cone", radius: trunkR * 1.9, height: h * 0.1, segments: 10 }, materialId: "prop_bark" } });
    const tiers = [
      { r: leafR, len: h * 0.42, y: trunkH + h * 0.14 },
      { r: leafR * 0.74, len: h * 0.36, y: trunkH + h * 0.34 },
      { r: leafR * 0.5, len: h * 0.30, y: trunkH + h * 0.52 },
    ];
    tiers.forEach((t, k) => {
      const jx = [j1, j2, j3][k]! * h * 0.05;
      const jz = [j2, j3, j1][k]! * h * 0.05;
      this.node(k === 0 ? `${id}__leaves` : `${id}__leaves${k}`, { parent: id, position: [jx, t.y + t.len / 2, jz] },
        { mesh: { geometry: { kind: "cone", radius: t.r, height: t.len, segments: 12 }, materialId: "prop_leaves" } });
    });
    return this;
  }

  /**
   * A field of grass blades scattered over a rectangular area — ONE inline mesh per tone (not a
   * node per blade), so hundreds of blades cost two draw batches. Each blade is a tapered,
   * randomly bent quad; placement/height/lean/tone all hash off the id (deterministic).
   * `position` is the patch center on the ground.
   */
  grass(
    id: string,
    opts: TransformInput & { area?: [number, number]; count?: number; height?: number; color?: Vec3; colorDark?: Vec3 } = {},
  ): this {
    const [aw, ad] = opts.area ?? [10, 10];
    const count = opts.count ?? 400;
    const maxH = opts.height ?? 0.35;
    this.ensureMaterial("prop_grass", opts.color ?? [0.3, 0.55, 0.22]);
    this.ensureMaterial("prop_grass_dark", opts.colorDark ?? [0.2, 0.42, 0.16]);
    this.group(id, opts);

    const light = { positions: [] as number[], normals: [] as number[], indices: [] as number[] };
    const dark = { positions: [] as number[], normals: [] as number[], indices: [] as number[] };
    for (let i = 0; i < count; i++) {
      const bx = (hash01(id, i * 7 + 1) - 0.5) * aw;
      const bz = (hash01(id, i * 7 + 2) - 0.5) * ad;
      const h = maxH * (0.6 + 0.4 * hash01(id, i * 7 + 3));
      const ang = hash01(id, i * 7 + 4) * Math.PI; // blade facing
      const lean = (hash01(id, i * 7 + 5) - 0.5) * 0.6 * h; // tip offset (wind-bent)
      const leanAng = hash01(id, i * 7 + 6) * Math.PI * 2;
      const wBase = 0.015 + 0.02 * hash01(id, i * 7 + 7);
      const dx = Math.cos(ang) * wBase, dz = Math.sin(ang) * wBase;
      const tipX = bx + Math.cos(leanAng) * lean, tipZ = bz + Math.sin(leanAng) * lean;
      const m = hash01(id, i * 7 + 5) < 0.5 ? light : dark;
      const base = m.positions.length / 3;
      // Tapered quad: two base verts, two near-coincident tip verts.
      m.positions.push(bx - dx, 0, bz - dz, bx + dx, 0, bz + dz, tipX + dx * 0.15, h, tipZ + dz * 0.15, tipX - dx * 0.15, h, tipZ - dz * 0.15);
      // Up-facing normals: blades take the ground's lighting (no dark backsides, no culling issues).
      for (let k = 0; k < 4; k++) m.normals.push(0, 1, 0);
      m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    this.node(`${id}__blades`, { parent: id }, { mesh: { geometry: { kind: "mesh", data: light }, materialId: "prop_grass" } });
    this.node(`${id}__blades_dark`, { parent: id }, { mesh: { geometry: { kind: "mesh", data: dark }, materialId: "prop_grass_dark" } });
    return this;
  }

  /** A faceted boulder prop: a squashed low-poly sphere. `position` is its base on the ground. */
  rock(id: string, opts: TransformInput & { radius?: number; color?: Vec3 } = {}): this {
    const r = opts.radius ?? 0.5;
    const sy = opts.scale?.[1] ?? 0.65;
    const [px, py, pz] = opts.position ?? [0, 0, 0];
    this.ensureMaterial("prop_stone", opts.color ?? [0.5, 0.5, 0.52]);
    this.node(id, { ...opts, position: [px, py + r * sy, pz], scale: [opts.scale?.[0] ?? 1, sy, opts.scale?.[2] ?? 1] },
      { mesh: { geometry: { kind: "sphere", radius: r, segments: 6 }, materialId: "prop_stone" } });
    return this;
  }

  /**
   * A textured quad standing upright (facing +z), pivot at its bottom-center: the primitive
   * behind surface-pack props (signs, posters, screens). `texture` is inline RGBA (e.g. from
   * `loadSurface()`); width/height are world units. Double-sided via `back: true` (adds a
   * mirrored quad so the board reads from behind).
   */
  texturedQuad(
    id: string,
    opts: TransformInput & {
      texture: { width: number; height: number; data: Uint8Array };
      /** Optional frame sequence (animated texture): drive it with animate(id, "texture.frame", …). */
      frames?: { width: number; height: number; data: Uint8Array }[];
      width: number;
      height: number;
      back?: boolean;
      roughness?: number;
    },
  ): this {
    const w = opts.width / 2, h = opts.height;
    // Front/back sit ±e apart — coplanar faces z-fight and the mirrored back can win.
    const e = 0.002;
    const positions = [-w, 0, e, w, 0, e, w, h, e, -w, h, e];
    const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    const uvs = [0, 1, 1, 1, 1, 0, 0, 0]; // texture row 0 = top
    const indices = [0, 1, 2, 0, 2, 3];
    if (opts.back) {
      positions.push(-w, 0, -e, w, 0, -e, w, h, -e, -w, h, -e);
      normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
      uvs.push(1, 1, 0, 1, 0, 0, 1, 0); // mirrored so text isn't backwards from behind
      indices.push(4, 6, 5, 4, 7, 6);
    }
    // Per-quad material: a shared one would silently pin every quad to the FIRST caller's
    // roughness (a matte sign and a glossy screen must coexist).
    this.material(`${id}__surface`, { color: [1, 1, 1], roughness: opts.roughness ?? 0.85 });
    this.node(id, opts, {
      mesh: {
        geometry: { kind: "mesh", data: { positions, normals, uvs, indices, texture: opts.texture, ...(opts.frames ? { textureFrames: opts.frames } : {}) } },
        materialId: `${id}__surface`,
      },
    });
    return this;
  }

  /**
   * Add a rigged character from a loaded rig (see `loadGltfRig`). Creates a group node `id` you can
   * position/animate (move it to make the character walk across the scene), the joint hierarchy, the
   * skin, the clips, and a skinned mesh node `${id}__mesh`. The mesh vertices are returned by
   * `characterMeshes()` — pass them to the renderer via `RenderOptions.meshes`.
   */
  character(id: string, rig: CharacterRig, opts: CharacterInput = {}): this {
    const jid = (j: string) => `${id}/${j}`;
    // Group node: the character handle. Animate its position to walk the whole skeleton.
    this.node(id, opts, opts.ik ? { ik: { feet: opts.ik.feet.map(jid), ground: opts.ik.ground, lock: opts.ik.lock } } : {});

    for (const j of rig.jointNodes) {
      this.doc.nodes!.push({
        id: jid(j.id),
        parent: j.parent ? jid(j.parent) : id, // root joints hang off the group
        position: j.translation,
        quaternion: j.rotation,
        scale: j.scale,
      } as any);
    }

    this.doc.skins = this.doc.skins ?? [];
    this.doc.skins.push({ id: `${id}__skin`, joints: rig.joints.map(jid), inverseBindMatrices: rig.inverseBindMatrices });

    this.doc.clips = this.doc.clips ?? [];
    for (const c of rig.clips) {
      this.doc.clips.push({
        id: `${id}/${c.id}`,
        durationFrames: c.durationFrames,
        channels: c.channels.map((ch) => ({ ...ch, jointNodeId: jid(ch.jointNodeId) })),
      });
    }

    const clipName = opts.clip ?? rig.clips[0]?.id;
    const clip = clipName ? { clipId: `${id}/${clipName}`, loop: opts.loop, speed: opts.speed, startFrame: opts.startFrame, blendInFrames: opts.blendIn } : undefined;
    // One mesh node per skinned mesh (body + garments), all bound to the same skin. The clip poses
    // shared joints, so it rides on the first mesh node only. Each mesh keeps its own texture.
    const meshes = rig.meshes ?? [rig.mesh];
    meshes.forEach((meshData, k) => {
      this.doc.nodes!.push({
        id: k === 0 ? `${id}__mesh` : `${id}__mesh${k}`,
        // Inline the skinned mesh so the scene document stays self-contained (CLI-renderable).
        mesh: { geometry: { kind: "mesh", data: meshData }, materialId: opts.material, skinId: `${id}__skin` },
        clip: k === 0 ? clip : undefined,
      } as any);
    });
    return this;
  }

  /**
   * Queue another clip on a character (see `character()`), crossfading over whatever is playing
   * at `startFrame`: the new clip ramps in over `blendIn` frames (smoothstep, default 10) on top
   * of the previous pose. Chain calls to sequence idle → walk → run on one skeleton. Playbacks
   * composite in startFrame order at runtime, so call order doesn't matter. Throws if the
   * character or the clip name doesn't exist (the runtime would otherwise silently skip it).
   */
  playClip(
    characterId: string,
    clip: string,
    opts: { startFrame: number; blendIn?: number; speed?: number; loop?: boolean },
  ): this {
    // Locate the clip-hosting node structurally (skin binding), falling back to the naming
    // convention — robust to future character builders that name their mesh nodes differently.
    const mesh = this.doc.nodes!.find(
      (n) => n.id === `${characterId}__mesh` || (n.mesh?.skinId === `${characterId}__skin` && (n.clip || n.clips)),
    );
    if (!mesh) throw new Error(`playClip: no character '${characterId}' (expected node '${characterId}__mesh')`);
    const clipId = `${characterId}/${clip}`;
    if (!this.doc.clips?.some((c) => c.id === clipId)) {
      const available = (this.doc.clips ?? [])
        .filter((c) => c.id.startsWith(`${characterId}/`))
        .map((c) => c.id.slice(characterId.length + 1));
      throw new Error(`playClip: character '${characterId}' has no clip '${clip}' (available: ${available.join(", ") || "none"})`);
    }
    // Migrate the legacy single field into the ordered list without dropping either source.
    mesh.clips = [...(mesh.clip ? [mesh.clip] : []), ...(mesh.clips ?? [])];
    delete mesh.clip;
    mesh.clips.push({
      clipId,
      startFrame: opts.startFrame,
      blendInFrames: opts.blendIn ?? 10,
      speed: opts.speed,
      loop: opts.loop,
    });
    return this;
  }

  light(props: LightInput, id?: string): this {
    const nid = id ?? `__light${this.lightCount++}`;
    this.node(nid, props, {
      light: {
        type: props.type,
        color: props.color,
        intensity: props.intensity,
        direction: props.direction,
        decay: props.decay,
        skyColor: props.skyColor,
        groundColor: props.groundColor,
      },
    });
    return this;
  }

  /**
   * Set a gradient sky background (top color → horizon color). Pass `sun` to draw a visible
   * sun disc + glow, placed to match the first directional light's direction.
   */
  sky(
    top: Vec3,
    bottom: Vec3,
    opts: { sun?: { size?: number; glow?: number; color?: Vec3 } | true; ambient?: number } = {},
  ): this {
    const sun = opts.sun === true ? {} : opts.sun;
    this.doc.environment = { ...(this.doc.environment ?? {}), sky: { type: "gradient", top, bottom, sun, ambient: opts.ambient } };
    return this;
  }

  /** Linear distance fog: geometry fades toward `color` between `near` and `far` (camera units). */
  fog(color: Vec3, near: number, far: number): this {
    this.doc.environment = { ...(this.doc.environment ?? {}), fog: { color, near, far } };
    return this;
  }

  camera(c: CameraInput, id = "__camera"): this {
    this.node(id, c, {});
    this.doc.camera = { id: c.id, nodeId: id, fov: c.fov, near: c.near, far: c.far, lookAt: c.lookAt, lookAtNodeId: c.lookAtNodeId };
    return this;
  }

  /** Add a named camera (for multi-shot scenes). Reference it from `shot()`. */
  addCamera(id: string, c: CameraInput): this {
    const nodeId = `__cam_${id}`;
    this.node(nodeId, c, {});
    this.doc.cameras = this.doc.cameras ?? [];
    this.doc.cameras.push({ id, nodeId, fov: c.fov, near: c.near, far: c.far, lookAt: c.lookAt, lookAtNodeId: c.lookAtNodeId });
    return this;
  }

  /** Film `[startFrame, endFrame]` (inclusive) with camera `cameraId` — a cut in the shot timeline. */
  shot(cameraId: string, startFrame: number, endFrame: number): this {
    this.doc.shots = this.doc.shots ?? [];
    this.doc.shots.push({ cameraId, startFrame, endFrame });
    return this;
  }

  /**
   * Orbit preset: a named camera that circles `target` at `radius`/`height`, looking at it, over
   * `[startFrame, endFrame]`. (Dolly/crane/track are just `addCamera` + `animate`/`lookAtNodeId`.)
   */
  orbit(
    id: string,
    opts: { target: Vec3; radius: number; height?: number; startFrame: number; endFrame: number; revolutions?: number; fov?: number; samples?: number },
  ): this {
    const nodeId = `__cam_${id}`;
    const height = opts.height ?? opts.target[1];
    const revolutions = opts.revolutions ?? 1;
    const samples = opts.samples ?? 24;
    this.node(nodeId, { position: [opts.target[0] + opts.radius, height, opts.target[2]] }, {});
    this.doc.cameras = this.doc.cameras ?? [];
    this.doc.cameras.push({ id, nodeId, fov: opts.fov, lookAt: opts.target });
    const keyframes: Keyframes = [];
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const ang = t * revolutions * 2 * Math.PI;
      keyframes.push({
        frame: Math.round(opts.startFrame + t * (opts.endFrame - opts.startFrame)),
        value: [opts.target[0] + Math.cos(ang) * opts.radius, height, opts.target[2] + Math.sin(ang) * opts.radius],
      });
    }
    this.doc.animation!.push({ target: { nodeId, path: "position" }, keyframes });
    return this;
  }

  /**
   * Drive a morph target from beat/onset frames — the lip-sync/viseme workhorse: at every beat
   * the weight ramps up over `attack` frames, holds, and falls over `release`. Overlapping
   * beats merge (max wins) so fast speech doesn't flutter. Works for any morph: "mouthOpen"
   * on audio beats, a blink on cut points, an emote on a story beat.
   */
  lipsync(
    nodeId: string,
    morph: string,
    beatFrames: number[],
    opts: { weight?: number; attack?: number; hold?: number; release?: number } = {},
  ): this {
    const { weight = 1, attack = 2, hold = 3, release = 4 } = opts;
    if (beatFrames.length === 0) return this;
    // Envelope per beat → merged piecewise-max, sampled at every envelope breakpoint.
    const beats = [...beatFrames].sort((a, b) => a - b);
    const level = (f: number): number => {
      let v = 0;
      for (const b of beats) {
        if (f < b || f > b + attack + hold + release) continue;
        const t = f - b;
        v = Math.max(v, t < attack ? t / attack : t <= attack + hold ? 1 : 1 - (t - attack - hold) / release);
      }
      return v * weight;
    };
    const frames = new Set<number>();
    for (const b of beats) {
      for (const off of [0, attack, attack + hold, attack + hold + release]) frames.add(b + off);
    }
    const keyframes: Keyframes = [...frames]
      .sort((a, b) => a - b)
      .map((frame) => ({ frame, value: level(frame) }));
    this.doc.animation!.push({ target: { nodeId, path: `morph.${morph}` }, keyframes });
    return this;
  }

  /** Make a node a spring bone: its rotation lags the animation by `smoothing` per frame. */
  spring(nodeId: string, smoothing: number): this {
    const node = this.doc.nodes!.find((n) => n.id === nodeId) as { spring?: unknown } | undefined;
    if (!node) throw new Error(`spring: no node '${nodeId}'`);
    node.spring = { smoothing };
    return this;
  }

  animate(nodeId: string, path: string, keyframes: Keyframes): this {
    this.doc.animation!.push({ target: { nodeId, path }, keyframes });
    return this;
  }

  animateMaterial(materialId: string, path: string, keyframes: Keyframes): this {
    this.doc.animation!.push({ target: { materialId, path }, keyframes });
    return this;
  }

  /** Animate the environment ("sky.top", "fog.near", "background", …) — in-film time-of-day. */
  animateEnv(path: string, keyframes: Keyframes): this {
    this.doc.animation!.push({ target: { environment: true, path } as never, keyframes });
    return this;
  }

  /**
   * Add a screen-space text overlay (title / caption / lower-third), drawn on top of the render.
   * Position is normalized [0..1] (origin top-left); `align` anchors horizontally, `y` is the line's
   * vertical center. Animate it with `animateOverlay(id, "opacity"|"x"|"y"|"size"|"color", …)`.
   */
  text(id: string, text: string, opts: TextInput = {}): this {
    this.doc.overlays = this.doc.overlays ?? [];
    this.doc.overlays.push({ id, text, ...opts });
    return this;
  }

  /** Animate a text overlay property: "opacity" | "x" | "y" | "size" (numbers) or "color" (vec3). */
  animateOverlay(overlayId: string, path: string, keyframes: Keyframes): this {
    this.doc.animation!.push({ target: { overlayId, path }, keyframes });
    return this;
  }

  /**
   * Title-card preset: centered text that fades in over `fade` frames at `startFrame`, holds, then
   * fades out by `endFrame` (defaults to the scene end). Any `TextInput` overrides the look.
   */
  title(
    id: string,
    text: string,
    opts: TextInput & { startFrame?: number; endFrame?: number; fade?: number } = {},
  ): this {
    const { startFrame = 0, endFrame, fade = 8, ...look } = opts;
    const end = endFrame ?? this.doc.meta.durationFrames;
    this.text(id, text, { y: 0.5, size: 96, align: "center", ...look });
    this.animateOverlay(id, "opacity", [
      { frame: startFrame, value: 0 },
      { frame: Math.min(startFrame + fade, end), value: 1, easing: "easeOut" },
      { frame: Math.max(end - fade, startFrame + fade), value: 1 },
      { frame: end, value: 0, easing: "easeIn" },
    ]);
    return this;
  }

  /** Add a deterministic particle system (leaves, dust, rain, sparks). See ParticlesSchema. */
  particles(id: string, opts: {
    position?: Vec3; spread?: Vec3; count?: number; velocity?: Vec3; velocitySpread?: Vec3;
    gravity?: Vec3; lifeFrames?: number; startFrame?: number; loop?: boolean;
    size?: number; color?: Vec3; opacity?: number; seed?: number; streak?: number;
  } = {}): this {
    (this.doc as { particles?: unknown[] }).particles = (this.doc as { particles?: unknown[] }).particles ?? [];
    (this.doc as { particles?: unknown[] }).particles!.push({ id, ...opts });
    return this;
  }

  gravity(g: Vec3): this {
    this.doc.physics = { ...(this.doc.physics ?? { bodies: [] }), gravity: g } as any;
    return this;
  }

  body(nodeId: string, b: BodyInput): this {
    this.doc.physics = this.doc.physics ?? ({ bodies: [] } as any);
    (this.doc.physics as any).bodies.push({ nodeId, ...b });
    return this;
  }

  audio(assetId: string, opts: { gain?: number; beats?: number[] } = {}): this {
    this.doc.audio = { assetId, gain: opts.gain, beats: opts.beats };
    return this;
  }

  /** Validate and produce the final SceneDocument. */
  build(): SceneDocument {
    return parseDocument(this.doc);
  }

  /** The raw (unvalidated) input — useful for serialization/round-trip tooling. */
  toJSON(): SceneDocumentInput {
    return this.doc;
  }
}

export function scene(meta: MetaInput): SceneBuilder {
  return new SceneBuilder(meta);
}

// Re-export the core math/geometry helpers authoring code commonly needs (e.g. building a
// procedural rig), so scenes can import everything from `@vsim/authoring`.
export { tessellate, mat4, v3, quatFromEuler } from "@vsim/core";
export type { Vec3, Quat, Mat4, MeshData, Clip } from "@vsim/core";

/** Beat onsets as FRAME indices for a constant tempo — the unit that keeps audio-reactive
 * motion reproducible (frame-locked, not wall-clock). */
export function beatsFromBPM(bpm: number, fps: number, durationFrames: number): number[] {
  const framesPerBeat = (60 / bpm) * fps;
  const beats: number[] = [];
  for (let f = 0; f < durationFrames; f += framesPerBeat) beats.push(Math.round(f));
  return beats;
}

/** Build scale-pulse keyframes that pop on each beat frame and decay back. Deterministic
 * because beats are frame indices, so the render matches the preview exactly. */
export function pulseKeyframes(
  beats: number[],
  opts: { base?: number; peak?: number; release?: number } = {},
): { frame: number; value: number[]; easing: string }[] {
  const base = opts.base ?? 1;
  const peak = opts.peak ?? 1.4;
  const release = opts.release ?? 8;
  const kfs: { frame: number; value: number[]; easing: string }[] = [];
  if (beats[0] !== 0) kfs.push({ frame: 0, value: [base, base, base], easing: "linear" });
  for (const fb of beats) {
    kfs.push({ frame: fb, value: [peak, peak, peak], easing: "easeOut" });
    kfs.push({ frame: fb + release, value: [base, base, base], easing: "easeOut" });
  }
  return kfs.sort((a, b) => a.frame - b.frame);
}
