// Example 05 — a procedural walking character on grass under a blue sky, filmed from three angles.
//
// No external assets: the character is a small articulated figure (box limbs bound to a 7-joint
// skeleton) with a hand-authored walk clip, all built in code. It demonstrates the skeletal
// pipeline end to end — rig → clip → CPU skinning → deterministic render — plus cinematography:
// the figure strides across the field while the shot cuts from a wide establishing angle to a
// camera that tracks the character to a low close-up.
import {
  scene, tessellate, quatFromEuler, mat4,
  type CharacterRig, type MeshData, type Vec3, type Quat,
} from "@vsim/authoring";

// --- Skeleton: joint id, parent, and LOCAL bind translation (rotations are identity at bind). ---
const JOINTS: { id: string; parent?: string; local: Vec3 }[] = [
  { id: "hip", local: [0, 1.0, 0] },
  { id: "torso", parent: "hip", local: [0, 0.5, 0] },
  { id: "head", parent: "torso", local: [0, 0.55, 0] },
  { id: "armL", parent: "torso", local: [0.35, 0.35, 0] },
  { id: "armR", parent: "torso", local: [-0.35, 0.35, 0] },
  { id: "legL", parent: "hip", local: [0.18, 0, 0] },
  { id: "legR", parent: "hip", local: [-0.18, 0, 0] },
];
const INDEX = new Map(JOINTS.map((j, i) => [j.id, i]));

/** A box limb (in world bind space) bound 100% to one joint. */
const LIMBS: { joint: string; center: Vec3; size: Vec3 }[] = [
  { joint: "hip", center: [0, 1.0, 0], size: [0.45, 0.3, 0.28] },
  { joint: "torso", center: [0, 1.5, 0], size: [0.5, 0.7, 0.3] },
  { joint: "head", center: [0, 2.15, 0], size: [0.32, 0.32, 0.32] },
  { joint: "armL", center: [0.46, 1.5, 0], size: [0.16, 0.8, 0.16] },
  { joint: "armR", center: [-0.46, 1.5, 0], size: [0.16, 0.8, 0.16] },
  { joint: "legL", center: [0.18, 0.5, 0], size: [0.18, 0.95, 0.18] },
  { joint: "legR", center: [-0.18, 0.5, 0], size: [0.18, 0.95, 0.18] },
];

/** World bind translation of a joint = sum of its chain's local translations (identity rotations). */
function worldBind(id: string): Vec3 {
  const j = JOINTS.find((x) => x.id === id)!;
  const p = j.parent ? worldBind(j.parent) : [0, 0, 0];
  return [p[0] + j.local[0], p[1] + j.local[1], p[2] + j.local[2]];
}

function buildFigure(): CharacterRig {
  const mesh: MeshData = { positions: [], normals: [], indices: [], joints: [], weights: [] };
  for (const limb of LIMBS) {
    const box = tessellate({ kind: "box", size: limb.size });
    const base = mesh.positions.length / 3;
    const ji = INDEX.get(limb.joint)!;
    for (let i = 0; i < box.positions.length / 3; i++) {
      mesh.positions.push(box.positions[i * 3]! + limb.center[0], box.positions[i * 3 + 1]! + limb.center[1], box.positions[i * 3 + 2]! + limb.center[2]);
      mesh.normals.push(box.normals[i * 3]!, box.normals[i * 3 + 1]!, box.normals[i * 3 + 2]!);
      mesh.joints!.push(ji, 0, 0, 0);
      mesh.weights!.push(1, 0, 0, 0);
    }
    for (const k of box.indices) mesh.indices.push(base + k);
  }

  // Swing channel about Z (legs/arms stride forward-back along X — the travel direction).
  const qz = (a: number): Quat => quatFromEuler(0, 0, a);
  const swing = (id: string, a: number) => ({
    jointNodeId: id,
    path: "rotation" as const,
    interpolation: "linear" as const,
    times: [0, 15, 30],
    values: [...qz(a), ...qz(-a), ...qz(a)],
  });

  return {
    mesh,
    joints: JOINTS.map((j) => j.id),
    jointNodes: JOINTS.map((j) => ({ id: j.id, parent: j.parent, translation: j.local, rotation: [0, 0, 0, 1] as Quat, scale: [1, 1, 1] as Vec3 })),
    inverseBindMatrices: JOINTS.map((j) => mat4.invert(mat4.compose(worldBind(j.id), [0, 0, 0, 1], [1, 1, 1]))),
    clips: [
      {
        id: "walk",
        durationFrames: 30,
        channels: [swing("legL", 0.5), swing("legR", -0.5), swing("armL", -0.4), swing("armR", 0.4)],
      },
    ],
  };
}

export default scene({ fps: 30, duration: 90, width: 640, height: 360, background: [0.53, 0.74, 0.96] })
  .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97]) // deep blue overhead → pale at the horizon
  .material("grass", { color: [0.27, 0.55, 0.24] })
  .material("skin", { color: [0.85, 0.62, 0.45] })
  // Hemisphere fill (sky blue from above, grass green bounce from below) + a key directional.
  .light({ type: "hemisphere", intensity: 0.7, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
  .light({ type: "directional", intensity: 0.9, direction: [-0.4, -1, -0.3] })
  .mesh("ground", { geometry: { kind: "plane", size: [40, 40] }, material: "grass", position: [0, 0, 0] })
  .character("hero", buildFigure(), { clip: "walk", loop: true, material: "skin" })
  // Walk the whole figure across the field.
  .animate("hero", "position.x", [{ frame: 0, value: -3 }, { frame: 90, value: 3 }])
  // An aim point at chest height that rides along with the character, so tracking cameras frame
  // the body rather than the feet (the hero group's origin is at ground level).
  .group("heroAim", { parent: "hero", position: [0, 1.3, 0] })
  // Three camera angles: a wide establishing shot, a medium camera that tracks the character,
  // then a low close-up that also tracks it.
  .addCamera("wide", { position: [5, 3.2, 9], lookAt: [0, 1.2, 0], fov: 38 })
  .addCamera("track", { position: [0, 1.7, 5.5], lookAtNodeId: "heroAim", fov: 42 })
  .addCamera("close", { position: [2.2, 1.1, 3.4], lookAtNodeId: "heroAim", fov: 50 })
  .shot("wide", 0, 29)
  .shot("track", 30, 59)
  .shot("close", 60, 89)
  .camera({ position: [4, 2.6, 6], lookAt: [0, 1.2, 0], fov: 42 }) // fallback
  .build();
