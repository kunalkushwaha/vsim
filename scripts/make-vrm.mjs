// Turn a rigged GLB into a VRM 1.0 avatar by injecting the standard `VRMC_vrm` extension: a humanoid
// bone map (VRM role -> glTF node) plus license/meta. VRM is just glTF + this extension, so the
// result is a valid .vrm that any VRM tool — and vsim's loadVrm — can read. We use it to bundle a
// CC0 sample avatar built from a MakeHuman human (so it's license-clean and redistributable).
//
//   node scripts/make-vrm.mjs <in.glb> <out.vrm>
import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) throw new Error("usage: make-vrm.mjs <in.glb> <out.vrm>");

// --- read the GLB: header + JSON chunk + BIN chunk ---
const buf = readFileSync(inPath);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
let off = 12, json, bin;
while (off + 8 <= buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
  else if (type === 0x004e4942) bin = data;
  off += 8 + len;
}
if (!json) throw new Error("no JSON chunk");

// --- map our game_engine rig bones to VRM humanoid roles ---
const ROLE = {
  hips: "pelvis", spine: "spine_01", chest: "spine_02", upperChest: "spine_03",
  neck: "neck_01", head: "head",
  leftShoulder: "clavicle_l", leftUpperArm: "upperarm_l", leftLowerArm: "lowerarm_l", leftHand: "hand_l",
  rightShoulder: "clavicle_r", rightUpperArm: "upperarm_r", rightLowerArm: "lowerarm_r", rightHand: "hand_r",
  leftUpperLeg: "thigh_l", leftLowerLeg: "calf_l", leftFoot: "foot_l", leftToes: "ball_l",
  rightUpperLeg: "thigh_r", rightLowerLeg: "calf_r", rightFoot: "foot_r", rightToes: "ball_r",
};
const nodeIndex = (name) => json.nodes.findIndex((n) => n.name === name);
const humanBones = {};
for (const [role, bone] of Object.entries(ROLE)) {
  const node = nodeIndex(bone);
  if (node >= 0) humanBones[role] = { node };
}
const required = ["hips", "spine", "chest", "neck", "head", "leftUpperArm", "leftLowerArm", "leftHand",
  "rightUpperArm", "rightLowerArm", "rightHand", "leftUpperLeg", "leftLowerLeg", "leftFoot",
  "rightUpperLeg", "rightLowerLeg", "rightFoot"];
const missing = required.filter((r) => !humanBones[r]);
if (missing.length) throw new Error("missing required humanoid bones: " + missing.join(", "));

json.extensions = json.extensions ?? {};
json.extensions.VRMC_vrm = {
  specVersion: "1.0",
  meta: {
    name: "vsim CC0 avatar",
    version: "1.0",
    authors: ["vsim (generated from MakeHuman / MPFB 2)"],
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    avatarPermission: "everyone",
    commercialUsage: "personalNonProfit",
    allowExcessivelyViolentUsage: false,
    allowExcessivelySexualUsage: false,
    creditNotation: "unnecessary",
  },
  humanoid: { humanBones },
};
json.extensionsUsed = Array.from(new Set([...(json.extensionsUsed ?? []), "VRMC_vrm"]));

// --- write the GLB back (pad JSON to 4 bytes with spaces, BIN to 4 with zeros) ---
const pad = (b, fill) => (b.length % 4 === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]));
const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
const chunks = [jsonChunk.length, 0x4e4f534a, jsonChunk];
let total = 12 + 8 + jsonChunk.length;
let binChunk;
if (bin) { binChunk = pad(Buffer.from(bin), 0); total += 8 + binChunk.length; }

const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
let p = 12;
out.writeUInt32LE(jsonChunk.length, p); out.writeUInt32LE(0x4e4f534a, p + 4); jsonChunk.copy(out, p + 8); p += 8 + jsonChunk.length;
if (binChunk) { out.writeUInt32LE(binChunk.length, p); out.writeUInt32LE(0x004e4942, p + 4); binChunk.copy(out, p + 8); }
writeFileSync(outPath, out);
console.log(`wrote ${outPath} — VRM 1.0, ${Object.keys(humanBones).length} humanoid bones, ${(total / 1e6).toFixed(1)} MB`);
