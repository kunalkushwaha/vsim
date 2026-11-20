# Gait report — measure each locomotion clip's NATURAL GROUND SPEED (and loop quality) in a rig.
#
#   blender --background --factory-startup --python scripts/blender/gait-report.py -- a.glb [b.glb ...]
#
# Prints one line per clip, e.g.
#   GAIT human.glb walk stride=0.90 units/s (p25 0.81, p75 0.97) frames=38 loop=37.4deg
#
# "stride" is the horizontal speed of the planted foot, relative to the rig root, in the file's own
# units per second: the ground speed the clip was authored for. When a scene moves a character at
# a different speed and plays the clip at rate 1, the feet slide by the ratio; film3d scales the
# playback rate by `travelSpeed / stride` (see packages/film3d/src/compile.ts) using the numbers
# recorded in packages/film3d/src/schema.ts. "loop" is the pose jump between the last and first
# frame (a well-cut cycle is within a frame's worth of motion; the typical per-frame max is shown).
#
# Feet: bones named like foot/toe/ball/ankle/paw/hoof; otherwise the leaf bones in the lowest
# tenth of the rig's bind-pose height. The planted foot at a frame is the lowest candidate.
import bpy, sys, math, os, re

FPS = 30
FOOT_RE = re.compile(r"foot|toe|ball|ankle|paw|hoof", re.I)
LOCOMOTION = re.compile(r"walk|run|trot|gallop|sprint|jog", re.I)


def angle(q1, q2):
    a = q1.rotation_difference(q2).angle
    return math.degrees(min(a, 2 * math.pi - a))


def feet_of(arm):
    bones = arm.data.bones
    named = [b.name for b in bones if FOOT_RE.search(b.name)]
    if named:
        return named
    zs = [b.head_local.z for b in bones]
    lo, hi = min(zs), max(zs)
    cut = lo + 0.1 * (hi - lo)
    return [b.name for b in bones if not b.children and b.head_local.z <= cut] or [b.name for b in bones if b.head_local.z == lo]


def report(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps, sc.render.fps_base = FPS, 1
    bpy.ops.import_scene.gltf(filepath=path)
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not arms:
        print(f"GAIT {os.path.basename(path)} (no armature)")
        return
    arm = arms[0]
    feet = feet_of(arm)
    arm.animation_data_create()
    for act in bpy.data.actions:
        arm.animation_data.action = act
        f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
        if f1 <= f0:
            continue
        frames = {}
        for f in range(f0, f1 + 1):
            sc.frame_set(f)
            root_inv = arm.matrix_world.inverted()
            frames[f] = (
                {b.name: b.matrix.to_quaternion() for b in arm.pose.bones},
                {n: (arm.pose.bones[n].matrix.to_translation()).copy() for n in feet},
            )
        seam = max(angle(frames[f0][0][k], frames[f1][0][k]) for k in frames[f0][0])
        steps = sorted(max(angle(frames[f][0][k], frames[f + 1][0][k]) for k in frames[f][0]) for f in range(f0, f1))
        line = f"GAIT {os.path.basename(path)} {act.name} frames={f1 - f0 + 1} loop={seam:.1f}deg (frame-max {steps[len(steps) // 2]:.1f})"
        if LOCOMOTION.search(act.name):
            sp = []
            for f in range(f0, f1):
                planted = min(feet, key=lambda n: frames[f][1][n].z)
                a, b = frames[f][1][planted], frames[f + 1][1][planted]
                sp.append(math.hypot(b.x - a.x, b.y - a.y) * FPS)
            sp.sort()
            n = len(sp)
            line += f" stride={sp[n // 2]:.2f} units/s (p25 {sp[n // 4]:.2f}, p75 {sp[3 * n // 4]:.2f}) feet={len(feet)}"
        print(line)


argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    raise SystemExit("usage: blender -b --factory-startup --python gait-report.py -- rig.glb [...]")
for p in argv:
    report(p)
