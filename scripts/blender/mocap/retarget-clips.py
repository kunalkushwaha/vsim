# Retarget CMU mocap (BVH) onto vsim's MakeHuman "game_engine" rig as RIG-AGNOSTIC motion data.
#
#   blender --background --factory-startup --python scripts/blender/mocap/retarget-clips.py -- \
#       <ref.glb> <clips.json> <bvh_dir> <out.json>
#
# For every clip in clips.json ({name, bvh, start, end, loop, ...}) this samples the BVH at 30 fps
# and writes, per mapped target bone and frame, the bone's WORLD-space rotation DELTA from its
# rest pose (quaternion, glTF Y-up axes) plus the hips' height offset in metres for the reference
# body. scripts/mocap-merge.mjs turns that into joint-local glTF channels against each library
# GLB's own rest pose, so the exporter's bone-axis conventions never matter and every MakeHuman
# body (woman, man, kid, suited, speaker — same skeleton) gets the same clips.
#
# Per clip:
#  - heading: the subject's average facing over the window (from the hip line) is turned to the
#    rig's forward, so trials recorded facing any direction come out facing +z in vsim;
#  - in place: horizontal hip travel is dropped (films move the character node) — except clips
#    marked `travel` (sit down / stand up), which keep the hips' horizontal offset from the clip's
#    first frame so the feet stay planted while the hips move back over the seat;
#  - height: hip height follows the mocap, scaled by leg length (sitting really sits);
#  - loop: the last `blend` frames crossfade into the frames just before `start`, so a cyclic
#    clip loops without a pop.
import bpy, json, math, os, sys
import mathutils
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
REF_GLB, CLIPS_JSON, BVH_DIR, OUT = argv[:4]
FPS_OUT = 30
STAND = 1.19

BVH_MAP = {
    "pelvis": "Hips", "spine_01": "LowerBack", "spine_02": "Spine", "spine_03": "Spine1", "neck_01": "Neck", "head": "Head",
    "clavicle_l": "LeftShoulder", "upperarm_l": "LeftArm", "lowerarm_l": "LeftForeArm", "hand_l": "LeftHand",
    "clavicle_r": "RightShoulder", "upperarm_r": "RightArm", "lowerarm_r": "RightForeArm", "hand_r": "RightHand",
    "thigh_l": "LeftUpLeg", "calf_l": "LeftLeg", "foot_l": "LeftFoot", "ball_l": "LeftToeBase",
    "thigh_r": "RightUpLeg", "calf_r": "RightLeg", "foot_r": "RightFoot", "ball_r": "RightToeBase",
}
# Blender Z-up world -> glTF Y-up world: (x, y, z) -> (x, z, -y)
C = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))
CI = C.inverted()


def depth(b):
    d = 0
    while b.parent: b = b.parent; d += 1
    return d


def leg_length(arm, up, low, foot):
    bl = arm.data.bones
    return (bl[up].head_local - bl[low].head_local).length + (bl[low].head_local - bl[foot].head_local).length


for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=REF_GLB)
tgt = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
if tgt.animation_data: tgt.animation_data.action = None
Mt = tgt.matrix_world.to_3x3()
tgt_rest = {b: Mt @ tgt.data.bones[b].matrix_local.to_3x3() for b in BVH_MAP}  # world rest rotations
tgt_hip_rest = (tgt.matrix_world @ tgt.data.bones["pelvis"].head_local).z
scene = bpy.context.scene
clips = json.load(open(CLIPS_JSON))["clips"]
out = {"fps": FPS_OUT, "axes": "glTF y-up world", "rotation": "world delta from rest, [x,y,z,w]",
       "hip_rest_m": tgt_hip_rest, "clips": []}

