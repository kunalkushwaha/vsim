# Generate a rigged, animated ANIMAL headlessly in Blender → glTF, which vsim's loadGltfRig
# reads directly. Pure Blender, no external assets (MIT) — make-quadruped.py generalized into
# a species table so the film3d cast can grow without licensing bookkeeping. Run:
#
#   blender --background --python scripts/blender/make-animal.py -- <deer|bear|rabbit> out.glb
#   python3 scripts/blender/make-animal.py -- deer deer.glb          # pip `bpy` works too
#
# Built standing in Blender's Z-up with the body along +Y (head forward at +Y); export_yup makes
# it Y-up, facing -Z. Every species: spine + neck/head + tail + four two-bone legs, plus species
# parts (antlers, ears, snout, hump), and walk / run / idle clips.
import bpy, sys, json

args = [a for a in sys.argv[sys.argv.index("--") + 1:]] if "--" in sys.argv else sys.argv[1:]
species, out = args[0], args[1]
# `species` may also be a path to an external table (a validated CreatureDoc's geometry):
# the same keys as SPECIES entries below — this is how AI-authored creatures compile.
external = json.load(open(species)) if species.endswith(".json") else None

# Species tables: bones as (name, head, tail, parent); parts as (bone, kind, loc, scale) — each
# part rigidly weighted to its bone; gaits as (upper-leg swing, lower-leg curl) radians.
SPECIES = {
    # Elegant browser: long legs, upright neck, branched antlers, stub tail.
    "deer": {
        "bones": [
            ("hips", (0, -0.35, 0.88), (0, 0.00, 0.90), None),
            ("spine", (0, 0.00, 0.90), (0, 0.38, 0.92), "hips"),
            ("neck", (0, 0.38, 0.92), (0, 0.55, 1.24), "spine"),
            ("head", (0, 0.55, 1.24), (0, 0.74, 1.31), "neck"),
            ("tail", (0, -0.35, 0.86), (0, -0.52, 0.80), "hips"),
        ],
        "legs": {"front_y": 0.32, "back_y": -0.28, "sx": 0.13, "top": 0.88, "knee": 0.46, "r_u": 0.05, "r_l": 0.04},
        "parts": [
            ("hips", "cube", (0, -0.18, 0.88), (0.15, 0.20, 0.15)),
            ("spine", "cube", (0, 0.15, 0.90), (0.16, 0.26, 0.15)),
            ("neck", "cube", (0, 0.46, 1.06), (0.07, 0.09, 0.20)),
            ("head", "sphere", (0, 0.63, 1.28), (0.085, 0.12, 0.085)),
            ("head", "cube", (0, 0.76, 1.25), (0.045, 0.075, 0.045), (0.25, 0.2, 0.16)),   # muzzle
            ("head", "cyl", (0.075, 0.58, 1.44), (0.022, 0.022, 0.13), (0.35, 0.28, 0.2)),  # antler beams
            ("head", "cyl", (-0.075, 0.58, 1.44), (0.022, 0.022, 0.13), (0.35, 0.28, 0.2)),
            ("head", "cyl", (0.13, 0.61, 1.50), (0.018, 0.018, 0.08), (0.35, 0.28, 0.2)),   # antler branches
            ("head", "cyl", (-0.13, 0.61, 1.50), (0.018, 0.018, 0.08), (0.35, 0.28, 0.2)),
            ("tail", "cube", (0, -0.46, 0.83), (0.03, 0.09, 0.035), (0.92, 0.9, 0.85)),     # white flag
        ],
        "gaits": {"walk": (0.30, -0.25), "run": (0.65, -0.60)},
        "base_color": (0.55, 0.42, 0.28),
    },
    # Lumbering bulk: short thick legs, shoulder hump, big head, round ears, stub tail.
    "bear": {
        "bones": [
            ("hips", (0, -0.34, 0.68), (0, 0.00, 0.72), None),
            ("spine", (0, 0.00, 0.72), (0, 0.40, 0.72), "hips"),
            ("neck", (0, 0.40, 0.72), (0, 0.56, 0.78), "spine"),
            ("head", (0, 0.56, 0.78), (0, 0.78, 0.80), "neck"),
            ("tail", (0, -0.34, 0.66), (0, -0.46, 0.62), "hips"),
        ],
        "legs": {"front_y": 0.32, "back_y": -0.28, "sx": 0.19, "top": 0.66, "knee": 0.36, "r_u": 0.09, "r_l": 0.075},
        "parts": [
            ("hips", "cube", (0, -0.18, 0.70), (0.23, 0.26, 0.22)),
            ("spine", "cube", (0, 0.16, 0.72), (0.25, 0.30, 0.24)),
            ("spine", "cube", (0, 0.30, 0.88), (0.17, 0.14, 0.10)),      # shoulder hump
            ("neck", "cube", (0, 0.46, 0.75), (0.13, 0.17, 0.13)),
            ("head", "sphere", (0, 0.64, 0.79), (0.13, 0.15, 0.12)),
            ("head", "cube", (0, 0.77, 0.74), (0.055, 0.07, 0.05), (0.55, 0.42, 0.3)),     # tan snout
            ("head", "sphere", (0.09, 0.58, 0.92), (0.035, 0.035, 0.035), (0.22, 0.16, 0.12)),  # ears
            ("head", "sphere", (-0.09, 0.58, 0.92), (0.035, 0.035, 0.035), (0.22, 0.16, 0.12)),
            ("tail", "sphere", (0, -0.44, 0.64), (0.04, 0.05, 0.04)),
        ],
        "gaits": {"walk": (0.26, -0.20), "run": (0.55, -0.45)},
        "base_color": (0.33, 0.24, 0.18),
    },
    # Small and quick: compact body, tall ears, puff tail, strong back legs.
    "rabbit": {
        "bones": [
            ("hips", (0, -0.16, 0.26), (0, 0.00, 0.28), None),
            ("spine", (0, 0.00, 0.28), (0, 0.12, 0.30), "hips"),
            ("neck", (0, 0.12, 0.30), (0, 0.18, 0.36), "spine"),
            ("head", (0, 0.18, 0.36), (0, 0.28, 0.38), "neck"),
            ("tail", (0, -0.16, 0.26), (0, -0.26, 0.28), "hips"),
        ],
        "legs": {"front_y": 0.09, "back_y": -0.12, "sx": 0.055, "top": 0.25, "knee": 0.14, "r_u": 0.032, "r_l": 0.026},
        "parts": [
            ("hips", "cube", (0, -0.07, 0.27), (0.09, 0.11, 0.10)),
            ("spine", "cube", (0, 0.06, 0.28), (0.08, 0.09, 0.08)),
            ("head", "sphere", (0, 0.21, 0.37), (0.065, 0.075, 0.065)),
            ("head", "cube", (0, 0.28, 0.35), (0.03, 0.04, 0.028), (0.9, 0.87, 0.82)),   # white muzzle
            ("head", "cube", (0.032, 0.16, 0.50), (0.018, 0.028, 0.10), (0.75, 0.6, 0.58)),  # pink-lined ears
            ("head", "cube", (-0.032, 0.16, 0.50), (0.018, 0.028, 0.10), (0.75, 0.6, 0.58)),
            ("tail", "sphere", (0, -0.24, 0.29), (0.032, 0.038, 0.032), (0.94, 0.93, 0.9)),  # white puff
        ],
        "legs_back_r": 0.045,  # haunches read thicker than forelegs
        "gaits": {"walk": (0.45, -0.35), "run": (0.80, -0.65)},
        "base_color": (0.7, 0.65, 0.58),
    },
}

