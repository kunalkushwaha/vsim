# assetkit.turntable — QA contact sheet for any asset in the current Blender scene.
#
#   import turntable
#   stats = turntable.turntable("rose", "/tmp/rose_qa.png", focus=lambda o: "_petal" in o.name)
#
# Renders the asset (an object and all its descendants) from several angles under a fixed,
# neutral studio rig, stitches the views into one PNG and returns stats (triangles, objects,
# materials, world size). Everything else in the scene is hidden for the shot and every
# change is restored afterwards, so it is safe to run in a live session (Blender MCP) or
# headless (blender --background).
import math, os, tempfile
import bpy
import numpy as np
from mathutils import Vector

DEFAULT_VIEWS = [(-90, 12, "front"), (-45, 30, "3/4"), (0, 12, "side"), (-90, 80, "top")]


def _descendants(root):
    out, stack = [], [root]
    while stack:
        o = stack.pop(); out.append(o); stack.extend(o.children)
    return out


def _bounds(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e9, 1e9, 1e9)); hi = -lo
    for o in objs:
        if o.type not in {"MESH", "CURVE", "SURFACE", "META", "FONT"}:
            continue
        ev = o.evaluated_get(dg)
        for c in ev.bound_box:
            w = ev.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi


def _stats(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    tris, mats, meshes = 0, set(), 0
    for o in objs:
        if o.type in {"MESH", "CURVE"}:
            ev = o.evaluated_get(dg)
            try:
                me = ev.to_mesh()
                me.calc_loop_triangles(); tris += len(me.loop_triangles); ev.to_mesh_clear(); meshes += 1
            except Exception:
                pass
            for s in o.material_slots:
                if s.material: mats.add(s.material.name)
    return {"objects": meshes, "triangles": tris, "materials": len(mats)}


def turntable(root_name, out_path, views=None, res=512, focus=None, engine="BLENDER_EEVEE", samples=32, margin=1.15):
    """Render `root_name` (+ children) from `views` [(azimuth°, elevation°, label)] into one sheet.
    `focus(obj) -> bool` limits framing to part of the asset (e.g. the flower head)."""
    sc = bpy.context.scene
    root = bpy.data.objects[root_name]
    objs = _descendants(root)
    frame_objs = [o for o in objs if focus(o)] if focus else objs
    lo, hi = _bounds(frame_objs)
    center = (lo + hi) / 2; size = (hi - lo).length
    views = views or DEFAULT_VIEWS

    # --- remember state
    saved = {"camera": sc.camera, "engine": sc.render.engine, "rx": sc.render.resolution_x, "ry": sc.render.resolution_y,
             "pct": sc.render.resolution_percentage, "path": sc.render.filepath, "world": sc.world,
             "hidden": {o.name: o.hide_render for o in sc.objects}, "film": sc.render.film_transparent}
    keep = {o.name for o in objs}
    temp = []
    try:
        for o in sc.objects:
            if o.name not in keep: o.hide_render = True
        # neutral studio world + 3-point rig scaled to the asset
        w = bpy.data.worlds.new("_tt_world"); w.use_nodes = True
        bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
        bg.inputs[0].default_value = (0.18, 0.18, 0.19, 1); bg.inputs[1].default_value = 0.35
        sc.world = w
        for name, az, el, e, col in [("_tt_key", -130, 40, 110, (1, 0.95, 0.9)), ("_tt_fill", -30, 15, 35, (0.85, 0.9, 1)),
                                     ("_tt_rim", 70, 35, 70, (1, 1, 1))]:
            ld = bpy.data.lights.new(name, "AREA"); ld.energy = e * size * size; ld.size = size * 0.8; ld.color = col
            lo_ = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo_); temp.append(lo_)
            d = Vector((math.cos(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(az)) * math.cos(math.radians(el)),
                        math.sin(math.radians(el))))
            lo_.location = center + d * size * 2.2
            lo_.rotation_euler = (center - lo_.location).to_track_quat("-Z", "Y").to_euler()
        cd = bpy.data.cameras.new("_tt_cam"); cd.lens = 50; cd.clip_start = size * 0.01; cd.clip_end = size * 100
        cam = bpy.data.objects.new("_tt_cam", cd); sc.collection.objects.link(cam); temp.append(cam); sc.camera = cam
        try:
            sc.render.engine = engine
        except TypeError:
            sc.render.engine = "CYCLES"
        if sc.render.engine == "CYCLES": sc.cycles.samples = samples
        else:
            try: sc.eevee.taa_render_samples = samples
            except Exception: pass
        sc.render.resolution_x = sc.render.resolution_y = res; sc.render.resolution_percentage = 100
        sc.render.film_transparent = False
        fov = 2 * math.atan(18 / cd.lens)
        dist = (size * margin / 2) / math.tan(fov / 2)
        tiles = []
        tmpdir = tempfile.mkdtemp(prefix="turntable_")
        for i, (az, el, label) in enumerate(views):
            d = Vector((math.cos(math.radians(az)) * math.cos(math.radians(el)), math.sin(math.radians(az)) * math.cos(math.radians(el)),
                        math.sin(math.radians(el))))
            cam.location = center + d * dist
            cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
            p = os.path.join(tmpdir, "v%d.png" % i); sc.render.filepath = p
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(p)
            a = np.array(img.pixels[:], dtype=np.float32).reshape(res, res, 4)
            bpy.data.images.remove(img); tiles.append(a)
        cols = min(len(tiles), 4); rows = math.ceil(len(tiles) / cols)
        sheet = np.ones((rows * res, cols * res, 4), dtype=np.float32) * np.array([0.05, 0.05, 0.05, 1], dtype=np.float32)
        for i, t in enumerate(tiles):
            r, c = divmod(i, cols)
            y0 = (rows - 1 - r) * res          # Blender images are bottom-up
            sheet[y0:y0 + res, c * res:(c + 1) * res] = t
        out = bpy.data.images.new("_tt_sheet", cols * res, rows * res, alpha=True)
        out.pixels = sheet.ravel().tolist()
        out.filepath_raw = out_path; out.file_format = "PNG"; out.save()
        bpy.data.images.remove(out)
    finally:
        for o in temp:
            data = o.data; bpy.data.objects.remove(o, do_unlink=True)
            if isinstance(data, bpy.types.Light): bpy.data.lights.remove(data)
            elif isinstance(data, bpy.types.Camera): bpy.data.cameras.remove(data)
        sc.camera = saved["camera"]; sc.world = saved["world"]
        if bpy.data.worlds.get("_tt_world"): bpy.data.worlds.remove(bpy.data.worlds["_tt_world"])
        try: sc.render.engine = saved["engine"]
        except TypeError: pass
        sc.render.resolution_x, sc.render.resolution_y = saved["rx"], saved["ry"]
        sc.render.resolution_percentage = saved["pct"]; sc.render.filepath = saved["path"]
        sc.render.film_transparent = saved["film"]
        for o in sc.objects:
            if o.name in saved["hidden"]: o.hide_render = saved["hidden"][o.name]
    st = _stats(objs)
    alo, ahi = _bounds(objs)                       # the WHOLE asset (Blender axes: x, depth, height)
    st["size_m"] = [round(v, 3) for v in (ahi - alo)]
    st["framed_size_m"] = [round(v, 3) for v in (hi - lo)]; st["sheet"] = out_path
    return st
