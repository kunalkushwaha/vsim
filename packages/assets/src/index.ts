import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { mat4, v3, type Mat4, type MeshData, type Vec3 } from "@vsim/core";

/**
 * Minimal glTF 2.0 / GLB loader → merged MeshData (the "Blender asset source" pipeline).
 * Handles the common export shape: scene → nodes → mesh primitives with POSITION/NORMAL
 * and indices, baking node transforms into world-space vertices. Materials/skins/animation
 * are ignored at this layer (the SceneDocument drives those).
 */
export async function loadGltf(path: string): Promise<MeshData> {
  const file = await readFile(resolve(path));
  const isGlb = file.readUInt32LE(0) === 0x46546c67;
  const { json, glbBin } = isGlb ? parseGLB(file) : { json: JSON.parse(file.toString("utf8")), glbBin: undefined };
  const buffers = await loadBuffers(json, glbBin, dirname(resolve(path)));

  const merged: MeshData = { positions: [], normals: [], indices: [] };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots: number[] = scene?.nodes ?? json.nodes?.map((_: unknown, i: number) => i) ?? [];

  const visit = (nodeIndex: number, parentWorld: Mat4): void => {
    const node = json.nodes[nodeIndex];
    const world = mat4.multiply(parentWorld, nodeMatrix(node));
    if (node.mesh != null) appendMesh(json, buffers, json.meshes[node.mesh], world, merged);
    for (const c of node.children ?? []) visit(c, world);
  };
  for (const r of roots) visit(r, mat4.identity());
  return merged;
}

function parseGLB(buf: Buffer): { json: any; glbBin?: Buffer } {
  let off = 12;
  let json: any;
  let glbBin: Buffer | undefined;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8")); // "JSON"
    else if (type === 0x004e4942) glbBin = data; // "BIN\0"
    off += 8 + len;
  }
  if (!json) throw new Error("GLB: no JSON chunk");
  return { json, glbBin };
}

async function loadBuffers(json: any, glbBin: Buffer | undefined, baseDir: string): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (const b of json.buffers ?? []) {
    if (!b.uri) out.push(glbBin ?? Buffer.alloc(0));
    else if (b.uri.startsWith("data:")) out.push(Buffer.from(b.uri.split(",")[1], "base64"));
    else out.push(await readFile(resolve(baseDir, decodeURIComponent(b.uri))));
  }
  return out;
}

function nodeMatrix(node: any): Mat4 {
  if (node.matrix) return node.matrix as Mat4; // glTF matrices are column-major
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  return mat4.compose(t, r, s);
}

const COMP_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM_COMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(json: any, buffers: Buffer[], index: number): number[] {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const buffer = buffers[view.buffer]!;
  const numComp = NUM_COMP[acc.type]!;
  const compSize = COMP_SIZE[acc.componentType]!;
  const stride = view.byteStride ?? numComp * compSize;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[] = [];
  for (let e = 0; e < acc.count; e++) {
    let p = base + e * stride;
    for (let c = 0; c < numComp; c++) {
      out.push(readComp(buffer, p, acc.componentType));
      p += compSize;
    }
  }
  return out;
}

function readComp(buf: Buffer, p: number, compType: number): number {
  switch (compType) {
    case 5126: return buf.readFloatLE(p);
    case 5125: return buf.readUInt32LE(p);
    case 5123: return buf.readUInt16LE(p);
    case 5121: return buf.readUInt8(p);
    case 5122: return buf.readInt16LE(p);
    case 5120: return buf.readInt8(p);
    default: throw new Error(`glTF: unsupported componentType ${compType}`);
  }
}

