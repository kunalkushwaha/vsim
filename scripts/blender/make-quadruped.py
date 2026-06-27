# Generate a rigged, walk/trot-animated QUADRUPED (e.g. a dog) headlessly in Blender → glTF, which
# vsim's loadGltfRig reads directly. Pure Blender, no external assets (MIT). Run:
#
#   blender --background --python scripts/blender/make-quadruped.py -- quadruped.glb
#
# Built standing in Blender's Z-up with the body along +Y (head forward at +Y); export_yup makes it
# Y-up, facing -Z. Spine + neck/head + tail + four two-bone legs; a diagonal trot gait.
import bpy, sys
out = sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# --- Armature: spine along +Y, four legs hanging down (-Z) ---
arm_data = bpy.data.armatures.new("rig")
arm = bpy.data.objects.new("rig", arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
def bone(n, h, t, p=None):
    b = eb.new(n); b.head = h; b.tail = t
    if p: b.parent = eb[p]
bone("hips", (0, -0.45, 0.55), (0, -0.05, 0.57))
bone("spine", (0, -0.05, 0.57), (0, 0.4, 0.57), "hips")
bone("neck", (0, 0.4, 0.57), (0, 0.62, 0.70), "spine")
bone("head", (0, 0.62, 0.70), (0, 0.85, 0.74), "neck")
bone("tail", (0, -0.45, 0.55), (0, -0.85, 0.42), "hips")
for s, sx in (("L", 0.16), ("R", -0.16)):
    bone("front_u" + s, (sx, 0.34, 0.54), (sx, 0.34, 0.28), "spine")
    bone("front_l" + s, (sx, 0.34, 0.28), (sx, 0.34, 0.04), "front_u" + s)
    bone("back_u" + s, (sx, -0.40, 0.54), (sx, -0.40, 0.28), "hips")
    bone("back_l" + s, (sx, -0.40, 0.28), (sx, -0.40, 0.04), "back_u" + s)
bpy.ops.object.mode_set(mode='OBJECT')

# --- Mesh parts, each rigidly weighted to one bone, then joined + subsurfed ---
parts = [
    ("hips", "cube", (0, -0.28, 0.55), (0.19, 0.22, 0.17)),
    ("spine", "cube", (0, 0.18, 0.56), (0.20, 0.30, 0.18)),
    ("neck", "cube", (0, 0.50, 0.64), (0.10, 0.14, 0.10)),
    ("head", "sphere", (0, 0.74, 0.73), (0.15, 0.18, 0.14)),
    ("tail", "cube", (0, -0.68, 0.48), (0.04, 0.22, 0.04)),
]
for s, sx in (("L", 0.16), ("R", -0.16)):
    parts += [
        ("front_u" + s, "cyl", (sx, 0.34, 0.41), (0.06, 0.06, 0.14)),
        ("front_l" + s, "cyl", (sx, 0.34, 0.16), (0.05, 0.05, 0.13)),
        ("back_u" + s, "cyl", (sx, -0.40, 0.41), (0.07, 0.07, 0.14)),
        ("back_l" + s, "cyl", (sx, -0.40, 0.16), (0.05, 0.05, 0.13)),
    ]
objs = []
for bn, kind, loc, scl in parts:
    if kind == "cube": bpy.ops.mesh.primitive_cube_add(size=2, location=loc)
    elif kind == "sphere": bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=loc, segments=16, ring_count=8)
    else: bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=2, location=loc, vertices=10)
    o = bpy.context.object; o.scale = scl
    bpy.ops.object.transform_apply(scale=True)
    o.vertex_groups.new(name=bn).add([v.index for v in o.data.vertices], 1.0, 'REPLACE')
    objs.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join()
body = bpy.context.object; body.name = "body"
body.modifiers.new("subsurf", "SUBSURF").levels = 1
body.parent = arm
body.modifiers.new("arm", "ARMATURE").object = arm

# --- clips: a diagonal trot gait (front_uL+back_uR swing together, opposite the other diagonal) ---
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
              "front_lL": (lo, 0, 0), "back_lR": (lo, 0, 0), "tail": (0, 0, 0.25)}),
        (9,  {"front_uL": (-a, 0, 0), "back_uR": (-a, 0, 0), "front_uR": (a, 0, 0), "back_uL": (a, 0, 0),
              "front_lR": (lo, 0, 0), "back_lL": (lo, 0, 0), "tail": (0, 0, -0.25)}),
        (17, {"front_uL": (a, 0, 0), "back_uR": (a, 0, 0), "front_uR": (-a, 0, 0), "back_uL": (-a, 0, 0),
              "front_lL": (lo, 0, 0), "back_lR": (lo, 0, 0), "tail": (0, 0, 0.25)}),
    ]
author("walk", gait(0.35, -0.30))
author("trot", gait(0.60, -0.55))
scene.frame_start = 1; scene.frame_end = 17
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True,
                          export_animation_mode='ACTIONS', export_yup=True)
print("EXPORTED", out)
