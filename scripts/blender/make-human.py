# Generate a REALISTIC rigged + walk-animated human using MakeHuman (the MPFB 2 Blender add-on),
# headless — optionally with a real skin TEXTURE. Run with:
#
#   blender --background --python scripts/blender/make-human.py -- <mpfb2.zip> <output.glb> [skin.mhmat]
#
# Get the MPFB 2 add-on zip (free/open-source, MakeHuman Community):
#   curl -L https://files.makehumancommunity.org/plugins/mpfb2-latest.zip -o mpfb2.zip
#   (mirror list: https://static.makehumancommunity.org/mpfb/downloads.html)
#
# For a real skin, also grab the CC0 "system assets" pack and pass one of its skins:
#   curl -L https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip -o skins.zip
#   unzip skins.zip 'skins/*' -d assets
#   ... -- mpfb2.zip human.glb assets/skins/young_caucasian_female_special_suit/young_caucasian_female_special_suit.mhmat
#
# create_human() gives a CC0 realistic human; we add the bundled "game_engine" rig and a simple
# walk. With a skin, set_character_skin(..., skin_type="GAMEENGINE") bakes a single diffuse map that
# glTF exports as a base-color texture — exactly what vsim's loadGltfRig + software renderer sample.
import bpy, sys, importlib, math, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[-2:]
zip_path = next(a for a in argv if a.endswith(".zip"))
out = next(a for a in argv if a.endswith(".glb") or a.endswith(".gltf"))
skin = next((a for a in argv if a.endswith(".mhmat")), None)
MAX_TEX = 1024  # downscale skin diffuse to keep the bundled GLB small

# start from an empty scene (drop Blender's default Cube/Camera/Light so the GLB is just the human)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

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

# --- real skin texture (optional): GAMEENGINE bakes one diffuse map glTF exports as base color ---
if skin:
    HumanService.set_character_skin(skin, human, skin_type="GAMEENGINE")
    print("SKIN:", os.path.basename(skin))
    for img in list(bpy.data.images):
        w, h = img.size
        if max(w, h) > MAX_TEX and w and h:
            s = MAX_TEX / max(w, h)
            img.scale(int(w * s), int(h * s))
            print("scaled", img.name, "->", tuple(img.size))

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
