// Example 10 — an original cartoon puppy walking on grass.
//
// A procedural quadruped (built in code — NOT any branded character): body, head with a snout and
// two floppy ears, a waggy tail, and four legs in a diagonal walk gait. No external assets.
import {
  scene, tessellate, quatFromEuler, mat4,
  type CharacterRig, type MeshData, type Vec3, type Quat,
} from "@vsim/authoring";

const JOINTS: { id: string; parent?: string; local: Vec3 }[] = [
  { id: "body", local: [0, 0.5, 0] },
  { id: "head", parent: "body", local: [0.55, 0.2, 0] },
  { id: "tail", parent: "body", local: [-0.55, 0.05, 0] },
  { id: "legFL", parent: "body", local: [0.32, -0.05, 0.17] },
  { id: "legFR", parent: "body", local: [0.32, -0.05, -0.17] },
  { id: "legBL", parent: "body", local: [-0.32, -0.05, 0.17] },
  { id: "legBR", parent: "body", local: [-0.32, -0.05, -0.17] },
];
const INDEX = new Map(JOINTS.map((j, i) => [j.id, i]));

// Box parts (world bind space) bound 100% to a joint. Snout + ears ride the head; tail its own joint.
const LIMBS: { joint: string; center: Vec3; size: Vec3 }[] = [
  { joint: "body", center: [0, 0.5, 0], size: [0.95, 0.4, 0.42] },
  { joint: "head", center: [0.62, 0.72, 0], size: [0.38, 0.36, 0.36] },
  { joint: "head", center: [0.86, 0.66, 0], size: [0.22, 0.18, 0.22] }, // snout
  { joint: "head", center: [0.56, 0.98, 0.14], size: [0.11, 0.24, 0.1] }, // ear L
  { joint: "head", center: [0.56, 0.98, -0.14], size: [0.11, 0.24, 0.1] }, // ear R
  { joint: "tail", center: [-0.72, 0.6, 0], size: [0.34, 0.12, 0.12] },
  { joint: "legFL", center: [0.32, 0.22, 0.17], size: [0.14, 0.46, 0.14] },
  { joint: "legFR", center: [0.32, 0.22, -0.17], size: [0.14, 0.46, 0.14] },
  { joint: "legBL", center: [-0.32, 0.22, 0.17], size: [0.14, 0.46, 0.14] },
  { joint: "legBR", center: [-0.32, 0.22, -0.17], size: [0.14, 0.46, 0.14] },
];

const worldBind = (id: string): Vec3 => {
  const j = JOINTS.find((x) => x.id === id)!;
  const p = j.parent ? worldBind(j.parent) : [0, 0, 0];
  return [p[0] + j.local[0], p[1] + j.local[1], p[2] + j.local[2]];
};

/** Rotation keyframes about an axis. `kfs` = [frame, radians]. */
const swing = (joint: string, axis: "x" | "y" | "z", kfs: [number, number][]) => ({
  jointNodeId: joint,
  path: "rotation" as const,
  interpolation: "linear" as const,
  times: kfs.map((k) => k[0]),
  values: kfs.flatMap((k) => quatFromEuler(axis === "x" ? k[1] : 0, axis === "y" ? k[1] : 0, axis === "z" ? k[1] : 0) as number[]),
});

function buildPuppy(): CharacterRig {
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

  // Diagonal trot: FL+BR together, FR+BL opposite (legs swing about Z = forward/back along X).
  const A: [number, number][] = [[0, 0.5], [15, -0.5], [30, 0.5]];
  const B: [number, number][] = [[0, -0.5], [15, 0.5], [30, -0.5]];
  const walk = {
    id: "walk",
    durationFrames: 30,
    channels: [
      swing("legFL", "z", A), swing("legBR", "z", A),
      swing("legFR", "z", B), swing("legBL", "z", B),
      swing("tail", "y", [[0, 0.4], [7, -0.4], [15, 0.4], [22, -0.4], [30, 0.4]]), // wag
      swing("head", "z", [[0, 0.05], [15, -0.05], [30, 0.05]]), // gentle bob
    ],
  };

  return {
    mesh,
    joints: JOINTS.map((j) => j.id),
    jointNodes: JOINTS.map((j) => ({ id: j.id, parent: j.parent, translation: j.local, rotation: [0, 0, 0, 1] as Quat, scale: [1, 1, 1] as Vec3 })),
    inverseBindMatrices: JOINTS.map((j) => mat4.invert(mat4.compose(worldBind(j.id), [0, 0, 0, 1], [1, 1, 1]))),
    clips: [walk],
  };
}

export default scene({ fps: 30, duration: 90, width: 640, height: 360, background: [0.53, 0.74, 0.96] })
  .sky([0.32, 0.52, 0.92], [0.74, 0.85, 0.97])
  .material("grass", { color: [0.27, 0.55, 0.24] })
  .material("pup", { color: [0.62, 0.42, 0.22] }) // tan
  .light({ type: "hemisphere", intensity: 0.6, skyColor: [0.55, 0.72, 0.95], groundColor: [0.3, 0.45, 0.22] })
  .light({ type: "directional", intensity: 0.85, direction: [-0.4, -1, -0.3] })
  .mesh("ground", { geometry: { kind: "plane", size: [60, 60] }, material: "grass" })
  // The puppy faces +X; walk it in +X across the field.
  .character("pup", buildPuppy(), { clip: "walk", loop: true, material: "pup" })
  .animate("pup", "position.x", [{ frame: 0, value: -3.5 }, { frame: 90, value: 3.5 }])
  .group("aim", { position: [-3.5, 0.6, 0] })
  .animate("aim", "position.x", [{ frame: 0, value: -3.5 }, { frame: 90, value: 3.5 }])
  .camera({ position: [0, 1.4, 5.5], lookAtNodeId: "aim", fov: 42 })
  .build();
