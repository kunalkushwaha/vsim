# assetkit.building — parametric buildings from a small description ("BuildingDoc").
#
#   import building; root = building.build_building(building.PRESETS["haveli"], name="haveli")
#
# Built for films and explainers: one doc -> a whole building with real-world scale (metres,
# ground at z=0, front facade facing -Y), two looks from the same geometry
# (style "realistic" = CC0 PBR textures, "explainer" = clean flat colours), and animatable
# states a scene needs — every window's glass reads the material value "night" (0 day -> 1 all
# lit, keyframable) and each door leaf is its own object pivoting at the hinge, driven by the
# root's custom property "door_open" (0 shut -> 1 open; keyframe it, or after setting it from a
# script call root.update_tag() so the depsgraph re-evaluates the drivers).
# Repeated wall panels/windows are linked duplicates (instancing), so streets stay light.
import json, math, os, random
import bpy, bmesh
from mathutils import Matrix, Vector

TEX_INDEX = os.path.expanduser("~/.cache/vsim-assets/ambientcg/index.json")

PRESETS = {
    "haveli": {
        "style": "realistic",
        "width": 13.0, "depth": 10.0, "floors": 3, "floor_height": 3.5, "plinth": 0.7, "bay_width": 2.6,
        "wall": {"texture": "plaster", "tint": [1.0, 0.72, 0.42], "scale": 2.5},
        "trim": {"texture": "stone", "tint": [0.95, 0.80, 0.62], "scale": 1.5},
        "window": {"shape": "arch", "width": 1.0, "height": 1.8, "sill": 0.9, "frame": 0.14, "shutters": False},
        "ground": {"type": "arcade", "width": 1.8, "height": 2.7},
        "door": {"shape": "arch", "width": 1.8, "height": 2.9},
        "jharokha": {"floors": [1, 2], "bays": "alternate"},
        "balcony": None,
        "roof": {"type": "parapet", "parapet": 1.0, "chhatri": True},
    },
    "modern": {
        "style": "realistic",
        "width": 14.0, "depth": 11.0, "floors": 5, "floor_height": 3.2, "plinth": 0.3, "bay_width": 3.4,
        "wall": {"texture": "plaster_old", "tint": [0.92, 0.92, 0.9], "scale": 3.0},
        "trim": {"texture": None, "tint": [0.25, 0.26, 0.28], "scale": 1.0},
        "window": {"shape": "rect", "width": 2.4, "height": 2.2, "sill": 0.55, "frame": 0.06, "shutters": False},
        "ground": {"type": "glass", "width": 2.8, "height": 2.6},
        "door": {"shape": "rect", "width": 1.8, "height": 2.4},
        "jharokha": None,
        "balcony": {"floors": [1, 2, 3, 4], "depth": 1.1, "bays": "alternate"},
        "roof": {"type": "parapet", "parapet": 0.6, "chhatri": False},
    },
    "cottage": {
        "style": "realistic",
        "width": 9.0, "depth": 7.0, "floors": 2, "floor_height": 2.9, "plinth": 0.4, "bay_width": 2.2,
        "wall": {"texture": "brick", "tint": [1.0, 1.0, 1.0], "scale": 1.6},
        "trim": {"texture": "wood", "tint": [0.85, 0.85, 0.85], "scale": 1.0},
        "window": {"shape": "rect", "width": 1.0, "height": 1.3, "sill": 0.9, "frame": 0.1, "shutters": True},
        "ground": {"type": "windows"},
        "door": {"shape": "rect", "width": 1.1, "height": 2.2},
        "jharokha": None, "balcony": None,
        "roof": {"type": "gable", "pitch": 38, "overhang": 0.5},
    },
}

FLAT = {  # explainer palette per role
    "wall": None, "trim": [0.98, 0.96, 0.92], "glass": [0.35, 0.55, 0.75], "wood": [0.55, 0.32, 0.18],
    "roof": [0.70, 0.30, 0.22], "metal": [0.25, 0.26, 0.28],
}


# --------------------------------------------------------------------------- materials
def _tex_index():
    try:
        return json.load(open(TEX_INDEX))
    except Exception:
        return {}


