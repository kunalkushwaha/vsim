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
  }
  assets:    Asset[]         // { id, type: "gltf"|"audio"|"texture", uri }
  materials: Material[]      // { id, color, emissive, opacity, roughness, metalness }
  nodes:     Node[]          // tree via `parent`
  animation: Track[]
  physics?:  { gravity, bodies: Body[] }
  audio?:    { assetId, gain, beats: number[] }   // beats are FRAME indices
  camera:    { nodeId, fov, near, far, lookAt? }
}
```

## Node

```ts
Node {
  id: string
  parent?: string
  position, rotation, scale: [x,y,z]   // rotation is euler radians (XYZ)
  mesh?:  { geometry, materialId? }
  light?: { type: "ambient"|"directional"|"point", color, intensity, direction? }
}
```

### Geometry (discriminated by `kind`)

- `{ kind: "box", size: [x,y,z] }`
- `{ kind: "sphere", radius, segments }`
- `{ kind: "plane", size: [w,d] }` — lies on XZ, normal +Y
- `{ kind: "cylinder", radius, height, segments }` — axis +Y, centered, capped
- `{ kind: "cone", radius, height, segments }` — apex +Y, base at −height/2
- `{ kind: "gltf", assetId }` — mesh loaded from an `Asset`

## Animation Track

```ts
Track {
  target: { nodeId?, materialId?, path }   // path e.g. "position", "rotation.y", "scale", "color"
  keyframes: { frame, value, easing }[]    // value: number | number[]
}
```

`easing`: `"linear" | "easeIn" | "easeOut" | "easeInOut" | "step"` or a cubic-bezier
`[x1,y1,x2,y2]`. Easing shapes the segment **arriving** at the keyframe.

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

A body drives its node's transform each frame (physics overrides animation for that node).

## Minimal example

```json
{
  "meta": { "durationFrames": 60 },
  "camera": { "nodeId": "cam", "lookAt": [0, 0, 0] },
  "materials": [{ "id": "red", "color": [1, 0.3, 0.3] }],
  "nodes": [
    { "id": "cam", "position": [0, 1, 5] },
    { "id": "ambient", "light": { "type": "ambient", "intensity": 0.5 } },
    { "id": "cube", "mesh": { "geometry": { "kind": "box" }, "materialId": "red" } }
  ]
}
```
