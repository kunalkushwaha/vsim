// Bundle chosen KayKit Medieval Hexagon models (CC0) into self-contained GLBs under
// packages/assets/models/medieval/. Each source .gltf references an external .bin and the
// shared palette texture (hexagons_medieval.png); the GLB embeds both so the committed
// asset is one file. Rerun after `scripts/fetch-asset-packs.sh` if the selection changes.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

const K = new URL("../vendor/kaykit-medieval-hexagon/addons/kaykit_medieval_hexagon_pack/Assets/gltf/", import.meta.url).pathname;
const OUT = new URL("../packages/assets/models/medieval/", import.meta.url).pathname;

// name → source path (relative to the pack's gltf/ root), optionally with a `mutate`
// that edits the glTF json before packing. Red-roof building variants: the warm accent
// reads best across the film sets.
//
// The windmill ships split so films can SPIN the blades: `windmill` is the body with the
// fan node detached; `windmill-fan` is the fan mesh alone re-rooted at identity, so it
// bakes in fan-local space and a rotation track turns it around its own hub. The fan
// pivot in body space is node1.T + node0.T ≈ [0, 0.957, 0.332] (see sets.ts windmill()).
const MODELS = {
  hut: { src: "buildings/red/building_home_A_red.gltf" },
  tavern: { src: "buildings/red/building_tavern_red.gltf" },
  windmill: {
    src: "buildings/red/building_windmill_red.gltf",
    mutate: (json) => { json.nodes[1].children = []; }, // detach the fan from the tower top
  },
  "windmill-fan": {
    src: "buildings/red/building_windmill_red.gltf",
    mutate: (json) => { json.scenes[json.scene ?? 0].nodes = [0]; delete json.nodes[0].translation; },
  },
  well: { src: "buildings/red/building_well_red.gltf" },
  tower: { src: "buildings/red/building_tower_A_red.gltf" },
  barrel: { src: "decoration/props/barrel.gltf" },
  crate: { src: "decoration/props/crate_A_big.gltf" },
  tent: { src: "decoration/props/tent.gltf" },
  wheelbarrow: { src: "decoration/props/wheelbarrow.gltf" },
  sack: { src: "decoration/props/sack.gltf" },
};

const pad4 = (n) => (n + 3) & ~3;

/** gltf (external .bin + .png) → GLB bytes with the buffer AND texture embedded. */
async function toGlb(gltfPath, mutate) {
  const json = JSON.parse(await readFile(gltfPath, "utf8"));
  mutate?.(json);
  const dir = dirname(gltfPath);
  if ((json.buffers ?? []).length !== 1) throw new Error(`${gltfPath}: expected exactly 1 buffer`);
  const bin = await readFile(join(dir, json.buffers[0].uri));

  // Append each external image to the binary chunk as a bufferView.
  let binLen = pad4(bin.length);
  const extra = [];
  for (const img of json.images ?? []) {
    if (!img.uri || img.uri.startsWith("data:")) continue;
    const bytes = await readFile(join(dir, img.uri));
    json.bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: bytes.length });
    extra.push({ offset: binLen, bytes });
    binLen = pad4(binLen + bytes.length);
    img.bufferView = json.bufferViews.length - 1;
    img.mimeType = img.uri.toLowerCase().endsWith(".jpg") || img.uri.toLowerCase().endsWith(".jpeg") ? "image/jpeg" : "image/png";
    delete img.uri;
  }
  json.buffers = [{ byteLength: binLen }];

  const binChunk = Buffer.alloc(binLen);
  bin.copy(binChunk, 0);
  for (const e of extra) e.bytes.copy(binChunk, e.offset);

  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonChunk = Buffer.alloc(pad4(jsonBytes.length), 0x20); // space-padded per spec
  jsonBytes.copy(jsonChunk, 0);

  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); // "glTF"
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16); // "JSON"
  jsonChunk.copy(out, 20);
  out.writeUInt32LE(binChunk.length, 20 + jsonChunk.length);
  out.writeUInt32LE(0x004e4942, 24 + jsonChunk.length); // "BIN"
  binChunk.copy(out, 28 + jsonChunk.length);
  return out;
}

await mkdir(OUT, { recursive: true });
const entries = [];
for (const [name, spec] of Object.entries(MODELS)) {
  const glb = await toGlb(join(K, spec.src), spec.mutate);
  await writeFile(join(OUT, `${name}.glb`), glb);
  entries.push({ name, file: `${name}.glb`, source: spec.src });
  console.log(`✓ ${name}.glb (${glb.length} bytes) ← ${spec.src}`);
}
await writeFile(join(OUT, "manifest.json"), JSON.stringify({
  credit: "KayKit Medieval Hexagon Pack 1.0 by Kay Lousberg (kaylousberg.com) — CC0",
  models: entries,
}, null, 2) + "\n");
console.log(`✓ manifest — ${entries.length} models`);