def _bsdf(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def pbr_material(name, key, tint=(1, 1, 1), scale=2.0, style="realistic", flat=None, rough=0.8):
    """Tileable PBR material, box-projected in WORLD space (no per-panel repetition)."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = _bsdf(m); N = nt.nodes.new; L = nt.links.new
    tex = _tex_index().get(key) if key else None
    if style == "explainer" or not tex:
        col = flat or tint
        b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
        if style != "explainer" and key:
            m["texture_missing"] = key      # realistic look requested but the CC0 cache is absent
        return m
    geo = N("ShaderNodeNewGeometry"); mp = N("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / scale,) * 3
    L(geo.outputs["Position"], mp.inputs["Vector"])

    def img(path, noncolor):
        n = N("ShaderNodeTexImage"); n.image = bpy.data.images.load(path, check_existing=True)
        n.projection = "BOX"; n.projection_blend = 0.25
        if noncolor: n.image.colorspace_settings.name = "Non-Color"
        L(mp.outputs[0], n.inputs["Vector"]); return n
    maps = tex["maps"]
    c = img(maps["color"], False)
    tn = N("ShaderNodeMix"); tn.data_type = "RGBA"; tn.blend_type = "MULTIPLY"; tn.inputs[0].default_value = 1.0
    tn.inputs[7].default_value = (*tint, 1); L(c.outputs[0], tn.inputs[6]); L(tn.outputs[2], b.inputs["Base Color"])
    if "roughness" in maps:
        L(img(maps["roughness"], True).outputs[0], b.inputs["Roughness"])
    if "normal" in maps:
        nm = N("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = 0.8
        L(img(maps["normal"], True).outputs[0], nm.inputs["Color"]); L(nm.outputs[0], b.inputs["Normal"])
    m["texture"] = tex["id"]
    return m


def glass_material(name, style):
    """Window glass. Value node 'night' (0..1) lights windows; Object Info random varies which."""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = _bsdf(m); N = nt.nodes.new; L = nt.links.new
    col = FLAT["glass"] if style == "explainer" else [0.04, 0.06, 0.08]
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = 0.05
    b.inputs["Metallic"].default_value = 0.0 if style == "explainer" else 0.6
    night = N("ShaderNodeValue"); night.name = "night"; night.label = "night"; night.outputs[0].default_value = 0.0
    oi = N("ShaderNodeObjectInfo")
    lt = N("ShaderNodeMath"); lt.operation = "LESS_THAN"          # this window lit if random < night
    L(oi.outputs["Random"], lt.inputs[0]); L(night.outputs[0], lt.inputs[1])
    st = N("ShaderNodeMath"); st.operation = "MULTIPLY"; st.inputs[1].default_value = 6.0
    L(lt.outputs[0], st.inputs[0])
    b.inputs["Emission Color"].default_value = (1.0, 0.68, 0.35, 1)
    L(st.outputs[0], b.inputs["Emission Strength"])
    return m


def flat_material(name, col, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = _bsdf(m)
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


# --------------------------------------------------------------------------- 2D outlines
def window_outline(shape, w, h, n=48):
    """CCW points (x, z) of an opening, origin at its bottom centre."""
    pts = []
    if shape == "arch":
        r = w / 2; spring = h - r
        k_side = n // 4; k_arc = n - 2 * k_side - 2
        pts.append((w / 2, 0.0))
        for i in range(1, k_side + 1): pts.append((w / 2, spring * i / k_side))
        for i in range(1, k_arc + 1):
            a = math.pi * i / (k_arc + 1); pts.append((r * math.cos(a), spring + r * math.sin(a)))
        for i in range(k_side, 0, -1): pts.append((-w / 2, spring * i / k_side))
        pts.append((-w / 2, 0.0))
        for i in range(1, n - len(pts) + 1): pts.append((-w / 2 + w * i / (n - len(pts) + 1), 0.0))
    else:
        per = 2 * (w + h); step = per / n
        for i in range(n):
            d = i * step
            if d < h: pts.append((w / 2, d))
            elif d < h + w: pts.append((w / 2 - (d - h), h))
            elif d < 2 * h + w: pts.append((-w / 2, h - (d - h - w)))
            else: pts.append((-w / 2 + (d - 2 * h - w), 0.0))
    return pts


def _ray_rect(c, d, w, h):
    """Distance from c along direction d to the boundary of rect [0,w]x[0,h]."""
    ts = []
    for i, lim in ((0, (0, w)), (1, (0, h))):
        if abs(d[i]) > 1e-9:
            for b in lim:
                t = (b - c[i]) / d[i]
                if t > 0: ts.append(t)
    return min(ts)


# --------------------------------------------------------------------------- meshes
def panel_mesh(name, pw, ph, opening=None, n=48):
    """Wall panel in the XZ plane (front face -Y), [0,pw]x[0,ph], optional opening
    opening = (shape, w, h, bottom_z) centred horizontally."""
    bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap")
    if not opening:
        vs = [bm.verts.new((0, 0, 0)), bm.verts.new((pw, 0, 0)), bm.verts.new((pw, 0, ph)), bm.verts.new((0, 0, ph))]
        bm.faces.new(vs)
    else:
        shape, w, h, z0 = opening
        ol = [(pw / 2 + x, z0 + z) for x, z in window_outline(shape, w, h, n)]
        c = (pw / 2, z0 + h * 0.5)
        inner, outer = [], []
        for (x, z) in ol:
            d = (x - c[0], z - c[1]); L_ = math.hypot(*d); d = (d[0] / L_, d[1] / L_)
            t = _ray_rect(c, d, pw, ph)
            inner.append(bm.verts.new((x, 0, z))); outer.append(bm.verts.new((c[0] + d[0] * t, 0, c[1] + d[1] * t)))
        for k in range(n):
            k2 = (k + 1) % n
            bm.faces.new((outer[k], outer[k2], inner[k2], inner[k]))
        # corners: rays never hit exact rect corners -> add corner fill triangles
        for cx, cz in ((0, 0), (pw, 0), (pw, ph), (0, ph)):
            cv = bm.verts.new((cx, 0, cz))
            best = min(range(n), key=lambda k: (outer[k].co.x - cx) ** 2 + (outer[k].co.z - cz) ** 2)
            ang = lambda v: math.atan2(v.co.z - c[1], v.co.x - c[0])
            a_c = math.atan2(cz - c[1], cx - c[0])
            k1 = best if ang(outer[best]) <= a_c else (best - 1) % n
            k2 = (k1 + 1) % n
            try: bm.faces.new((outer[k1], cv, outer[k2]))
            except ValueError: pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.y > 0: f.normal_flip()
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    return me


def ring_mesh(name, shape, w, h, frame, depth, n=48):
    """Window/door frame: outline ring of width `frame`, extruded `depth` toward -Y."""
    inner = window_outline(shape, w, h, n)
    outer = window_outline(shape, w + 2 * frame, h + frame, n)
    outer = [(x, z - frame * 0.0) for x, z in outer]
    bm = bmesh.new()
    fi = [bm.verts.new((x, -depth, z)) for x, z in inner]; fo = [bm.verts.new((x, -depth, z)) for x, z in outer]
    bi = [bm.verts.new((x, 0, z)) for x, z in inner]; bo = [bm.verts.new((x, 0, z)) for x, z in outer]
    for k in range(n):
        k2 = (k + 1) % n
        bm.faces.new((fo[k], fo[k2], fi[k2], fi[k]))     # front
        bm.faces.new((fi[k], fi[k2], bi[k2], bi[k]))     # inner reveal
        bm.faces.new((bo[k], bo[k2], fo[k2], fo[k]))     # outer side
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    return me


def disc_mesh(name, shape, w, h, n=48):
    bm = bmesh.new(); vs = [bm.verts.new((x, 0, z)) for x, z in window_outline(shape, w, h, n)]
    bm.faces.new(vs); me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); return me


def box(name, size, loc, mat, parent, rot=(0, 0, 0)):
    """Unit-cube instance (shared mesh) with a per-object material."""
    me = bpy.data.meshes.get("_unit_box")
    if me is None:
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
        me = bpy.data.meshes.new("_unit_box"); bm.to_mesh(me); bm.free(); me.materials.append(None)
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    o.parent = parent; o.location = loc; o.scale = size; o.rotation_euler = rot
    o.material_slots[0].link = "OBJECT"; o.material_slots[0].material = mat
    return o


def obj(name, me, parent, mw):
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    o.parent = parent; o.matrix_world = mw
    return o


# --------------------------------------------------------------------------- facade
def _facade(doc, root, mats, side, length, origin, rot_z, front):
    """Build one facade of `length` m starting at `origin`, rotated rot_z (front faces -Y before rotation)."""
    F, FH, PL = doc["floors"], doc["floor_height"], doc["plinth"]
    nb = max(1, round(length / doc["bay_width"])); bw = length / nb
    win = doc["window"]; base = Matrix.Translation(origin) @ Matrix.Rotation(rot_z, 4, "Z")
    panels = {}

    def panel(kind, ph, opening):
        key = (kind, round(bw, 3), round(ph, 3), opening)
        if key not in panels:
            me = panel_mesh("panel_%s_%d" % (kind, len(panels)), bw, ph, opening)
            me.materials.append(mats["wall"]); panels[key] = me
        return panels[key]
    ring_cache, glass_cache = {}, {}

    def window_parts(shape, w, h, x, z, frame, depth_in=0.18, glass=True, name="win"):
        k = (shape, round(w, 3), round(h, 3), round(frame, 3))
        if k not in ring_cache:
            r = ring_mesh("frame_%s_%d" % (shape, len(ring_cache)), shape, w, h, frame, 0.07); r.materials.append(mats["trim"])
            g = disc_mesh("glass_%s_%d" % (shape, len(glass_cache)), shape, w, h); g.materials.append(mats["glass"])
            ring_cache[k] = r; glass_cache[k] = g
        obj("%s_%s_frame" % (side, name), ring_cache[k], root, base @ Matrix.Translation((x, -0.001, z)))
        if glass:
            obj("%s_%s_glass" % (side, name), glass_cache[k], root, base @ Matrix.Translation((x, depth_in, z)))
        # sill
        box("%s_%s_sill" % (side, name), (w + 0.3, 0.16, 0.08), (0, 0, 0), mats["trim"], root).matrix_world = \
            base @ Matrix.Translation((x, -0.08, z - 0.04)) @ Matrix.Diagonal((w + 0.3, 0.16, 0.08, 1))
    # ground-floor plinth
    pl = box("%s_plinth" % side, (1, 1, 1), (0, 0, 0), mats["trim"], root)
    pl.matrix_world = base @ Matrix.Translation((length / 2, 0.0, PL / 2)) @ Matrix.Diagonal((length + 0.3, 0.5, PL, 1))
    door_bay = nb // 2 if front else -1
    for f in range(F):
        z0 = PL + f * FH
        for b in range(nb):
            x0 = b * bw; xc = x0 + bw / 2
            g = doc.get("ground") or {}
            if f == 0 and b == door_bay:
                d = doc["door"]; op = (d["shape"], d["width"], d["height"], 0.0)
                obj("%s_door_panel" % side, panel("door", FH, op), root, base @ Matrix.Translation((x0, 0, z0)))
                window_parts(d["shape"], d["width"], d["height"], xc, z0, 0.18, glass=False, name="door")
                # two door leaves, hinged at the jambs, keyframable via ["door_open"]
                for s in (-1, 1):
                    hx = xc + s * d["width"] / 2
                    pivot = bpy.data.objects.new("%s_door_hinge_%s" % (side, "L" if s < 0 else "R"), None)
                    bpy.context.scene.collection.objects.link(pivot); pivot.parent = root; pivot.empty_display_size = 0.2
                    pivot.matrix_world = base @ Matrix.Translation((hx, 0.12, z0))
                    leaf = box("%s_door_leaf_%s" % (side, "L" if s < 0 else "R"), (1, 1, 1), (0, 0, 0), mats["wood"], pivot)
                    leaf.parent = pivot; leaf.matrix_parent_inverse = Matrix()
                    lh = d["height"] - (d["width"] / 2 if d["shape"] == "arch" else 0)
                    leaf.location = (-s * d["width"] / 4, 0, lh / 2); leaf.scale = (d["width"] / 2 - 0.02, 0.08, lh)
                    root["door_open"] = 0.0
                    fc = pivot.driver_add("rotation_euler", 2).driver
                    fc.type = "SCRIPTED"; v = fc.variables.new(); v.name = "o"; v.targets[0].id = root
                    v.targets[0].data_path = '["door_open"]'; fc.expression = "%s*o*1.7" % ("-1" if s < 0 else "1")
                # dark interior behind the door
                box("%s_door_dark" % side, (1, 1, 1), (0, 0, 0), mats["dark"], root).matrix_world = \
                    base @ Matrix.Translation((xc, 0.6, z0 + d["height"] / 2)) @ Matrix.Diagonal((d["width"] + 0.2, 0.05, d["height"], 1))
                continue
            if f == 0 and g.get("type") in ("arcade", "glass"):
                op = ("arch" if g["type"] == "arcade" else "rect", g["width"], g["height"], 0.0)
                obj("%s_g_%d" % (side, b), panel("ground", FH, op), root, base @ Matrix.Translation((x0, 0, z0)))
                window_parts(op[0], g["width"], g["height"], xc, z0, 0.16, glass=(g["type"] == "glass"),
                             depth_in=0.25, name="g%d" % b)
                if g["type"] == "arcade":
                    box("%s_g%d_dark" % (side, b), (1, 1, 1), (0, 0, 0), mats["dark"], root).matrix_world = \
                        base @ Matrix.Translation((xc, 1.2, z0 + g["height"] / 2)) @ Matrix.Diagonal((g["width"] + 0.3, 0.05, g["height"], 1))
                continue
            op = (win["shape"], win["width"], win["height"], win["sill"])
            obj("%s_p_%d_%d" % (side, f, b), panel("win", FH, op), root, base @ Matrix.Translation((x0, 0, z0)))
            window_parts(win["shape"], win["width"], win["height"], xc, z0 + win["sill"], win["frame"], name="w%d_%d" % (f, b))
            if win.get("shutters"):
                for s in (-1, 1):
                    box("%s_sh_%d_%d_%d" % (side, f, b, s), (1, 1, 1), (0, 0, 0), mats["wood"], root).matrix_world = \
                        base @ Matrix.Translation((xc + s * (win["width"] * 0.75 + 0.05), -0.06, z0 + win["sill"] + win["height"] / 2)) \
                        @ Matrix.Diagonal((win["width"] / 2, 0.04, win["height"], 1))
            jh = doc.get("jharokha")
            if front and jh and f in jh["floors"] and (jh["bays"] != "alternate" or b % 2 == 1):
                _jharokha(side, root, mats, base, xc, z0 + win["sill"], win)
            bal = doc.get("balcony")
            if front and bal and f in bal["floors"] and (bal["bays"] != "alternate" or b % 2 == 0):
                _balcony(side, root, mats, base, xc, z0, bw, bal["depth"])
        # floor band
        box("%s_band_%d" % (side, f), (1, 1, 1), (0, 0, 0), mats["trim"], root).matrix_world = \
            base @ Matrix.Translation((length / 2, -0.06, z0 + FH - 0.1)) @ Matrix.Diagonal((length + 0.2, 0.2, 0.2, 1))
    # cornice
    top = PL + F * FH
    box("%s_cornice" % side, (1, 1, 1), (0, 0, 0), mats["trim"], root).matrix_world = \
        base @ Matrix.Translation((length / 2, -0.15, top + 0.12)) @ Matrix.Diagonal((length + 0.5, 0.45, 0.25, 1))
    # corner pilasters hide panel seams at the building corners
    for x in (0.0, length):
        box("%s_corner_%d" % (side, int(x)), (1, 1, 1), (0, 0, 0), mats["trim"], root).matrix_world = \
            base @ Matrix.Translation((x, 0.0, (PL + top) / 2)) @ Matrix.Diagonal((0.35, 0.35, top - PL, 1))
    return top


def _jharokha(side, root, mats, base, xc, zs, win):
    """Projecting balcony window: corbel, floor slab, two pillars, chhajja canopy and a small dome."""
    w = win["width"] + 0.6; d = 0.8; h = win["height"] + 0.2
    T = lambda x, y, z: base @ Matrix.Translation((xc + x, y, zs + z))
    box(side + "_jh_corbel", (1, 1, 1), (0, 0, 0), mats["trim"], root).matrix_world = T(0, -d / 2, -0.35) @ Matrix.Diagonal((w * 0.8, d * 0.8, 0.5, 1))
    box(side + "_jh_slab", (1, 1, 1), (0, 0, 0), mats["trim"], root).matrix_world = T(0, -d / 2, -0.05) @ Matrix.Diagonal((w + 0.1, d + 0.1, 0.12, 1))
    for s in (-1, 1):
        box(side + "_jh_pillar", (1, 1, 1), (0, 0, 0), mats["trim"], root).matrix_world = T(s * (w / 2 - 0.08), -d + 0.08, h / 2) @ Matrix.Diagonal((0.12, 0.12, h, 1))
    box(side + "_jh_rail", (1, 1, 1), (0, 0, 0), mats["trim"], root).matrix_world = T(0, -d + 0.06, 0.35) @ Matrix.Diagonal((w, 0.08, 0.6, 1))
    box(side + "_jh_chhajja", (1, 1, 1), (0, 0, 0), mats["trim"], root, rot=(0, 0, 0)).matrix_world = \
        T(0, -d / 2 - 0.1, h + 0.08) @ Matrix.Rotation(math.radians(-12), 4, "X") @ Matrix.Diagonal((w + 0.4, d + 0.5, 0.1, 1))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=24, ring_count=12)
    dm = bpy.context.object; dm.name = side + "_jh_dome"; dm.parent = root
    dm.matrix_world = T(0, -d / 2, h + 0.2) @ Matrix.Diagonal((w * 0.42, d * 0.55, 0.45, 1))
    bm = bmesh.new(); bm.from_mesh(dm.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01], context="VERTS"); bm.to_mesh(dm.data); bm.free()
    for p in dm.data.polygons: p.use_smooth = True
    dm.data.materials.append(mats["trim"])


def _balcony(side, root, mats, base, xc, z0, bw, depth):
    T = lambda x, y, z: base @ Matrix.Translation((xc + x, y, z0 + z))
    box(side + "_bal_slab", (1, 1, 1), (0, 0, 0), mats["trim"], root).matrix_world = T(0, -depth / 2, 0.0) @ Matrix.Diagonal((bw * 0.9, depth, 0.18, 1))
    box(side + "_bal_glass", (1, 1, 1), (0, 0, 0), mats["rail"], root).matrix_world = T(0, -depth + 0.03, 0.55) @ Matrix.Diagonal((bw * 0.9, 0.03, 0.95, 1))
    box(side + "_bal_rail", (1, 1, 1), (0, 0, 0), mats["metal"], root).matrix_world = T(0, -depth + 0.03, 1.05) @ Matrix.Diagonal((bw * 0.9, 0.06, 0.05, 1))


def _roof(doc, root, mats, W, D, top):
    r = doc["roof"]
    if r["type"] == "parapet":
        box("roof_slab", (1, 1, 1), (0, 0, 0), mats["trim"], root).matrix_world = Matrix.Translation((0, 0, top + 0.05)) @ Matrix.Diagonal((W, D, 0.2, 1))
        ph = r.get("parapet", 0.9)
        for name, loc, size in [("pf", (0, -D / 2, top + ph / 2), (W + 0.3, 0.25, ph)), ("pb", (0, D / 2, top + ph / 2), (W + 0.3, 0.25, ph)),
                                ("pl", (-W / 2, 0, top + ph / 2), (0.25, D, ph)), ("pr", (W / 2, 0, top + ph / 2), (0.25, D, ph))]:
            box("roof_" + name, (1, 1, 1), (0, 0, 0), mats["wall"], root).matrix_world = Matrix.Translation(loc) @ Matrix.Diagonal((*size, 1))
        if r.get("chhatri"):
            for sx in (-1, 1):
                for sy in (-1, 1):
                    _chhatri(root, mats, Vector((sx * (W / 2 - 0.9), sy * (D / 2 - 0.9), top + 0.15)))  # on the roof slab
    else:  # gable: ridge along X
        pitch = math.radians(r.get("pitch", 35)); ov = r.get("overhang", 0.4)
        rise = (D / 2) * math.tan(pitch)
        bm = bmesh.new()
        hx, hy = W / 2 + ov, D / 2 + ov
        v = [bm.verts.new(p) for p in [(-hx, -hy, top - ov * math.tan(pitch)), (hx, -hy, top - ov * math.tan(pitch)),
                                        (hx, 0, top + rise), (-hx, 0, top + rise),
                                        (-hx, hy, top - ov * math.tan(pitch)), (hx, hy, top - ov * math.tan(pitch))]]
        bm.faces.new((v[0], v[1], v[2], v[3])); bm.faces.new((v[3], v[2], v[5], v[4]))
        me = bpy.data.meshes.new("roof"); bm.to_mesh(me); bm.free(); me.materials.append(mats["roof"])
        ro = obj("roof", me, root, Matrix()); so = ro.modifiers.new("t", "SOLIDIFY"); so.thickness = 0.15
        # gable end walls (triangles)
        for s in (-1, 1):
            bm = bmesh.new()
            tv = [bm.verts.new((s * W / 2, -D / 2, top)), bm.verts.new((s * W / 2, D / 2, top)), bm.verts.new((s * W / 2, 0, top + rise))]
            bm.faces.new(tv); me2 = bpy.data.meshes.new("gable"); bm.to_mesh(me2); bm.free(); me2.materials.append(mats["wall"])
            g = obj("gable_%d" % s, me2, root, Matrix()); g.modifiers.new("t", "SOLIDIFY").thickness = 0.3


def _chhatri(root, mats, base):
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("chhatri_col", (1, 1, 1), (0, 0, 0), mats["trim"], root).matrix_world = \
                Matrix.Translation(base + Vector((sx * 0.45, sy * 0.45, 0.7))) @ Matrix.Diagonal((0.12, 0.12, 1.4, 1))
    box("chhatri_slab", (1, 1, 1), (0, 0, 0), mats["trim"], root).matrix_world = Matrix.Translation(base + Vector((0, 0, 1.45))) @ Matrix.Diagonal((1.3, 1.3, 0.12, 1))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=24, ring_count=12)
    dm = bpy.context.object; dm.name = "chhatri_dome"; dm.parent = root
    dm.matrix_world = Matrix.Translation(base + Vector((0, 0, 1.5))) @ Matrix.Diagonal((0.62, 0.62, 0.75, 1))
    bm = bmesh.new(); bm.from_mesh(dm.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01], context="VERTS"); bm.to_mesh(dm.data); bm.free()
    for p in dm.data.polygons: p.use_smooth = True
    dm.data.materials.append(mats["trim"])
    bpy.ops.mesh.primitive_cone_add(radius1=0.06, radius2=0.0, depth=0.4, location=base + Vector((0, 0, 2.4)))
    fin = bpy.context.object; fin.name = "chhatri_finial"; fin.parent = root; fin.data.materials.append(mats["trim"])


# --------------------------------------------------------------------------- entry point
def build_building(doc, name="building", location=(0, 0, 0), rot_z=0.0, style=None):
    style = style or doc.get("style", "realistic")
    root = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(root)
    root.empty_display_size = 0.5; root["building_doc"] = json.dumps(doc)
    W, D = doc["width"], doc["depth"]
    wall_c = doc["wall"]["tint"]
    mats = {
        "wall": pbr_material(name + "_wall", doc["wall"]["texture"], wall_c, doc["wall"]["scale"], style,
                             flat=[min(1, c) for c in wall_c]),
        "trim": pbr_material(name + "_trim", doc["trim"]["texture"], doc["trim"]["tint"], doc["trim"]["scale"], style,
                             flat=FLAT["trim"] if doc["trim"]["texture"] else doc["trim"]["tint"]),
        "glass": glass_material(name + "_glass", style),
        "wood": pbr_material(name + "_wood", "wood", (0.7, 0.5, 0.35), 1.0, style, flat=FLAT["wood"], rough=0.6),
        "roof": pbr_material(name + "_roof", "roof_tiles", (1, 1, 1), 2.0, style, flat=FLAT["roof"]),
        "dark": flat_material(name + "_dark", (0.02, 0.018, 0.016), 0.9),
        "metal": flat_material(name + "_metal", FLAT["metal"], 0.35, 0.8),
        "rail": flat_material(name + "_rail", (0.6, 0.75, 0.8), 0.05, 0.0),
    }
    # four facades: front (-Y), right (+X), back (+Y), left (-X); each starts at its left corner
    top = _facade(doc, root, mats, "front", W, Vector((-W / 2, -D / 2, 0)), 0.0, True)
    _facade(doc, root, mats, "right", D, Vector((W / 2, -D / 2, 0)), math.pi / 2, False)
    _facade(doc, root, mats, "back", W, Vector((W / 2, D / 2, 0)), math.pi, False)
    _facade(doc, root, mats, "left", D, Vector((-W / 2, D / 2, 0)), -math.pi / 2, False)
    _roof(doc, root, mats, W, D, top)
    # wall panels: give them thickness (inward) so window reveals have depth
    for o in root.children_recursive:
        if o.type == "MESH" and o.data.name.startswith("panel_") and "thick" not in o.modifiers:
            so = o.modifiers.new("thick", "SOLIDIFY"); so.thickness = 0.3; so.offset = -1.0
    root.location = location; root.rotation_euler = (0, 0, rot_z)
    return root
