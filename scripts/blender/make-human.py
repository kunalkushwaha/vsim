# Generate a REALISTIC rigged + walk-animated human using MakeHuman (the MPFB 2 Blender add-on),
# headless. Run with:
#
#   blender --background --python scripts/blender/make-human.py -- <mpfb2.zip> <output.glb>
#
# Get the MPFB 2 add-on zip (free/open-source, MakeHuman Community), then run the line above:
#   curl -L https://files.makehumancommunity.org/plugins/mpfb2-<date>.zip -o mpfb2.zip
#   (mirror list: https://static.makehumancommunity.org/mpfb/downloads.html)
#
# create_human() gives a CC0 realistic human; we add the bundled "game_engine" rig and a simple
# walk, then export glTF (TRS joints, float weights) which vsim's loadGltfRig reads directly.
# For skin TEXTURES, also install MPFB's "system assets" pack and set a skin before export.
import bpy, sys, importlib, math
zip_path, out = sys.argv[-2], sys.argv[-1]
try:
    bpy.ops.extensions.package_install_files(filepath=zip_path, enable_on_install=True, repo="user_default")
except Exception as e:
    print("install note:", repr(e))
base = next((m for m in list(sys.modules) if m.endswith(".mpfb") or m == "mpfb"), None)
if not base: raise SystemExit("MPFB not loaded")
HumanService = importlib.import_module(base + ".services.humanservice").HumanService
human = HumanService.create_human()
HumanService.add_builtin_rig(human, "game_engine")
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
print("BONES:", [b.name for b in arm.data.bones])

# --- author a walk by keyframing leg/arm bones (Unreal-style game_engine rig) ---
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
pb = arm.pose.bones
def find(*cands):
    for c in cands:
        if c in pb: return c
    return None
thighL=find("thigh_l","upperleg_l"); thighR=find("thigh_r","upperleg_r")
armL=find("upperarm_l"); armR=find("upperarm_r")
print("walk bones:", thighL, thighR, armL, armR)
def key(name, f, ax):
    if not name: return
    b=pb[name]; b.rotation_mode='XYZ'; b.rotation_euler=(ax,0,0); b.keyframe_insert("rotation_euler", frame=f)
for f,a in [(1,0.5),(16,-0.5),(31,0.5)]:
    key(thighL,f,a); key(thighR,f,-a); key(armL,f,-a*0.7); key(armR,f,a*0.7)
bpy.context.scene.frame_start=1; bpy.context.scene.frame_end=31
if arm.animation_data and arm.animation_data.action: arm.animation_data.action.name="walk"
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True, export_yup=True)
print("EXPORTED", out)
