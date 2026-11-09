# Headless tests for assetkit (builders, turntable, bake bridge).
#
#   ${VSIM_BLENDER:-blender} --background --factory-startup --python scripts/blender/assetkit/test_assetkit.py
#   (pnpm test:assetkit)
#
# Exits non-zero on any failure. Works without the ambientCG texture cache (materials fall back
# to flat colours), so it can run in CI.
import json, math, os, struct, sys, tempfile, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import building, export, flora, terrain, turntable  # noqa: E402

FAILS, PASSES = [], []


def check(name, cond, detail=""):
    (PASSES if cond else FAILS).append(name + ("" if cond else "  -> " + str(detail)))


def clean():
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def descendants(root):
    out, st = [], [root]
    while st:
        o = st.pop(); out.append(o); st.extend(o.children)
    return out


def bounds_and_tris(root, names=None):
    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e9,) * 3); hi = -lo; tris = 0
    for o in descendants(root):
        if o.type not in {"MESH", "CURVE"} or (names and not names(o)):
            continue
        ev = o.evaluated_get(dg); me = ev.to_mesh(); me.calc_loop_triangles(); tris += len(me.loop_triangles)
        for v in me.vertices:
            w = ev.matrix_world @ v.co; lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
        ev.to_mesh_clear()
    return lo, hi, tris


def glb_json(path):
    b = open(path, "rb").read()
    L = struct.unpack("<I", b[12:16])[0]; j = json.loads(b[20:20 + L])
    bo = 20 + L; bl = struct.unpack("<I", b[bo:bo + 4])[0]
    return j, b[bo + 8:bo + 8 + bl]


