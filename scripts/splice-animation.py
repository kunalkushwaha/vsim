#!/usr/bin/env python3
# Splice one named animation from an animation-only GLB (scripts/blender/patch-walk.py output) into
# an existing GLB, replacing the animation of the same name. Mesh, skin, textures and every other
# chunk of the target stay byte-identical; only the animation's samplers get new accessors appended
# to the binary buffer (the replaced clip's old data is left in place as dead bytes — small).
#
#   python3 scripts/splice-animation.py target.glb clips.glb walk
#
# Joint nodes are matched BY NAME between the two files (Blender's importer/exporter preserves bone
# names), so the spliced channels drive the original skeleton.
import json, struct, sys

GLB_MAGIC, CHUNK_JSON, CHUNK_BIN = 0x46546C67, 0x4E4F534A, 0x004E4942


def read_glb(path):
    b = open(path, "rb").read()
    magic, _ver, _len = struct.unpack_from("<III", b, 0)
    assert magic == GLB_MAGIC, path
    off, js, bin_ = 12, None, b""
    while off < len(b):
        n, t = struct.unpack_from("<II", b, off)
        data = b[off + 8: off + 8 + n]
        if t == CHUNK_JSON:
            js = json.loads(data)
        elif t == CHUNK_BIN:
            bin_ = data
        off += 8 + n
    return js, bytearray(bin_)


def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(",", ":")).encode()
    jb += b" " * (-len(jb) % 4)
    bin_ = bytes(bin_) + b"\0" * (-len(bin_) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bin_)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", GLB_MAGIC, 2, total))
        f.write(struct.pack("<II", len(jb), CHUNK_JSON) + jb)
        f.write(struct.pack("<II", len(bin_), CHUNK_BIN) + bin_)


def accessor_bytes(js, bin_, idx):
    acc = js["accessors"][idx]
    bv = js["bufferViews"][acc["bufferView"]]
    comp = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[acc["componentType"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[acc["type"]]
    size = comp * n
    stride = bv.get("byteStride", size)
    start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    if stride == size:
        return bytes(bin_[start: start + size * acc["count"]])
    return b"".join(bytes(bin_[start + i * stride: start + i * stride + size]) for i in range(acc["count"]))


def main(target, clips, name):
    tj, tb = read_glb(target)
    cj, cb = read_glb(clips)
    src_anim = next((a for a in cj.get("animations", []) if a.get("name") == name), None)
    if not src_anim:
        sys.exit(f"{clips}: no animation named {name!r} (has {[a.get('name') for a in cj.get('animations', [])]})")
    by_name = {}
    for i, n in enumerate(tj["nodes"]):
        by_name.setdefault(n.get("name"), i)
    joints = set(tj["skins"][0]["joints"]) if tj.get("skins") else set(range(len(tj["nodes"])))

    def copy_accessor(idx):
        data = accessor_bytes(cj, cb, idx)
        acc = dict(cj["accessors"][idx])
        tb.extend(b"\0" * (-len(tb) % 4))
        tj.setdefault("bufferViews", []).append({"buffer": 0, "byteOffset": len(tb), "byteLength": len(data)})
        tb.extend(data)
        acc["bufferView"] = len(tj["bufferViews"]) - 1
        acc.pop("byteOffset", None)
        tj["accessors"].append(acc)
        return len(tj["accessors"]) - 1

    new_anim = {"name": name, "samplers": [], "channels": []}
    acc_cache = {}
    skipped = []
    for ch in src_anim["channels"]:
        node_name = cj["nodes"][ch["target"]["node"]].get("name")
        tgt = by_name.get(node_name)
        if tgt is None or tgt not in joints:
            skipped.append(node_name)
            continue
        s = src_anim["samplers"][ch["sampler"]]
        ns = {"interpolation": s.get("interpolation", "LINEAR")}
        for k in ("input", "output"):
            if s[k] not in acc_cache:
                acc_cache[s[k]] = copy_accessor(s[k])
            ns[k] = acc_cache[s[k]]
        new_anim["samplers"].append(ns)
        new_anim["channels"].append({"sampler": len(new_anim["samplers"]) - 1, "target": {"node": tgt, "path": ch["target"]["path"]}})
    anims = tj.setdefault("animations", [])
    old = next((i for i, a in enumerate(anims) if a.get("name") == name), None)
    if old is None:
        anims.append(new_anim)
    else:
        anims[old] = new_anim
    tj["buffers"][0]["byteLength"] = len(tb) + (-len(tb) % 4)
    write_glb(target, tj, tb)
    times = accessor_bytes(tj, tb, new_anim["samplers"][0]["input"])
    dur = struct.unpack_from("<f", times, len(times) - 4)[0]
    print(f"SPLICED {name} into {target}: {len(new_anim['channels'])} channels, {dur:.3f}s"
          + (f", skipped non-joint nodes {sorted(set(skipped))}" if skipped else ""))


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__ or "usage: splice-animation.py target.glb clips.glb name")
    main(*sys.argv[1:])
