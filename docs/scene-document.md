# Scene Document reference

The `SceneDocument` is the single source of truth. Authoring (code/timeline/AI) writes it;
the runtime reads it. Defined and validated with zod in `packages/core/src/document.ts`.
All time values are **frames**. Colors are linear RGB in `[0,1]`.

```ts
SceneDocument {
  version: "0.1"
  meta: {
    fps: number              // default 30
    durationFrames: number   // required
    width, height: number    // default 1920x1080
    seed: number             // default 0 — seeds the deterministic Rng
    substeps: number         // default 4 — physics sub-steps per frame
    background: [r,g,b]
    style: "realistic" | "manga"   // manga = banded cel-shading + ink outlines
    tone: "none" | "aces"    // default "none"; "aces" = filmic rolloff for HDR highlights
  }
  assets:       Asset[]      // { id, type: "gltf"|"audio"|"texture", uri }
  materials:    Material[]
  nodes:        Node[]       // tree via `parent`
  skins:        Skin[]       // skeletons for skinned meshes
  clips:        Clip[]       // reusable joint animations (see Clips)
  animation:    Track[]
  physics?:     { gravity, bodies: Body[] }
  audio?:       { assetId, gain, beats: number[] }   // beats are FRAME indices
  environment?: Environment  // sky, sun disc, sky ambient, fog
  camera:       Camera       // the default camera
  cameras:      Camera[]     // additional named cameras (need `id`)
  shots:        Shot[]       // which camera films each frame range
  overlays:     TextOverlay[] // screen-space titles / captions
  particles:    Particles[]  // closed-form deterministic particle systems
}
```

## Material

```ts
Material {
  id: string
  color: [r,g,b]             // base albedo (linear)
  emissive: [r,g,b]
  opacity: number            // < 1 renders in the sorted, blended transparent pass
  roughness: number          // default 0.8 — 0 tight highlight … 1 diffuse
  metalness: number          // default 0 — tints specular toward the albedo (F0)
}
```

Shading is per-pixel Blinn–Phong PBR (roughness maps to a Beckmann-style
exponent) with 2× supersampling in linear light, directional shadow maps with
bilinear PCF, and point-light cube shadows.

## Node

```ts
Node {
  id: string
  parent?: string
  position, rotation, scale: [x,y,z]   // rotation is euler radians (XYZ)
  quaternion?: [x,y,z,w]     // overrides `rotation` (used by skeleton joints)
  mesh?:   { geometry, materialId?, skinId?, morphWeights? }
  light?:  Light
  clip?:   ClipPlayback      // play one clip on this node's skeleton
  clips?:  ClipPlayback[]    // layered clips, crossfaded in order (supersedes `clip`)
  ik?:     { feet: string[], ground: number, lock?: boolean }
  spring?: { smoothing: number }   // 0..0.98 — this node lags its animated rotation
}
```

### Light

```ts
Light {
  type: "ambient" | "directional" | "point" | "hemisphere"
  color: [r,g,b], intensity: number
  direction?: [x,y,z]        // directional: travel direction, e.g. [0,-1,0]
  skyColor?, groundColor?: [r,g,b]   // hemisphere: tint for up/down-facing surfaces
}
```

Directional lights cast shadow-mapped shadows in the software renderer; point
lights cast 6-face cube shadows.

### Geometry (discriminated by `kind`)

- `{ kind: "box", size: [x,y,z] }`
- `{ kind: "sphere", radius, segments }`
- `{ kind: "plane", size: [w,d] }` — lies on XZ, normal +Y
- `{ kind: "cylinder", radius, height, segments }` — axis +Y, centered, capped
- `{ kind: "cone", radius, height, segments }` — apex +Y, base at −height/2
- `{ kind: "gltf", assetId }` — mesh loaded from an `Asset`
- `{ kind: "mesh", data: {...} }` — inline mesh carried in the document:
  `positions/normals/indices`, optional `uvs`, skinning `joints/weights`,
  in-memory RGBA maps (`texture`, `normalMap`, `metallicRoughnessMap`,
  `occlusionMap`, `emissiveMap` — each `{ width, height, data: Uint8Array }`,
  mip-mapped and sampled with trilinear filtering + per-pixel LOD), and
  `morphTargets` (per-target position deltas, weighted by name)

## Animation Track

```ts
Track {
  target: { nodeId? | materialId? | cameraId? | overlayId?, path }
  keyframes: { frame, value, easing }[]    // value: number | number[]
}
```

Paths: node `"position"`, `"rotation.y"`, `"scale"`, morph weights
`"morph.<targetName>"`; material `"color"`, `"opacity"`; camera `"fov"`,
`"lookAt"`; overlay `"opacity"`, `"x"`, `"y"`, `"size"`, `"color"`.

`easing`: `"linear" | "easeIn" | "easeOut" | "easeInOut" | "step"` or a cubic-bezier
`[x1,y1,x2,y2]`. Easing shapes the segment **arriving** at the keyframe.

## Clips (skeletal animation)

A `Clip` is a reusable bundle of joint channels; a node plays clips via `clip`
(one) or `clips` (layered). A `Skin` binds a mesh to its joints:

```ts
Skin { id, joints: string[], inverseBindMatrices: number[16][] }

Clip {
  id: string
  durationFrames: number
  channels: {
    jointNodeId: string
    path: "translation" | "rotation" | "scale"   // rotation values are quaternions
    times: number[]          // frame indices, ascending
    values: number[]         // flat: vec3 per key (T/S), quat per key (R)
    interpolation: "linear" | "step" | "cubicspline"
  }[]
}

ClipPlayback {
  clipId: string
  startFrame: number         // default 0 — when this playback begins
  speed: number              // default 1
  loop: boolean              // default false
  blendInFrames: number      // default 0 — smoothstep ease-in from the pose below
}
```

