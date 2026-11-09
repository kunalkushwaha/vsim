# assetkit.make — one command from a description to a vsim library asset.
#
#   blender --background --python scripts/blender/assetkit/make.py -- <kind> <preset|doc.json> <name>
#           [--style realistic|explainer] [--night 0.5] [--atlas 2048] [--lod 1] [--max-tris 60000]
#           [--out packages/assets/models/assetkit]
#
#   kind: building | flower | lake
#
# Steps: build in a fresh scene -> QA turntable of the source (qa/<name>.png) -> bake to one
# atlas (export.bake_to_glb) -> <out>/<name>.glb -> upsert <out>/manifest.json, which vsim's
# loadModel()/listModels() read (packages/assets/src/index.ts). The doc is stored in the
# manifest, so every library asset can be regenerated from the repo.
import json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy  # noqa: E402
import building, flora, terrain, turntable, export  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
KINDS = {
    "building": (building.PRESETS, lambda doc, name, style: building.build_building(doc, name=name, style=style)),
    "flower": (flora.PRESETS, lambda doc, name, style: flora.build_flower(doc, name=name)),
    "lake": (terrain.PRESETS, lambda doc, name, style: terrain.build_lake(doc, name=name, flora_mod=flora)),
}
HEAD = lambda o: any(k in o.name for k in ("_petal", "_pod", "_carpel", "_stamen", "_disc", "_floret", "_pistil", "_sepal"))


def parse(argv):
    a = {"style": None, "night": None, "atlas": 2048, "lod": 1, "max_tris": None, "allow_flat": False,
         "out": os.path.join(REPO, "packages", "assets", "models", "assetkit")}
    pos = []
    it = iter(argv)
    for t in it:
        if t == "--style": a["style"] = next(it)
        elif t == "--night": a["night"] = float(next(it))
        elif t == "--atlas": a["atlas"] = int(next(it))
        elif t == "--lod": a["lod"] = int(next(it))
        elif t == "--max-tris": a["max_tris"] = int(next(it))
        elif t == "--out": a["out"] = os.path.abspath(next(it))
        elif t == "--allow-flat": a["allow_flat"] = True
        else: pos.append(t)
    if len(pos) != 3 or pos[0] not in KINDS:
        raise SystemExit(__doc__ if False else "usage: make.py -- <building|flower|lake> <preset|doc.json> <name> [options]")
    a["kind"], a["spec"], a["name"] = pos
    return a


def main():
    a = parse(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    presets, build = KINDS[a["kind"]]
    if a["spec"].endswith(".json"):
        doc = json.load(open(a["spec"])); preset = None
    else:
        doc = presets[a["spec"]]; preset = a["spec"]
    t0 = time.time()
    for o in list(bpy.context.scene.objects):        # headless: start from an empty default scene
        bpy.data.objects.remove(o, do_unlink=True)
    root = build(doc, a["name"], a["style"])
    style = a["style"] or doc.get("style", "realistic")
    missing = sorted({m["texture_missing"] for m in bpy.data.materials if "texture_missing" in m})
    if missing and style != "explainer":
        if not a["allow_flat"]:
            raise SystemExit("realistic build needs CC0 textures %s — run scripts/blender/assetkit/fetch_textures.py "
                             "(see docs/plan-assetkit.md) or pass --allow-flat" % missing)
        style = "realistic-flat-fallback"
    os.makedirs(os.path.join(a["out"], "qa"), exist_ok=True)
    qa = turntable.turntable(root.name, os.path.join(a["out"], "qa", a["name"] + ".png"), res=360,
                             focus=HEAD if a["kind"] == "flower" else None)
    glb = os.path.join(a["out"], a["name"] + ".glb")
    grounded = a["kind"] != "lake"          # a lake's origin is its water level (basin below 0)
    st = export.bake_to_glb(root.name, glb, atlas=a["atlas"], lod=a["lod"], max_tris=a["max_tris"], night=a["night"],
                            ground=grounded)
    mpath = os.path.join(a["out"], "manifest.json")
    man = json.load(open(mpath)) if os.path.exists(mpath) else {
        "credit": "Generated with vsim assetkit (scripts/blender/assetkit) — CC0. Textures: ambientCG (CC0).", "models": []}
    entry = {"name": a["name"], "file": a["name"] + ".glb", "kind": a["kind"], "preset": preset,
             "source": "scripts/blender/assetkit/%s.py" % {"building": "building", "flower": "flora", "lake": "terrain"}[a["kind"]],
             "units": "metres", "up": "+y", "front": "+z", "grounded": grounded,
             "size_m": st["size"], "size_axes": "x,y(up),z(depth)", "triangles": st["triangles"],
             "atlas": st["atlas"], "emissive": st["emissive"], "style": style,
             "night": a["night"], "doc": doc}
    man["models"] = [m for m in man["models"] if m["name"] != a["name"]] + [entry]
    json.dump(man, open(mpath, "w"), indent=2)
    print("MAKE OK %s -> %s (%s tris, %s MB) qa=%s in %.1fs" % (a["name"], glb, st["triangles"], st["mb"], qa["sheet"], time.time() - t0))


main()