cfg = external if external else SPECIES[species]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# --- Armature ---------------------------------------------------------------------------
arm_data = bpy.data.armatures.new("rig")
arm = bpy.data.objects.new("rig", arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
def bone(n, h, t, p=None):
    b = eb.new(n); b.head = h; b.tail = t
    if p: b.parent = eb[p]
for entry in cfg["bones"]:
    n, h, t = entry[0], entry[1], entry[2]
    bone(n, h, t, entry[3] if len(entry) > 3 else None)
L = cfg["legs"]
for s, sx in (("L", L["sx"]), ("R", -L["sx"])):
    bone("front_u" + s, (sx, L["front_y"], L["top"]), (sx, L["front_y"], L["knee"]), "spine")
    bone("front_l" + s, (sx, L["front_y"], L["knee"]), (sx, L["front_y"], 0.04), "front_u" + s)
    bone("back_u" + s, (sx, L["back_y"], L["top"]), (sx, L["back_y"], L["knee"]), "hips")
    bone("back_l" + s, (sx, L["back_y"], L["knee"]), (sx, L["back_y"], 0.04), "back_u" + s)
bpy.ops.object.mode_set(mode='OBJECT')

# --- Mesh parts, rigidly weighted, joined + subsurfed ------------------------------------
parts = list(cfg["parts"])
back_r = cfg.get("legs_back_r", L["r_u"])
for s, sx in (("L", L["sx"]), ("R", -L["sx"])):
    mid_u = (L["top"] + L["knee"]) / 2
    mid_l = (L["knee"] + 0.04) / 2
    half_u = (L["top"] - L["knee"]) / 2
    half_l = (L["knee"] - 0.04) / 2
    parts += [
        ("front_u" + s, "cyl", (sx, L["front_y"], mid_u), (L["r_u"], L["r_u"], half_u)),
        ("front_l" + s, "cyl", (sx, L["front_y"], mid_l), (L["r_l"], L["r_l"], half_l)),
        ("back_u" + s, "cyl", (sx, L["back_y"], mid_u), (back_r, back_r, half_u)),
        ("back_l" + s, "cyl", (sx, L["back_y"], mid_l), (L["r_l"], L["r_l"], half_l)),
    ]
# Per-part colors (CreatureDoc `color`) bake to a 1-row PALETTE texture: every part's UVs
# collapse onto its color's texel, so the GLB colors through the ordinary texture path and
# no renderer changes are needed. Colorless parts and the legs wear the base coat (tint).
part_colors = [tuple(p[4]) if len(p) > 4 else None for p in parts]
use_palette = any(c is not None for c in part_colors)
base_color = tuple(cfg.get("base_color", (0.75, 0.6, 0.45)))
palette = []
def texel_of(color):
    c = tuple(color) if color else base_color
    if c not in palette: palette.append(c)
    return palette.index(c)

objs = []
for entry, color in zip(parts, part_colors):
    bn, kind, loc, scl = entry[0], entry[1], entry[2], entry[3]
    if kind == "cube": bpy.ops.mesh.primitive_cube_add(size=2, location=loc)
    elif kind == "sphere": bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=loc, segments=16, ring_count=8)
    else: bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=2, location=loc, vertices=10)
    o = bpy.context.object; o.scale = scl
    bpy.ops.object.transform_apply(scale=True)
    o.vertex_groups.new(name=bn).add([v.index for v in o.data.vertices], 1.0, 'REPLACE')
    if use_palette:
        idx = texel_of(color)
        # Overwrite the primitive's auto-generated layer (calc_uvs) — a second layer would
        # export as TEXCOORD_1, and engines sample TEXCOORD_0.
        uv = o.data.uv_layers[0] if o.data.uv_layers else o.data.uv_layers.new(name="UVMap")
        # UV u is filled after the palette size is known; stash the texel index for now.
        for lo in o.data.loops: uv.data[lo.index].uv = (idx, 0.5)
    objs.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join()
