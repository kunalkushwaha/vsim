import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadGltfRig, parseGltfRigData } from "./index.js";

const foxPath = fileURLToPath(new URL("../library/fox.glb", import.meta.url));

describe("parseGltfRigData (browser-path rig parsing, R5.1)", () => {
  it("parses raw bytes identically to the filesystem loader", async () => {
    const viaFs = await loadGltfRig(foxPath, 30);
    const file = await readFile(foxPath);
    // Plain Uint8Array copy — proves no Buffer methods are required on the input.
    const viaData = parseGltfRigData(new Uint8Array(file), 30);
    expect(viaData.joints).toEqual(viaFs.joints);
    expect(viaData.clips.map((c) => ({ id: c.id, durationFrames: c.durationFrames, channels: c.channels.length })))
      .toEqual(viaFs.clips.map((c) => ({ id: c.id, durationFrames: c.durationFrames, channels: c.channels.length })));
    expect(viaData.mesh.positions).toEqual(viaFs.mesh.positions);
    expect(viaData.inverseBindMatrices).toEqual(viaFs.inverseBindMatrices);
  });

  it("accepts an ArrayBuffer (the fetch() result shape)", async () => {
    const file = await readFile(foxPath);
    const ab = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const rig = parseGltfRigData(ab, 30);
    expect(rig.joints.length).toBeGreaterThan(0);
    expect(rig.clips.length).toBeGreaterThan(0);
  });

  it("throws a clear error on external buffer URIs instead of failing silently", () => {
    const gltf = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "model.bin", byteLength: 4 }] }));
    expect(() => parseGltfRigData(gltf, 30)).toThrow(/external buffer URI/);
  });
});
