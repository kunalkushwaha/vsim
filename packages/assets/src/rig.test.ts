import { describe, it, expect } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDocument, SceneRuntime, mat4, quatFromEuler } from "@vsim/core";
import { loadGltfRig } from "./index.js";

/**
 * Build a minimal skinned glTF (data-URI buffer, no files to download): 3-vertex mesh, 2 joints
 * (root + child one unit up), one LINEAR clip rotating the child 90° about Z over 1 second.
 * The top vertex is bound 100% to the child joint.
 */
function syntheticRigGltf(): string {
  const rotZ90 = quatFromEuler(0, 0, Math.PI / 2);
  const positions = Float32Array.from([-0.5, 0, 0, 0.5, 0, 0, 0, 2, 0]);
  const normals = Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const joints = Uint16Array.from([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]); // top vertex → joint index 1
  const weights = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const indices = Uint16Array.from([0, 1, 2]);
  const ibm = Float32Array.from([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, // joint0: identity
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1, // joint1: inverse of translate(0,1,0)
  ]);
  const animInput = Float32Array.from([0, 1]); // seconds
  const animOutput = Float32Array.from([0, 0, 0, 1, ...rotZ90]); // identity → 90° about Z

  const chunks: Buffer[] = [];
  let offset = 0;
  const view = (arr: Float32Array | Uint16Array) => {
    while (offset % 4 !== 0) { chunks.push(Buffer.from([0])); offset++; } // 4-byte align
    const b = Buffer.from(arr.buffer.slice(0));
    const rec = { buffer: 0, byteOffset: offset, byteLength: b.length };
    chunks.push(b);
    offset += b.length;
    return rec;
  };
  const bv = [
    view(positions), view(normals), view(joints), view(weights),
    view(indices), view(ibm), view(animInput), view(animOutput),
  ];
  const bin = Buffer.concat(chunks);

  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { mesh: 0, skin: 0 }, // 0: skinned mesh node
      { translation: [0, 0, 0], children: [2] }, // 1: joint0 (root)
      { translation: [0, 1, 0] }, // 2: joint1 (child)
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, JOINTS_0: 2, WEIGHTS_0: 3 }, indices: 4 }] }],
    skins: [{ joints: [1, 2], inverseBindMatrices: 5 }],
    animations: [
      { name: "walk", channels: [{ sampler: 0, target: { node: 2, path: "rotation" } }], samplers: [{ input: 6, output: 7, interpolation: "LINEAR" }] },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 3, type: "VEC4" },
      { bufferView: 3, componentType: 5126, count: 3, type: "VEC4" },
      { bufferView: 4, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 5, componentType: 5126, count: 2, type: "MAT4" },
      { bufferView: 6, componentType: 5126, count: 2, type: "SCALAR" },
      { bufferView: 7, componentType: 5126, count: 2, type: "VEC4" },
    ],
    bufferViews: bv,
    buffers: [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${bin.toString("base64")}` }],
  };

  const path = join(tmpdir(), `vsim-rig-${Date.now()}-${Math.random().toString(36).slice(2)}.gltf`);
  writeFileSync(path, JSON.stringify(json));
  return path;
}

describe("loadGltfRig", () => {
  it("extracts joints, skin, mesh attributes, and clips (seconds → frames)", async () => {
    const path = syntheticRigGltf();
    try {
      const rig = await loadGltfRig(path, 30);

      expect(rig.joints).toEqual(["joint_1", "joint_2"]);
      expect(rig.jointNodes[0]).toMatchObject({ id: "joint_1", parent: undefined, translation: [0, 0, 0] });
      expect(rig.jointNodes[1]).toMatchObject({ id: "joint_2", parent: "joint_1", translation: [0, 1, 0] });
      expect(rig.inverseBindMatrices[1]![13]).toBeCloseTo(-1, 6); // translate(0,-1,0)

      expect(rig.mesh.positions).toHaveLength(9);
      expect(rig.mesh.joints!.slice(8, 12)).toEqual([1, 0, 0, 0]); // top vertex → joint 1
      expect(rig.mesh.weights!.slice(8, 12)).toEqual([1, 0, 0, 0]);

      expect(rig.clips).toHaveLength(1);
      const clip = rig.clips[0]!;
      expect(clip.id).toBe("walk");
      expect(clip.durationFrames).toBe(30); // 1s * 30fps
      expect(clip.channels[0]).toMatchObject({ jointNodeId: "joint_2", path: "rotation", interpolation: "linear", times: [0, 30] });
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("produces runtime-ready data: the parsed rig deforms correctly end to end", async () => {
    const path = syntheticRigGltf();
    try {
      const rig = await loadGltfRig(path, 30);
      // Assemble a scene from the parsed pieces (the integration the parser enables).
      const doc = parseDocument({
        meta: { fps: 30, durationFrames: 31, width: 16, height: 16 },
        nodes: [
          ...rig.jointNodes.map((j) => ({ id: j.id, parent: j.parent, position: j.translation, scale: j.scale })),
          { id: "char", mesh: { geometry: { kind: "box", size: [0.2, 0.2, 0.2] }, skinId: "s" }, clip: { clipId: rig.clips[0]!.id } },
          { id: "__camera", position: [0, 1, 5] },
        ],
        skins: [{ id: "s", joints: rig.joints, inverseBindMatrices: rig.inverseBindMatrices }],
        clips: rig.clips,
        camera: { nodeId: "__camera", lookAt: [0, 1, 0] },
      });

      const rt = new SceneRuntime(doc);
      const jm = rt.computeFrameState(30).nodes.find((n) => n.id === "char")!.skin!.jointMatrices;
      const tip = mat4.transformPoint(jm[1]!, [0, 2, 0]); // top bind vertex, bound to joint 1
      expect(tip[0]).toBeCloseTo(-1, 4); // swung to the side
      expect(tip[1]).toBeCloseTo(1, 4);
    } finally {
      rmSync(path, { force: true });
    }
  });
});
