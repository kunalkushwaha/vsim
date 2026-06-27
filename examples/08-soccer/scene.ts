// Example 08 — a kid plays soccer.
//
// A procedural articulated "kid" (built in code, full control over its skeleton) walks up to a
// ball and kicks it; the ball launches in an arc. The kick is a hand-authored clip on the kid's
// leg, with the ball's flight timed to the moment of contact. No external assets.
import {
  scene, tessellate, quatFromEuler, mat4,
  type CharacterRig, type MeshData, type Vec3, type Quat,
} from "@vsim/authoring";

// --- Kid skeleton: id, parent, LOCAL bind translation (rotations identity at bind). ---
const JOINTS: { id: string; parent?: string; local: Vec3 }[] = [
  { id: "hip", local: [0, 0.9, 0] },
  { id: "torso", parent: "hip", local: [0, 0.42, 0] },
  { id: "head", parent: "torso", local: [0, 0.5, 0] },
  { id: "armL", parent: "torso", local: [0.3, 0.3, 0] },
  { id: "armR", parent: "torso", local: [-0.3, 0.3, 0] },
  { id: "legL", parent: "hip", local: [0.16, 0, 0] },
  { id: "legR", parent: "hip", local: [-0.16, 0, 0] },
];
const INDEX = new Map(JOINTS.map((j, i) => [j.id, i]));

// Box limb (world bind space) bound 100% to one joint. Kid proportions: big head, short limbs.
const LIMBS: { joint: string; center: Vec3; size: Vec3 }[] = [
  { joint: "hip", center: [0, 0.9, 0], size: [0.42, 0.3, 0.26] },
  { joint: "torso", center: [0, 1.18, 0], size: [0.46, 0.55, 0.28] },
  { joint: "head", center: [0, 1.74, 0], size: [0.42, 0.42, 0.42] },
  { joint: "armL", center: [0.4, 0.95, 0], size: [0.15, 0.62, 0.15] },
  { joint: "armR", center: [-0.4, 0.95, 0], size: [0.15, 0.62, 0.15] },
  { joint: "legL", center: [0.16, 0.45, 0], size: [0.17, 0.85, 0.17] },
  { joint: "legR", center: [-0.16, 0.45, 0], size: [0.17, 0.85, 0.17] },
];

const worldBind = (id: string): Vec3 => {
  const j = JOINTS.find((x) => x.id === id)!;
  const p = j.parent ? worldBind(j.parent) : [0, 0, 0];
  return [p[0] + j.local[0], p[1] + j.local[1], p[2] + j.local[2]];
};

/** A rotation channel about Z (legs/arms swing forward-back along X). `kfs` = [frame, radians]. */
const zSwing = (joint: string, kfs: [number, number][]) => ({
  jointNodeId: joint,
  path: "rotation" as const,
  interpolation: "linear" as const,
  times: kfs.map((k) => k[0]),
  values: kfs.flatMap((k) => quatFromEuler(0, 0, k[1]) as number[]),
});

function buildKid(): CharacterRig {
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

  // Clip "kick": walk up (frames 0–40), plant, then the right leg swings forward hard (kick) at
  // ~46–52, follow through, settle. Negative Z-rotation swings the foot forward (+X).
  const kick = {
    id: "kick",
    durationFrames: 78,
    channels: [
      // approach walk cycle, then plant + kick + follow-through on the right (kicking) leg
      zSwing("legR", [[0, 0.45], [10, -0.45], [20, 0.45], [30, -0.45], [40, 0.45], [46, 0.6], [52, -1.25], [58, -0.7], [70, -0.05], [78, -0.05]]),
      // left (planting) leg: walk swing, then stays planted through the kick
      zSwing("legL", [[0, -0.45], [10, 0.45], [20, -0.45], [30, 0.45], [40, -0.2], [46, -0.05], [78, -0.05]]),
      // arms counter-swing while walking, then swing back for kick balance
      zSwing("armL", [[0, -0.35], [10, 0.35], [20, -0.35], [30, 0.35], [40, -0.2], [52, 0.5], [70, 0.1]]),
      zSwing("armR", [[0, 0.35], [10, -0.35], [20, 0.35], [30, -0.35], [40, 0.2], [52, -0.5], [70, -0.1]]),
      // slight torso lean into the kick
      zSwing("torso", [[0, 0], [46, 0.05], [52, -0.18], [60, -0.05], [78, 0]]),
    ],
  };

  return {
    mesh,
    joints: JOINTS.map((j) => j.id),
    jointNodes: JOINTS.map((j) => ({ id: j.id, parent: j.parent, translation: j.local, rotation: [0, 0, 0, 1] as Quat, scale: [1, 1, 1] as Vec3 })),
    inverseBindMatrices: JOINTS.map((j) => mat4.invert(mat4.compose(worldBind(j.id), [0, 0, 0, 1], [1, 1, 1]))),
    clips: [kick],
  };
}

export default scene({ fps: 30, duration: 90, width: 640, height: 360, background: [0.53, 0.74, 0.96] })
  .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
  .material("grass", { color: [0.27, 0.55, 0.24] })
  .material("kid", { color: [0.32, 0.55, 0.85] }) // blue jersey
  .material("ball", { color: [0.95, 0.95, 0.95] })
  .light({ type: "hemisphere", intensity: 0.6, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
  .light({ type: "directional", intensity: 0.85, direction: [-0.4, -1, -0.3] })
  .mesh("ground", { geometry: { kind: "plane", size: [60, 60] }, material: "grass" })
  // The kid walks up to the ball over the approach, then plants for the kick.
  .character("kid", buildKid(), { clip: "kick", loop: false, material: "kid" })
  .animate("kid", "position.x", [{ frame: 0, value: -1.8 }, { frame: 44, value: 0 }, { frame: 90, value: 0 }])
  // Soccer ball: sits in front of the kid, then launches in an arc at the moment of contact (~f52).
  .mesh("ball", { geometry: { kind: "sphere", radius: 0.22, segments: 20 }, material: "ball", position: [0.55, 0.22, 0] })
  .animate("ball", "position", [
    { frame: 0, value: [0.55, 0.22, 0] },
    { frame: 52, value: [0.55, 0.22, 0] },
    { frame: 66, value: [4.0, 1.7, 0], easing: "easeOut" },
    { frame: 84, value: [7.5, 0.22, 0], easing: "easeIn" },
  ])
  .animate("ball", "rotation.z", [{ frame: 52, value: 0 }, { frame: 84, value: -10 }]) // spin as it flies
  .camera({ position: [2.5, 2.0, 8], lookAt: [2.2, 0.9, 0], fov: 42 })
  .build();