body = bpy.context.object; body.name = "body"
if use_palette:
    n = len(palette)
    for d in body.data.uv_layers.active.data:  # texel index → texel center in [0,1]
        d.uv = ((d.uv[0] + 0.5) / n, 0.5)
    img = bpy.data.images.new("palette", width=n, height=1, alpha=False)
    px = []
    for c in palette: px += [c[0], c[1], c[2], 1.0]
    img.pixels[:] = px
    img.pack()
    mat = bpy.data.materials.new("palette"); mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img; tex.interpolation = 'Closest'
    mat.node_tree.links.new(bsdf.inputs["Base Color"], tex.outputs["Color"])
    body.data.materials.append(mat)
body.modifiers.new("subsurf", "SUBSURF").levels = 1
body.parent = arm
body.modifiers.new("arm", "ARMATURE").object = arm

# --- Clips: diagonal gaits (walk/run) + a breathing idle ---------------------------------
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
pb = arm.pose.bones
for b in pb: b.rotation_mode = 'XYZ'
ad = arm.animation_data_create()
def author(name, keys):
    for b in pb: b.rotation_euler = (0, 0, 0)
    act = bpy.data.actions.new(name); ad.action = act
    for f, poses in keys:
        for bn, eu in poses.items():
            pb[bn].rotation_euler = eu; pb[bn].keyframe_insert("rotation_euler", frame=f)
    trk = ad.nla_tracks.new(); trk.name = name; trk.strips.new(name, 1, act); ad.action = None
def gait(a, lo):
    return [
        (1,  {"front_uL": (a, 0, 0), "back_uR": (a, 0, 0), "front_uR": (-a, 0, 0), "back_uL": (-a, 0, 0),
              "front_lL": (lo, 0, 0), "back_lR": (lo, 0, 0), "tail": (0, 0, 0.20)}),
        (9,  {"front_uL": (-a, 0, 0), "back_uR": (-a, 0, 0), "front_uR": (a, 0, 0), "back_uL": (a, 0, 0),
              "front_lR": (lo, 0, 0), "back_lL": (lo, 0, 0), "tail": (0, 0, -0.20)}),
        (17, {"front_uL": (a, 0, 0), "back_uR": (a, 0, 0), "front_uR": (-a, 0, 0), "back_uL": (-a, 0, 0),
              "front_lL": (lo, 0, 0), "back_lR": (lo, 0, 0), "tail": (0, 0, 0.20)}),
    ]
def idle():
    # Slow loop: breath in the spine, a head turn each way, an ear-height tail flick.
    return [
        (1,  {"spine": (0, 0, 0), "neck": (0, 0, 0), "head": (0, 0, 0), "tail": (0, 0, 0)}),
        (13, {"spine": (0.03, 0, 0), "neck": (0.05, 0, 0.10), "head": (0.04, 0, 0.12), "tail": (0, 0, 0.18)}),
        (25, {"spine": (0, 0, 0), "neck": (0.02, 0, 0), "head": (0, 0, 0), "tail": (0, 0, 0)}),
        (37, {"spine": (0.03, 0, 0), "neck": (0.05, 0, -0.10), "head": (0.04, 0, -0.12), "tail": (0, 0, -0.18)}),
        (48, {"spine": (0, 0, 0), "neck": (0, 0, 0), "head": (0, 0, 0), "tail": (0, 0, 0)}),
    ]
walk_a, walk_lo = cfg["gaits"]["walk"]
run_a, run_lo = cfg["gaits"]["run"]
author("walk", gait(walk_a, walk_lo))
author("run", gait(run_a, run_lo))
author("idle", idle())
scene.frame_start = 1; scene.frame_end = 48
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True,
                          export_animation_mode='ACTIONS', export_yup=True)
print("EXPORTED", species, "->", out)
