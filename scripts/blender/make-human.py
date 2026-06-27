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

# --- author a clip LIBRARY (walk / run / idle / wave) on the Unreal-style game_engine rig ---
# Each clip is its own Action, stashed to its own NLA track, so glTF exports them as separate,
# named animations. vsim's loader reads all of them; loadCharacter("human") then exposes the set.
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
pb = arm.pose.bones
for b in pb: b.rotation_mode = 'XYZ'
def find(*cands):
    for c in cands:
        if c in pb: return c
    return None
thighL=find("thigh_l","upperleg_l"); thighR=find("thigh_r","upperleg_r")
calfL=find("calf_l","lowerleg_l");   calfR=find("calf_r","lowerleg_r")
armL=find("upperarm_l"); armR=find("upperarm_r"); forearmR=find("lowerarm_r")
spine=find("spine_02","spine_01"); head=find("head")
print("rig bones:", thighL, thighR, calfL, calfR, armL, armR, forearmR, spine, head)

ad = arm.animation_data_create()
def author(name, keys):
    """keys: list of (frame, {bone: (rx,ry,rz)}). Bones not mentioned stay at bind pose."""
    for b in pb: b.rotation_euler = (0, 0, 0)
    act = bpy.data.actions.new(name); ad.action = act
    for f, poses in keys:
        for bn, eu in poses.items():
            if not bn: continue
            pb[bn].rotation_euler = eu
            pb[bn].keyframe_insert("rotation_euler", frame=f)
    trk = ad.nla_tracks.new(); trk.name = name
    trk.strips.new(name, 1, act)   # stash → its own track (gives the action a user + a clean name)
    ad.action = None

W = 0.5  # walk: legs/arms swing about X (forward/back)
author("walk", [
    (1,  {thighL:(W,0,0), thighR:(-W,0,0), armL:(-W*0.7,0,0), armR:(W*0.7,0,0)}),
    (16, {thighL:(-W,0,0), thighR:(W,0,0), armL:(W*0.7,0,0), armR:(-W*0.7,0,0)}),
    (31, {thighL:(W,0,0), thighR:(-W,0,0), armL:(-W*0.7,0,0), armR:(W*0.7,0,0)}),
])
R = 0.9  # run: bigger swing + forward lean + bent trailing knee, faster cycle
author("run", [
    (1,  {spine:(0.28,0,0), thighL:(R,0,0), thighR:(-R,0,0), calfL:(-0.7,0,0), armL:(-R*0.8,0,0), armR:(R*0.8,0,0)}),
    (9,  {spine:(0.28,0,0), thighL:(-R,0,0), thighR:(R,0,0), calfR:(-0.7,0,0), armL:(R*0.8,0,0), armR:(-R*0.8,0,0)}),
    (17, {spine:(0.28,0,0), thighL:(R,0,0), thighR:(-R,0,0), calfL:(-0.7,0,0), armL:(-R*0.8,0,0), armR:(R*0.8,0,0)}),
])
author("idle", [  # slow, subtle breathing/sway
    (1,  {spine:(0.0,0,0),  head:(0,0,0)}),
    (30, {spine:(0.05,0,0), head:(0.04,0.05,0)}),
    (60, {spine:(0.0,0,0),  head:(0,0,0)}),
])
A = -1.4  # wave: raise the right arm out and oscillate the forearm (axis verified by render)
author("wave", [
    (1,  {armR:(0,0,0)}),
    (8,  {armR:(0,0,A), forearmR:(0,0,-0.5)}),
    (16, {armR:(0,0,A), forearmR:(0,0,-1.1)}),
    (24, {armR:(0,0,A), forearmR:(0,0,-0.5)}),
    (32, {armR:(0,0,A), forearmR:(0,0,-1.1)}),
    (40, {armR:(0,0,0)}),
])

bpy.context.scene.frame_start = 1; bpy.context.scene.frame_end = 60
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True,
                          export_animation_mode='ACTIONS', export_yup=True)
print("EXPORTED", out)