With `clips: [...]`, playbacks are composited in `startFrame` order: each layer
ramps in over its `blendInFrames` **on top of** the result so far, and only the
channels a clip actually animates are overridden — unanimated joints fall
through to lower layers or the bind pose. The first layer blends from the
static bind pose: this is the graphics→animation transition, and how
`idle → walk → run` is authored (see `examples/23-crossfade`).

### IK & stance locking

```ts
ik: { feet: ["footL", "footR"], ground: 0, lock: true }
```

- `feet` + `ground` (v1): after clips/tracks pose the skeleton, if any listed
  foot joint ends up below `ground` (world Y), the node is lifted so the
  deepest foot lands exactly on it. Pure per-frame correction → scrub-safe.
- `lock: true` (v2, stance locking / root-motion extraction): while a foot is
  planted on the ground, the node shifts in X/Z so that foot's **world**
  position stays fixed between frames — an in-place walk clip stops sliding
  and instead drives real locomotion. The accumulated offset persists across
  steps and loop wraps, so each cycle advances one stride. Use on characters
  **without** authored position tracks (the clip becomes the mover). Stateful
  forward stepping like physics: replay from frame 0 reproduces the identical
  sequence.

### Spring bones (secondary motion)

```ts
spring: { smoothing: 0.85 }   // on the joint node itself
```

The node's rendered rotation exponentially lags its animated target (slerp
chase) — tails, ears, and hair get follow-through for free. `smoothing` 0 =
rigid, up to 0.98 = very floppy. Applied after clip/track evaluation;
deterministic on replay.

## Environment

```ts
Environment {
  sky?: {
    type: "flat" | "gradient"
    top, bottom: [r,g,b]     // gradient: top of frame → horizon
    sun?: { size, glow, color? }   // visible sun disc + glow; sizes are fractions
                                   // of frame height, color defaults to the light's
    ambient?: number         // sky-derived hemisphere ambient intensity
  }
  fog?: { color: [r,g,b], near, far }   // linear depth fog (camera units)
}
```

The sun disc is positioned opposite the **first directional light's** travel
direction, so the sky and the lighting/shadows always agree. `ambient` injects
a hemisphere light using the sky's own top/bottom colors — a cheap
image-based-lighting approximation that respects occlusion maps.

## Cameras, shots, overlays

```ts
Camera { id?, nodeId, fov, near, far, lookAt?, lookAtNodeId? }
Shot   { cameraId, startFrame, endFrame }   // inclusive; empty shots = default camera
TextOverlay {
  id, text, x, y,            // x/y normalized [0..1], origin top-left
  size, color, opacity, align: "left"|"center"|"right"
  box?: { color, opacity, padding }   // filled panel for lower-thirds
}
```

`lookAtNodeId` aims the camera at a node's world position every frame (a
tracking shot). Overlays are composited after the 3D render; animate them via
tracks targeting `{ overlayId, path }`.

## Particles (closed-form, deterministic)

```ts
Particles {
  id: string
  position: [x,y,z]          // emitter origin (world)
  spread: [x,y,z]            // spawn jitter half-extents
  count: number              // default 100
  velocity: [x,y,z]          // mean initial velocity (units/second)
  velocitySpread: [x,y,z]    // ± half-range per axis
  gravity: [x,y,z]           // default [0,-9.81,0]
  lifeFrames: number
  startFrame: number
  loop: boolean              // default true — staggered continuous respawn
  size: number               // radius in world units
  color: [r,g,b], opacity: number
  seed: number
}
```

Every particle's position is a **closed-form** function of (index, frame,
seed): spawn point, velocity, and stagger come from hashes; motion is ballistic
(`v·t + ½g·t²`). No integration state → scrub-safe, and two renders are always
byte-identical.

## Physics Body

```ts
Body {
  nodeId: string
  type: "dynamic" | "fixed" | "kinematic"
  collider: { shape: "box", halfExtents } | { shape: "sphere", radius } | { shape: "plane" }
  mass?, restitution, friction
  linvel?, angvel?: [x,y,z]
}
```

A body drives its node's transform each frame (physics overrides animation for
that node).

## Determinism contract

- The document + frame index fully determine every pixel: `computeFrameState(f)`
  depends only on the document (stateful features — physics, springs, stance
  lock — replay from frame 0, so scrubbing and re-rendering agree).
- All randomness flows through the seeded `Rng`; `Math.random` is lint-banned.
- The software renderer is the byte-exact oracle: golden-frame hash tests guard
  every shading feature (`UPDATE_GOLDEN=1` regenerates them intentionally).
- Band/region rendering (`SoftwareEngineOptions.region`) and the parallel
  worker renderer are byte-identical to a single-threaded render — the CLI's
  `--workers N` is safe for any scene without physics.

## Minimal example

```json
{
  "meta": { "durationFrames": 60, "tone": "aces" },
  "camera": { "nodeId": "cam", "lookAt": [0, 0, 0] },
  "materials": [{ "id": "red", "color": [1, 0.3, 0.3], "roughness": 0.4 }],
  "environment": { "sky": { "top": [0.35, 0.55, 0.92], "bottom": [0.72, 0.83, 0.96], "ambient": 0.3 } },
  "nodes": [
    { "id": "cam", "position": [0, 1, 5] },
    { "id": "sun", "light": { "type": "directional", "intensity": 1.2, "direction": [-1, -2, -1] } },
    { "id": "cube", "mesh": { "geometry": { "kind": "box" }, "materialId": "red" } }
  ]
}
```