function appendMesh(json: any, buffers: Buffer[], mesh: any, world: Mat4, merged: MeshData): void {
  for (const prim of mesh.primitives ?? []) {
    if (prim.attributes?.POSITION == null) continue;
    const pos = readAccessor(json, buffers, prim.attributes.POSITION);
    const vcount = pos.length / 3;
    const nrm = prim.attributes.NORMAL != null ? readAccessor(json, buffers, prim.attributes.NORMAL) : undefined;
    const idx = prim.indices != null ? readAccessor(json, buffers, prim.indices) : Array.from({ length: vcount }, (_, i) => i);

    const baseVertex = merged.positions.length / 3;
    for (let i = 0; i < vcount; i++) {
      const p: Vec3 = [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
      const wp = mat4.transformPoint(world, p);
      merged.positions.push(wp[0], wp[1], wp[2]);
      const n: Vec3 = nrm ? [nrm[i * 3]!, nrm[i * 3 + 1]!, nrm[i * 3 + 2]!] : [0, 1, 0];
      const wn = v3.normalize(mat4.transformDir(world, n));
      merged.normals.push(wn[0], wn[1], wn[2]);
    }
    for (const k of idx) merged.indices.push(baseVertex + k);
    if (!nrm) computeNormals(merged, baseVertex);
  }
}

/** Flat-ish smooth normals when a primitive ships without NORMAL. */
function computeNormals(merged: MeshData, fromVertex: number): void {
  const start = fromVertex * 3;
  for (let i = start; i < merged.normals.length; i++) merged.normals[i] = 0;
  for (let t = 0; t < merged.indices.length; t += 3) {
    const a = merged.indices[t]!, b = merged.indices[t + 1]!, c = merged.indices[t + 2]!;
    if (a < fromVertex) continue;
    const pa: Vec3 = [merged.positions[a * 3]!, merged.positions[a * 3 + 1]!, merged.positions[a * 3 + 2]!];
    const pb: Vec3 = [merged.positions[b * 3]!, merged.positions[b * 3 + 1]!, merged.positions[b * 3 + 2]!];
    const pc: Vec3 = [merged.positions[c * 3]!, merged.positions[c * 3 + 1]!, merged.positions[c * 3 + 2]!];
    const fn = v3.cross(v3.sub(pb, pa), v3.sub(pc, pa));
    for (const v of [a, b, c]) {
      merged.normals[v * 3] = (merged.normals[v * 3] ?? 0) + fn[0];
      merged.normals[v * 3 + 1] = (merged.normals[v * 3 + 1] ?? 0) + fn[1];
      merged.normals[v * 3 + 2] = (merged.normals[v * 3 + 2] ?? 0) + fn[2];
    }
  }
  for (let i = fromVertex; i < merged.positions.length / 3; i++) {
    const n = v3.normalize([merged.normals[i * 3]!, merged.normals[i * 3 + 1]!, merged.normals[i * 3 + 2]!]);
    merged.normals[i * 3] = n[0];
    merged.normals[i * 3 + 1] = n[1];
    merged.normals[i * 3 + 2] = n[2];
  }
}

/** Write a single-mesh GLB from MeshData. Useful for tests/fixtures and a basic exporter. */
export function writeGLB(mesh: MeshData): Buffer {
  const positions = Float32Array.from(mesh.positions);
  const normals = Float32Array.from(mesh.normals);
  const indices = Uint32Array.from(mesh.indices);
  const bin = Buffer.concat([
    Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength),
    Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength),
    Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength),
  ]);
  const pb = positions.byteLength, nb = normals.byteLength;

  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c]!, positions[i + c]!);
      max[c] = Math.max(max[c]!, positions[i + c]!);
    }
  }

  const json = {
    asset: { version: "2.0", generator: "vsim" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5125, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pb, target: 34962 },
      { buffer: 0, byteOffset: pb, byteLength: nb, target: 34962 },
      { buffer: 0, byteOffset: pb + nb, byteLength: indices.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binChunk = pad(bin, 0x00);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  return Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(binChunk.length, 0x004e4942), binChunk]);
}

function chunkHeader(len: number, type: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0);
  b.writeUInt32LE(type, 4);
  return b;
}

function pad(buf: Buffer, fill: number): Buffer {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]);
}
