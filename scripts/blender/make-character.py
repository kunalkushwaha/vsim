import bpy, math, sys
out = sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# --- Armature (Blender is Z-up; standing figure) ---
arm_data = bpy.data.armatures.new("rig")
arm = bpy.data.objects.new("rig", arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
def bone(n, h, t, p=None):
    b = eb.new(n); b.head = h; b.tail = t
    if p: b.parent = eb[p]
bone("pelvis", (0,0,0.9), (0,0,1.15))
bone("chest", (0,0,1.15), (0,0,1.5), "pelvis")
bone("head", (0,0,1.5), (0,0,1.82), "chest")
bone("armL", (0.18,0,1.45), (0.18,0,1.05), "chest")
bone("armR", (-0.18,0,1.45), (-0.18,0,1.05), "chest")
bone("legL", (0.1,0,0.9), (0.1,0,0.05), "pelvis")
bone("legR", (-0.1,0,0.9), (-0.1,0,0.05), "pelvis")
bpy.ops.object.mode_set(mode='OBJECT')

# --- Mesh parts, each rigidly weighted to one bone, then joined + smoothed ---
parts = [
  ("pelvis","cube",(0,0,1.02),(0.18,0.12,0.16)),
  ("chest","cube",(0,0,1.32),(0.2,0.13,0.22)),
  ("head","sphere",(0,0,1.66),(0.16,0.16,0.16)),
  ("armL","cyl",(0.18,0,1.25),(0.055,0.055,0.22)),
  ("armR","cyl",(-0.18,0,1.25),(0.055,0.055,0.22)),
  ("legL","cyl",(0.1,0,0.48),(0.07,0.07,0.45)),
  ("legR","cyl",(-0.1,0,0.48),(0.07,0.07,0.45)),
]
objs=[]
for bn,kind,loc,scl in parts:
    if kind=="cube": bpy.ops.mesh.primitive_cube_add(size=2, location=loc)
    elif kind=="sphere": bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=loc, segments=16, ring_count=8)
    else: bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=2, location=loc, vertices=12)
    o=bpy.context.object; o.scale=scl
    bpy.ops.object.transform_apply(scale=True)
    o.vertex_groups.new(name=bn).add([v.index for v in o.data.vertices], 1.0, 'REPLACE')
    objs.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active=objs[0]
bpy.ops.object.join()
body=bpy.context.object; body.name="body"
body.modifiers.new("subsurf","SUBSURF").levels=1
body.parent=arm
body.modifiers.new("arm","ARMATURE").object=arm

# --- Walk cycle on pose bones (legs/arms swing about X) ---
bpy.context.view_layer.objects.active=arm
bpy.ops.object.mode_set(mode='POSE')
pb=arm.pose.bones
def key(bn,f,ax):
    b=pb[bn]; b.rotation_mode='XYZ'; b.rotation_euler=(ax,0,0); b.keyframe_insert("rotation_euler",frame=f)
for f,a in [(1,0.5),(16,-0.5),(31,0.5)]:
    key("legL",f,a); key("legR",f,-a); key("armL",f,-a*0.8); key("armR",f,a*0.8)
scene.frame_start=1; scene.frame_end=31
if arm.animation_data and arm.animation_data.action: arm.animation_data.action.name = "walk"
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True, export_yup=True)
print("EXPORTED", out)