def image_max(j, binc, index):
    """Max channel value (0..1) of a GLB-embedded image, decoded by Blender."""
    im = j["images"][index]; bv = j["bufferViews"][im["bufferView"]]
    data = binc[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
    fd, p = tempfile.mkstemp(suffix=".jpg"); os.write(fd, data); os.close(fd)
    img = bpy.data.images.load(p); px = list(img.pixels[:]); bpy.data.images.remove(img); os.remove(p)
    return max(v for i, v in enumerate(px) if i % 4 != 3)


# ---------------------------------------------------------------- flora
HEAD = lambda o: "_petal" in o.name
EXPECT_FLOWER = {"lotus": (0.3, 1.0), "marigold": (0.06, 0.3), "rose": (0.08, 0.35), "lily": (0.12, 0.5), "daisy": (0.05, 0.2)}
for key, doc in flora.PRESETS.items():
    clean()
    try:
        r = flora.build_flower(doc, name=key)
        petals = [o for o in descendants(r) if "_petal" in o.name]
        check("flora/%s petals" % key, len(petals) >= 6, len(petals))
        lo, hi, _ = bounds_and_tris(r, HEAD)
        w = max(hi.x - lo.x, hi.y - lo.y)
        a, b = EXPECT_FLOWER[key]
        check("flora/%s head width %.3f in [%s,%s] m" % (key, w, a, b), a <= w <= b, w)
        check("flora/%s seeded" % key, json.loads(json.dumps(doc)) == doc)
    except Exception:
        check("flora/%s builds" % key, False, traceback.format_exc())

# ---------------------------------------------------------------- buildings
for key, doc in building.PRESETS.items():
    clean()
    try:
        r = building.build_building(doc, name=key)
        lo, hi, tris = bounds_and_tris(r)
        check("building/%s footprint" % key, abs((hi.x - lo.x) - doc["width"]) < 2.0 and abs((hi.y - lo.y) - doc["depth"]) < 2.5,
              (hi.x - lo.x, hi.y - lo.y))
        walls_top = doc["plinth"] + doc["floors"] * doc["floor_height"]
        check("building/%s height >= walls (%.1f m)" % (key, walls_top), hi.z >= walls_top, hi.z)
        check("building/%s on the ground" % key, abs(lo.z) < 0.05, lo.z)
        check("building/%s budget %d tris" % (key, tris), 3000 < tris < 120000, tris)
        glass = [o for o in descendants(r) if o.name.endswith("_glass")]
        check("building/%s has windows" % key, len(glass) >= doc["floors"] * 2, len(glass))
        doors = [o for o in descendants(r) if "_door_hinge_" in o.name]
        check("building/%s door hinges" % key, len(doors) == 2, len(doors))
        r["door_open"] = 1.0; r.update_tag(); bpy.context.view_layer.update()   # custom props don't auto-tag the depsgraph
        angs = [round(d.rotation_euler.z, 2) for d in doors]
        dinfo = [(d.name, d.animation_data.drivers[0].driver.is_valid if d.animation_data and d.animation_data.drivers else None) for d in doors]
        check("building/%s door opens" % key, all(abs(a) > 1.0 for a in angs), (angs, dinfo))
        # explainer style: same geometry, no image textures
        clean(); r2 = building.build_building(doc, name=key + "_x", style="explainer")
        imgs = [n for m in bpy.data.materials if m.name.startswith(key + "_x_") and m.node_tree for n in m.node_tree.nodes if n.type == "TEX_IMAGE"]
        check("building/%s explainer has no textures" % key, not imgs, len(imgs))
    except Exception:
        check("building/%s builds" % key, False, traceback.format_exc())

# ---------------------------------------------------------------- lakes
for key, doc in terrain.PRESETS.items():
    clean()
    try:
        r = terrain.build_lake(doc, name=key)
        names = {o.name for o in descendants(r)}
        check("lake/%s terrain+water" % key, key + "_terrain" in names and key + "_water" in names)
        F = terrain.Field(doc)
        check("lake/%s centre is under water" % key, F.h(0, 0) < -0.5 * doc["lake"]["depth"], F.h(0, 0))
        far = F.h(doc["size"] * 0.45, doc["size"] * 0.45)
        check("lake/%s banks above water" % key, far > 0.0, far)
        reeds = [n for n in names if "_reeds_" in n]
        check("lake/%s dressing" % key, len(reeds) == doc["dressing"]["reeds"], len(reeds))
        if doc.get("ghats"):
            steps = [n for n in names if "_step_" in n]
            check("lake/%s ghat steps" % key, len(steps) == doc["ghats"]["steps"], len(steps))
    except Exception:
        check("lake/%s builds" % key, False, traceback.format_exc())

# ---------------------------------------------------------------- review regressions
# no CC0 cache (CI): lakes and buildings still build, flagged as texture_missing
saved_index = building.TEX_INDEX
try:
    building.TEX_INDEX = "/nonexistent/assetkit-index.json"
    clean(); terrain.build_lake(terrain.PRESETS["park_pond"], name="nocache_lake")
    clean(); building.build_building(building.PRESETS["cottage"], name="nocache_cot")
    flagged = [m.name for m in bpy.data.materials if "texture_missing" in m and m.name.startswith(("nocache_lake", "nocache_cot"))]
    check("no texture cache: lake+building build, flagged", len(flagged) >= 2, flagged)
except Exception:
    check("no texture cache: lake+building build", False, traceback.format_exc())
finally:
    building.TEX_INDEX = saved_index
# frame width is part of the frame-mesh cache key (door and window with the same opening)
try:
    clean()
    d = json.loads(json.dumps(building.PRESETS["cottage"]))
    d["door"] = {"shape": "rect", "width": d["window"]["width"], "height": d["window"]["height"]}
    d["window"]["frame"] = 0.05
    r = building.build_building(d, name="framekey")
    door_f = next(o for o in descendants(r) if o.name.endswith("_door_frame"))
    win_f = next(o for o in descendants(r) if "_w1_" in o.name and o.name.endswith("_frame"))
    check("frame cache keyed by frame width", door_f.data != win_f.data and door_f.dimensions.x > win_f.dimensions.x + 0.2,
          (door_f.dimensions.x, win_f.dimensions.x))
except Exception:
    check("frame cache keyed by frame width", False, traceback.format_exc())
# rooftop chhatris stand on the roof slab, not in mid-air
try:
    clean(); hd = building.PRESETS["haveli"]; r = building.build_building(hd, name="chk")
    top = hd["plinth"] + hd["floors"] * hd["floor_height"]
    cols = [o for o in descendants(r) if o.name.startswith("chhatri_col")]
    zmin = min((o.matrix_world @ Vector((0, 0, -0.5))).z for o in cols)
    check("chhatri columns start on the slab (%.2f vs %.2f)" % (zmin, top + 0.15), abs(zmin - (top + 0.15)) < 0.05, zmin)
except Exception:
    check("chhatri on slab", False, traceback.format_exc())
# lotus pad veins read the pad's own UVs (survive export's merge)
try:
    clean(); r = flora.build_flower(flora.PRESETS["lotus"], name="padchk")
    pad = next(o for o in descendants(r) if o.name.endswith("_pad"))
    nt = pad.data.materials[0].node_tree
    tc = next(n for n in nt.nodes if n.type == "TEX_COORD")
    check("lotus pad has UVs, material uses UV not Object coords",
          "UVMap" in pad.data.uv_layers and not tc.outputs["Object"].is_linked and tc.outputs["UV"].is_linked)
except Exception:
    check("lotus pad UVs", False, traceback.format_exc())
# unsupported ghat side is rejected, not silently built on the north shore
try:
    d = json.loads(json.dumps(terrain.PRESETS["village_lake"])); d["ghats"]["side"] = "south"
    terrain.Field(d); check("ghats side=south rejected", False, "no error")
except ValueError:
    check("ghats side=south rejected", True)
# non-principled materials never glow in the emission bake
m = bpy.data.materials.new("_np"); m.use_nodes = True; nt = m.node_tree
for n in list(nt.nodes):
    if n.type == "BSDF_PRINCIPLED": nt.nodes.remove(n)
dif = nt.nodes.new("ShaderNodeBsdfDiffuse"); nt.links.new(dif.outputs[0], next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL").inputs["Surface"])
img = bpy.data.images.new("_np_img", 8, 8)
export._emit_setup(m, img, "emission")
em = next(n for n in m.node_tree.nodes if n.type == "EMISSION")
check("non-principled emits black in emission pass", tuple(em.inputs["Color"].default_value)[:3] == (0, 0, 0))

# an asset with no renderable geometry fails with a clear error, not an IndexError
try:
    clean(); e_root = bpy.data.objects.new("empty_asset", None); bpy.context.scene.collection.objects.link(e_root)
    export.bake_to_glb("empty_asset", os.path.join(tempfile.mkdtemp(), "x.glb"))
    check("bake of empty asset raises", False, "no error")
except ValueError as e:
    check("bake of empty asset raises a clear ValueError", "no renderable geometry" in str(e), e)
except Exception:
    check("bake of empty asset raises a clear ValueError", False, traceback.format_exc())

# ---------------------------------------------------------------- turntable + bake bridge
tmp = tempfile.mkdtemp(prefix="assetkit_test_")
clean()
try:
    r = building.build_building(building.PRESETS["cottage"], name="tcot")
    st = turntable.turntable("tcot", os.path.join(tmp, "qa.png"), res=96)
    check("turntable sheet written", os.path.exists(st["sheet"]))
    check("turntable restores camera", bpy.context.scene.camera is None or bpy.context.scene.camera.name != "_tt_cam")
    n_before = len(bpy.data.objects)
    for night, expect_glow in ((0.8, True), (0.0, False)):
        out = os.path.join(tmp, "cot_%s.glb" % night)
        s = export.bake_to_glb("tcot", out, atlas=256, lod=0, night=night)
        j, binc = glb_json(out)
        prims = [p for m in j["meshes"] for p in m["primitives"]]
        check("bake night=%s one mesh/primitive" % night, len(j["meshes"]) == 1 and len(prims) == 1, (len(j["meshes"]), len(prims)))
        check("bake night=%s one material" % night, len(j.get("materials", [])) == 1)
        attrs = prims[0]["attributes"]
        check("bake night=%s one uv set" % night, "TEXCOORD_0" in attrs and "TEXCOORD_1" not in attrs, list(attrs))
        pos = j["accessors"][attrs["POSITION"]]
        check("bake night=%s grounded (min y=%.3f)" % (night, pos["min"][1]), abs(pos["min"][1]) < 0.01, pos["min"])
        check("bake night=%s height ~ cottage" % night, 6.0 < pos["max"][1] < 12.0, pos["max"])
        check("bake night=%s size is y-up [x, height, depth]" % night,
              abs(s["size"][1] - (pos["max"][1] - pos["min"][1])) < 0.01 and abs(s["size"][0] - (pos["max"][0] - pos["min"][0])) < 0.01,
              (s["size"], pos["min"], pos["max"]))
        mat = j["materials"][0]
        has_tex = "baseColorTexture" in mat.get("pbrMetallicRoughness", {})
        check("bake night=%s base colour texture" % night, has_tex)
        if "emissiveTexture" in mat:
            glow = image_max(j, binc, j["textures"][mat["emissiveTexture"]["index"]]["source"])
            check("bake night=%s emissive %s (max=%.2f)" % (night, "lit" if expect_glow else "dark", glow),
                  (glow > 0.4) if expect_glow else (glow < 0.1), glow)
        else:
            check("bake night=%s emissive expected" % night, not expect_glow)
    check("bake leaves no temp objects", len(bpy.data.objects) == n_before, (n_before, len(bpy.data.objects)))
    check("bake leaves no temp scenes", not any(s.name.startswith("_export_tmp") for s in bpy.data.scenes))
except Exception:
    check("bake round-trip", False, traceback.format_exc())

print("\n".join("PASS " + p for p in PASSES))
print("\n".join("FAIL " + f for f in FAILS))
print("ASSETKIT TESTS: %d passed, %d failed" % (len(PASSES), len(FAILS)))
sys.exit(1 if FAILS else 0)
