# Re-cut a rig's "walk" clip from mocap WITHOUT regenerating the character: import the bundled GLB
# (its skeleton is the retarget target), retarget the BVH onto it as a clean whole-cycle loop, and
# export an ANIMATION-ONLY GLB (armature + clips, no meshes). scripts/splice-animation.py then
# merges that clip into the original GLB, leaving mesh/skin/textures byte-identical.
#
#   blender -b --factory-startup --python scripts/blender/patch-walk.py -- in.glb walk.bvh out-anim.glb
#
# Why not round-trip the whole GLB through Blender? The importer/exporter re-encodes textures and
# re-orders attributes; the splice keeps the shipped bodies exactly as reviewed.
import bpy, sys, os, re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gaitlib

argv = sys.argv[sys.argv.index("--") + 1:]
src_glb, bvh, out = argv[0], argv[1], argv[2]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps, sc.render.fps_base = 30, 1
bpy.ops.import_scene.gltf(filepath=src_glb)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='POSE')
pb = arm.pose.bones

# Relaxed hands, exactly as make-human.py authors them (the mocap has no finger data).
CURL_AXIS, CURL = 2, {"01": -0.25, "02": -0.55, "03": -0.45}
relax = {}
for side in ("l", "r"):
    for fng in ("index", "middle", "ring", "pinky"):
        for seg, amt in CURL.items():
            bn = f"{fng}_{seg}_{side}"
            if bn in pb:
                e = [0.0, 0.0, 0.0]
                e[CURL_AXIS] = amt
                relax[bn] = tuple(e)


def key_relax(at):
    for bn, eu in relax.items():
        pb[bn].rotation_mode = 'XYZ'
        pb[bn].rotation_euler = eu
        pb[bn].keyframe_insert("rotation_euler", frame=at)


# Drop the imported actions (the old walk included) so the export carries only the new clip.
for act in list(bpy.data.actions):
    bpy.data.actions.remove(act)
if arm.animation_data:
    for t in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(t)
for b in pb:
    b.rotation_mode = 'XYZ'
    b.rotation_euler = (0, 0, 0)
    b.location = (0, 0, 0)

gaitlib.retarget_bvh(arm, bvh, "walk", 4, extra_keys=key_relax)
bpy.ops.object.mode_set(mode='OBJECT')

# Animation-only export: remove meshes, keep the armature.
for o in [o for o in bpy.data.objects if o.type != 'ARMATURE']:
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True,
                          export_animation_mode='ACTIONS', export_yup=True, export_skins=True)
print("EXPORTED", out)
