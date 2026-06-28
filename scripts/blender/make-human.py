# Generate a REALISTIC rigged + walk-animated human using MakeHuman (the MPFB 2 Blender add-on),
# headless — optionally with a real skin TEXTURE and a distinct body. Run with:
#
#   blender --background --python scripts/blender/make-human.py -- <mpfb2.zip> <output.glb> [skin.mhmat] [macro=val ...]
#
# Macro overrides shape the body (all 0..1): gender (0 female → 1 male), age (0 child → 1 old),
# muscle, weight, height, proportions, and race weights asian/caucasian/african. Examples:
#   ... human.glb skin.mhmat gender=1.0 height=0.6 muscle=0.6 caucasian=1.0   # an adult man
#   ... kid.glb   skin.mhmat age=0.16                                          # a child
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
clothes = [a for a in argv if a.endswith(".mhclo")]  # garments fitted + rigged to the same skeleton
MAX_TEX = 1024  # downscale every diffuse to keep the bundled GLB small
RACES = {"asian", "caucasian", "african"}
overrides = {}  # macro body shape, e.g. {"gender": 1.0, "age": 0.16, "caucasian": 1.0}
for a in argv:
    if "=" in a and not a.endswith((".zip", ".glb", ".gltf", ".mhmat")):
        k, v = a.split("=", 1)
        overrides[k.strip()] = float(v)
MAX_TEX = int(overrides.pop("tex")) if "tex" in overrides else MAX_TEX  # tex=512 for a leaner GLB
want_mouth = bool(overrides.pop("mouth", 0))  # mouth=1 adds a "mouthOpen" morph target for lip-sync

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
if overrides:
    TargetService = importlib.import_module(base + ".services.targetservice").TargetService
    macro = TargetService.get_default_macro_info_dict()
    if any(k in RACES for k in overrides):  # naming a race zeroes the unspecified ones
        macro["race"] = {r: 0.0 for r in RACES}
    for k, v in overrides.items():
        (macro["race"] if k in RACES else macro)[k] = v
    tot = sum(macro["race"].values()) or 1.0
    for r in macro["race"]: macro["race"][r] /= tot   # race weights must sum to 1
    print("MACRO:", macro)
    human = HumanService.create_human(macro_detail_dict=macro)
else:
    human = HumanService.create_human()
HumanService.add_builtin_rig(human, "game_engine")
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
print("BONES:", [b.name for b in arm.data.bones])

# --- real clothing (optional): fit each garment to the body and copy skin weights onto the SAME
# game_engine rig, so it exports as an extra skinned mesh that vsim's multi-mesh loader picks up. ---
for mhclo in clothes:
    HumanService.add_mhclo_asset(mhclo, human, material_type="GAMEENGINE", subdiv_levels=0,
                                 set_up_rigging=True, interpolate_weights=True,
                                 import_subrig=False, import_weights=False)
    print("CLOTHES:", os.path.basename(mhclo))

# MakeHuman stores the macro body (gender/age/build) as shape keys (glTF morph targets), but vsim
# reads only the base mesh — so bake the current shape-key mix into the vertices and drop the keys,
# making the distinct body the exported geometry.
if human.data.shape_keys:
    mix = human.shape_key_add(name="_bake", from_mix=True)
    coords = [v.co.copy() for v in mix.data]
    bpy.context.view_layer.objects.active = human
    bpy.ops.object.shape_key_remove(all=True)
    for i, v in enumerate(human.data.vertices):
        v.co = coords[i]
    print("baked", len(coords), "verts (shape keys applied)")

# --- mouth-open morph (optional): load MakeHuman's jaw-drop target as a shape key named "mouthOpen".
# Done AFTER baking the macro keys, so it's the only remaining shape key → one named glTF morph target. ---
if want_mouth:
    TargetService = importlib.import_module(base + ".services.targetservice").TargetService
    data_dir = os.path.join(os.path.dirname(sys.modules[base].__file__), "data")
    jaw = os.path.join(data_dir, "targets", "chin", "chin-jaw-drop-incr.target.gz")
    bpy.context.view_layer.objects.active = human
    TargetService.load_target(human, jaw, weight=0.0, name="mouthOpen")
    print("MORPH: mouthOpen <-", os.path.basename(jaw))