for spec in clips:
    before = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(filepath=os.path.join(BVH_DIR, spec["bvh"]), axis_forward='-Z', axis_up='Y',
                            use_fps_scale=False, global_scale=1.0)
    src = next(o for o in bpy.data.objects if o not in before and o.type == 'ARMATURE')
    Ms = src.matrix_world.to_3x3()
    src_rest = {tb: Ms @ src.data.bones[sb].matrix_local.to_3x3() for tb, sb in BVH_MAP.items() if sb in src.data.bones}
    pairs = {tb: sb for tb, sb in BVH_MAP.items() if sb in src.pose.bones}
    step = spec.get("step", 4)                         # 120 fps mocap -> 30 fps
    blend = spec.get("blend", 6) if spec.get("loop") else 0
    start, end = spec["start"], spec["end"]
    # BVH is in the subject's units (CMU: inches*scale) — normalise by leg length.
    src_leg = leg_length(src, "LeftUpLeg", "LeftLeg", "LeftFoot")

    def sample(f):
        scene.frame_set(f)
        se = src.evaluated_get(bpy.context.evaluated_depsgraph_get())
        world = {tb: Ms @ se.pose.bones[sb].matrix.to_3x3() for tb, sb in pairs.items()}
        hips = src.matrix_world @ se.pose.bones["Hips"].head
        l = src.matrix_world @ se.pose.bones["LeftUpLeg"].head
        r = src.matrix_world @ se.pose.bones["RightUpLeg"].head
        fwd = (l - r).cross(Vector((0, 0, 1)))       # left x up = forward (matches the rig: -y)
        fwd.z = 0
        return world, hips, fwd

    # Loop point search: a cyclic clip's start AND end move (within ±`search` frames) to the pair
    # whose seam best matches in pose and velocity — end ≈ the frame before start, end-1 ≈ two
    # before — so the crossfade bridges a pause, not the middle of a gesture.
    search = spec.get("search", 120) if spec.get("loop") else 0
    first = max(1, start - search - (blend + 2) * step)
    frames = list(range(first, end + search + 1, step))
    samples = [sample(f) for f in frames]
    if search:
        Q = {f: {b: w.to_quaternion() for b, w in s_[0].items()} for s_, f in zip(samples, frames)}
        def dist(a, b):
            return sum(min(1.0, Q[a][k].rotation_difference(Q[b][k]).angle) for k in Q[a])
        best = None
        for s0 in [f for f in frames if start - search <= f <= start + search and f - 2 * step >= first + blend * step]:
            for e0 in [f for f in frames if end - search <= f <= end + search and f - s0 >= spec.get("min", 360)]:
                d = dist(e0, s0 - step) + dist(e0 - step, s0 - 2 * step)
                if best is None or d < best[0]: best = (d, s0, e0)
        _, start, end = best
        keep = [i for i, f in enumerate(frames) if start - blend * step <= f <= end]
        frames, samples = [frames[i] for i in keep], [samples[i] for i in keep]

    # Heading: average facing over the clip window -> rig forward (-y in Blender = +z in glTF).
    avg = sum((s[2] for s, f in zip(samples, frames) if f >= start), Vector((0, 0, 0)))
    yaw = math.atan2(avg.x, -avg.y)                  # angle from -y to avg (about +z)
    Y = Matrix.Rotation(-yaw, 3, 'Z')
    # A standing CMU subject's hips sit at ~STAND x (thigh->ankle length) above the floor (measured
    # 1.18-1.21 across the trials used), so this maps mocap hip height to the target body absolutely.
    ratio = tgt_hip_rest / (STAND * max(1e-6, src_leg)) if spec.get("height", True) else None

    rows = []
    for (world, hips, _), f in zip(samples, frames):
        rot = {}
        for tb in pairs:
            Rw = Y @ world[tb] @ src_rest[tb].inverted() @ tgt_rest[tb]   # target bone world rotation
            D = Rw @ tgt_rest[tb].inverted()                               # world delta from rest
            q = (C @ D @ CI).to_quaternion()
            rot[tb] = q
        dz = (hips.z * ratio - tgt_hip_rest) if ratio else 0.0
        rows.append((f, rot, dz, Y @ Vector((hips.x, hips.y, 0)) * (ratio or 0)))
    # Anchor: "median" (default — standing gesture clips: removes the subject's own stance bias),
    # "max" (crouching clips: the highest frame is standing), "none" (absolute — sitting).
    win = [r for r in rows if r[0] >= start]
    mode = spec.get("anchor", "median")
    if ratio and mode != "none":
        zs = sorted(r[2] for r in win)
        anchor = zs[-1] if mode == "max" else zs[len(zs) // 2]
        rows = [(f, rot, dz - anchor, h) for f, rot, dz, h in rows]
    # Loop crossfade: the last `blend` frames ease into the frames just before `start`.
    if blend:
        pre = [r for r in rows if r[0] < start][-blend:]
        win = [r for r in rows if r[0] >= start]
        n = len(win)
        for j in range(blend):
            w = (j + 1) / blend                    # reaches 1: the last frame IS the frame before start
            f, rot, dz, h = win[n - blend + j]
            _, prot, pdz, _ = pre[j]
            win[n - blend + j] = (f, {b: rot[b].slerp(prot[b], w) for b in rot}, dz * (1 - w) + pdz * w, h)
        # A looping glTF clip wraps AT its duration, so its final key is never shown — repeat the
        # first pose there; the key before it (the frame before `start`) is then the last one seen.
        rows = win + [win[0]]
    else:
        rows = [r for r in rows if r[0] >= start]
    out["clips"].append({
        "name": spec["name"], "loop": bool(spec.get("loop")), "source": spec["bvh"], "ground": spec.get("ground", "lock"),
        "frames": len(rows), "yaw_fix_deg": round(math.degrees(yaw), 1),
        "bones": {b: [[round(v, 6) for v in (r[1][b].x, r[1][b].y, r[1][b].z, r[1][b].w)] for r in rows] for b in pairs},
        "hip_dy": [round(r[2], 5) for r in rows],
        # glTF axes (x, z): Blender (x, y) -> glTF (x, -y)
        **({"hip_dxz": [[round(r[3].x - rows[0][3].x, 5), round(-(r[3].y - rows[0][3].y), 5)] for r in rows]} if spec.get("travel") else {}),
    })
    act = src.animation_data.action if src.animation_data else None
    bpy.data.objects.remove(src, do_unlink=True)
    if act: bpy.data.actions.remove(act)
    print(f"RETARGET {spec['name']}: {len(pairs)} bones, {len(rows)} frames ({start}-{end}), yaw fix {math.degrees(yaw):.0f}°")

json.dump(out, open(OUT, "w"))
print("WROTE", OUT)
