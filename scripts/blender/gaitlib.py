# Shared mocap → rig helpers for the Blender character scripts (make-human.py, patch-walk.py).
#
#   best_loop(src, fstep)      the cleanest whole gait cycle in an imported BVH armature
#   retarget_bvh(...)          copy a BVH's bone rotations onto a target rig as a looping Action
#
# Import from a script with:  sys.path.insert(0, os.path.dirname(__file__)); import gaitlib
import bpy, math, mathutils, os

# Unreal-style game_engine rig (MakeHuman/MPFB) ← CMU BVH bone names.
BVH_MAP = {
    "pelvis": "Hips", "spine_01": "LowerBack", "spine_02": "Spine", "spine_03": "Spine1", "neck_01": "Neck", "head": "Head",
    "clavicle_l": "LeftShoulder", "upperarm_l": "LeftArm", "lowerarm_l": "LeftForeArm", "hand_l": "LeftHand",
    "clavicle_r": "RightShoulder", "upperarm_r": "RightArm", "lowerarm_r": "RightForeArm", "hand_r": "RightHand",
    "thigh_l": "LeftUpLeg", "calf_l": "LeftLeg", "foot_l": "LeftFoot", "ball_l": "LeftToeBase",
    "thigh_r": "RightUpLeg", "calf_r": "RightLeg", "foot_r": "RightFoot", "ball_r": "RightToeBase",
}


def best_loop(src, fstep, min_len=100, max_len=200):
    """Find the cleanest one-cycle window in the mocap: the (start, length) whose end pose is closest
    to its start pose (mean per-bone rotation difference, root excluded — its yaw drifts along the
    path). A fixed window that is not a whole gait cycle pops at every loop wrap (the old 30..150
    cut of CMU 07_01 jumped ~10 frames' worth of motion; the cycle is really ~130 frames). The
    length is a multiple of `fstep` so the sampled keys tile exactly on loop."""
    f0, f1 = map(int, src.animation_data.action.frame_range)
    names = [b.name for b in src.pose.bones if b.parent]  # skip the root
    Q = {}
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        Q[f] = [src.pose.bones[n].matrix_basis.to_quaternion() for n in names]

    def dist(a, b):
        tot = 0.0
        for x, y in zip(Q[a], Q[b]):
            d = x.rotation_difference(y).angle
            tot += min(d, 2 * math.pi - d)
        return tot / len(names)

    best = None
    for L in range(min_len - min_len % fstep, max_len + 1, fstep):
        for s in range(f0, f1 - L + 1):
            d = dist(s, s + L)
            if best is None or d < best[0]:
                best = (d, s, L)
    d, s, L = best
    print(f"LOOP: window {s}..{s + L} ({L} src frames) seam {d:.4f} rad/bone; one src frame of motion ~{dist(s, s + 1):.4f}")
    return s, L


def _depth(b):
    d = 0
    while b.parent:
        b = b.parent
        d += 1
    return d


def retarget_bvh(arm, bvh_path, name, fstep, bvh_map=BVH_MAP, extra_keys=None, window=None):
    """Retarget a BVH onto `arm` as a new looping Action `name`, stashed on its own NLA track (so
    glTF exports it as a named animation). Each source bone's rotation RELATIVE TO ITS REST is
    copied onto the matching target bone relative to ITS rest (handles different rest poses).
    Rotations only → an in-place clip (the scene translates the character). Samples every `fstep`
    source frame over `window` = (start, length), or the cleanest whole cycle (best_loop) when
    None — exclusive end, so the frame after the last key is the first key and the loop tiles.
    `extra_keys(frame)` may keyframe extra constant pose (e.g. relaxed fingers) at `frame`."""
    pb = arm.pose.bones
    ad = arm.animation_data or arm.animation_data_create()
    before = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(filepath=bvh_path, axis_forward='-Z', axis_up='Y', use_fps_scale=False)
    src = next(o for o in bpy.data.objects if o not in before and o.type == 'ARMATURE')
    imp_act = src.animation_data.action if src.animation_data else None  # the raw BVH action (drop later)
    s, L = window or best_loop(src, fstep)
    fstart, fend = s, s + L - fstep
    pairs = {tb: sb for tb, sb in bvh_map.items() if tb in pb and sb in src.pose.bones}
    tgt_rest = {tb: arm.data.bones[tb].matrix_local.to_3x3() for tb in pairs}
    src_rest = {tb: src.data.bones[sb].matrix_local.to_3x3() for tb, sb in pairs.items()}
    order = sorted(pairs, key=lambda b: _depth(arm.data.bones[b]))  # parents first
    for b in pb:
        b.rotation_mode = 'XYZ'  # keyframe euler (matches the hand-keyed clips' mode at export time)
    act = bpy.data.actions.new(name + "_rt")  # temp name so it won't collide with the BVH action
    ad.action = act
    bpy.context.view_layer.objects.active = arm
    of = 1
    for f in range(fstart, fend + 1, fstep):
        bpy.context.scene.frame_set(f)
        se = src.evaluated_get(bpy.context.evaluated_depsgraph_get())  # animated pose lives on the evaluated copy
        for tb in order:
            Rw = se.pose.bones[pairs[tb]].matrix.to_3x3() @ src_rest[tb].inverted() @ tgt_rest[tb]
            p = pb[tb]
            p.matrix = mathutils.Matrix.Translation(p.matrix.to_translation()) @ Rw.to_4x4()
            bpy.context.view_layer.update()  # so children read the updated parent pose
            p.keyframe_insert("rotation_euler", frame=of)
        of += 1
    if extra_keys:
        extra_keys(1)
    trk = ad.nla_tracks.new()
    trk.name = name
    trk.strips.new(name, 1, act)
    ad.action = None
    bpy.data.objects.remove(src, do_unlink=True)
    if imp_act:
        try:
            bpy.data.actions.remove(imp_act)  # free the raw BVH action's name
        except Exception:
            pass
    act.name = name  # now safe to claim "walk"
    print(f"RETARGET {name}: {len(pairs)} bones, {of - 1} frames from {os.path.basename(bvh_path)} (src {fstart}..{fend + fstep})")
    return act