# --- real skin texture (optional): GAMEENGINE bakes one diffuse map glTF exports as base color ---
if skin:
    HumanService.set_character_skin(skin, human, skin_type="GAMEENGINE")
    print("SKIN:", os.path.basename(skin))

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
footL=find("foot_l");                footR=find("foot_r")
armL=find("upperarm_l"); armR=find("upperarm_r")
forearmL=find("lowerarm_l"); forearmR=find("lowerarm_r")
spine=find("spine_02","spine_01"); head=find("head")
print("rig bones:", thighL, thighR, calfL, calfR, footL, footR, armL, armR, spine, head)

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

# A real walk cycle: per side a thigh swing + KNEE BEND on the swing leg + foot roll, arms counter-
# swinging with bent elbows. `pose()` sets a full body pose (right-leg args, left-leg args, arms).
def pose(rt, rc, rf, lt, lc, lf, ra, la, el=0.18):
    return {thighR:(rt,0,0), calfR:(rc,0,0), footR:(rf,0,0),
            thighL:(lt,0,0), calfL:(lc,0,0), footL:(lf,0,0),
            armR:(ra,0,0), armL:(la,0,0), forearmR:(el,0,0), forearmL:(el,0,0)}
A = 0.5  # walk: ~32-frame cycle (contact → passing → contact → passing → loop)
author("walk", [
    (1,  pose( A, -0.05,  0.20,  -A, -0.25, -0.35,  -A * 0.8,  A * 0.8)),  # R heel-strike front; L toe-off back
    (9,  pose( 0, -0.05,  0.00,   0, -0.95,  0.15,   0.0,      0.0)),      # R stance; L knee-up, foot lifted (swing)
    (17, pose(-A, -0.25, -0.35,   A, -0.05,  0.20,   A * 0.8, -A * 0.8)),  # L heel-strike front; R toe-off back
    (25, pose( 0, -0.95,  0.15,   0, -0.05,  0.00,   0.0,      0.0)),      # L stance; R knee-up swing
    (33, pose( A, -0.05,  0.20,  -A, -0.25, -0.35,  -A * 0.8,  A * 0.8)),  # = frame 1 → seamless loop
])
R = 0.85  # run: longer stride, deeper knee bend, forward lean, faster (~24-frame) cycle, bent elbows
author("run", [
    (1,  {**pose( R, -0.35,  0.10,  -R, -0.7, -0.25,  -R * 0.9,  R * 0.9, 0.7), spine: (0.30, 0, 0)}),
    (7,  {**pose( 0, -0.25,  0.00,   0, -1.4,  0.20,   0.0,      0.0,     0.7), spine: (0.30, 0, 0)}),
    (13, {**pose(-R, -0.7,  -0.25,   R, -0.35, 0.10,   R * 0.9, -R * 0.9, 0.7), spine: (0.30, 0, 0)}),
    (19, {**pose( 0, -1.4,   0.20,   0, -0.25, 0.00,   0.0,      0.0,     0.7), spine: (0.30, 0, 0)}),
    (25, {**pose( R, -0.35,  0.10,  -R, -0.7, -0.25,  -R * 0.9,  R * 0.9, 0.7), spine: (0.30, 0, 0)}),  # loop
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

# With clothes on, remove the body geometry hidden under them (each garment's "delete group") plus
# MakeHuman's helper geometry, so the body doesn't poke through. Apply only MASK modifiers — never
# the Armature modifier, which would freeze the pose. (Shape keys were already baked off above.)
if clothes:
    bpy.context.view_layer.objects.active = human
    masks = [md.name for md in human.modifiers if md.type == 'MASK']  # names may hold non-UTF8 bytes
    applied = 0
    for name in masks:
        try:
            bpy.ops.object.modifier_apply(modifier=name)
            applied += 1
        except Exception:
            pass
    print("applied", applied, "of", len(masks), "mask modifier(s)")

# downscale every diffuse (skin + each garment) so the bundled GLB stays small
for img in list(bpy.data.images):
    w, h = img.size
    if max(w, h) > MAX_TEX and w and h:
        s = MAX_TEX / max(w, h)
        img.scale(int(w * s), int(h * s))
        print("scaled", img.name, "->", tuple(img.size))

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True,
                          export_animation_mode='ACTIONS', export_yup=True,
                          export_morph=True, export_try_sparse_sk=False)  # dense morph deltas (vsim reads dense)
print("EXPORTED", out)
