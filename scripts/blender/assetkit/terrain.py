# assetkit.terrain — lakes/ponds with banks, shore materials, animated water and shore dressing.
#
#   import terrain; root = terrain.build_lake(terrain.PRESETS["village_lake"], name="lake")
#
# A LakeDoc describes a terrain patch (metres, water surface at z=0) with a lake basin whose
# shoreline is a noise-distorted ellipse. Ground materials blend by height + slope (mud under
# water -> wet sand at the waterline -> grass -> rock on steep slopes) from the cached CC0
# textures. The water surface ripples over time (keyframe-free: driven by #frame), so films
# get living water for free. Dressing: reeds, rocks, lotus pads (+ optional flora lotuses) and
# optional ghats (stone steps into the water) — each a separate object family for easy reuse.
import math, random
import bpy, bmesh
from mathutils import Vector, Matrix, noise

PRESETS = {
    "village_lake": {
        "seed": 3, "size": 70.0, "res": 220,
        "lake": {"rx": 20.0, "ry": 13.0, "irregularity": 0.22, "depth": 3.0, "shelf": 0.25},
        "banks": {"height": 0.8, "hills": 3.5, "hill_scale": 0.045},
        "water": {"color": [0.02, 0.09, 0.08], "ripple": 0.25},
        "dressing": {"reeds": 260, "rocks": 40, "lotus_pads": 70, "lotus_flowers": 0},
        "ghats": {"side": "north", "width": 16.0, "steps": 9, "step_h": 0.28, "step_d": 0.55},
    },
    "park_pond": {
        "seed": 8, "size": 40.0, "res": 160,
        "lake": {"rx": 9.0, "ry": 6.5, "irregularity": 0.3, "depth": 1.5, "shelf": 0.35},
        "banks": {"height": 0.4, "hills": 1.2, "hill_scale": 0.08},
        "water": {"color": [0.03, 0.08, 0.06], "ripple": 0.2},
        "dressing": {"reeds": 160, "rocks": 25, "lotus_pads": 40, "lotus_flowers": 0},
        "ghats": None,
    },
}


def _bsdf(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


# --------------------------------------------------------------------------- height field
class Field:
    def __init__(self, doc):
        g = doc.get("ghats")
        if g and g.get("side", "north") != "north":
            raise ValueError("ghats.side=%r is not supported yet (only 'north')" % g["side"])
        self.d = doc; L = doc["lake"]; B = doc["banks"]
        self.rx, self.ry, self.irr = L["rx"], L["ry"], L["irregularity"]
        self.depth, self.shelf = L["depth"], L["shelf"]
        self.bank, self.hills, self.hs = B["height"], B["hills"], B["hill_scale"]
        self.off = Vector((doc["seed"] * 13.7, doc["seed"] * 7.1, 0))
        g = doc.get("ghats")
        self.ghat = None
        self.ghat_y = self.shore_y(0.0) if g else 0.0
        self.ghat = g

    def rnorm(self, x, y):
        """Normalised distance to the shoreline (1.0 = water's edge)."""
        a = math.atan2(y / self.ry, x / self.rx)
        wob = 1 + self.irr * (noise.noise(Vector((math.cos(a) * 1.6, math.sin(a) * 1.6, 0)) + self.off)
                              + 0.5 * noise.noise(Vector((math.cos(a) * 4, math.sin(a) * 4, 3)) + self.off))
        return math.sqrt((x / self.rx) ** 2 + (y / self.ry) ** 2) / wob

    @staticmethod
    def _ss(a, b, x):
        t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)

    def h(self, x, y):
        d = self.rnorm(x, y)
        if d < 1.0:
            z = -self.depth * self._ss(1.0, 1.0 - self.shelf, d) - 0.15 * (1 - d)
        else:
            z = self.bank * self._ss(1.0, 1.25, d)
            z += self.hills * self._ss(1.3, 2.6, d) * (0.5 + 0.5 * noise.noise(Vector((x * self.hs, y * self.hs, 0)) + self.off))
        z += 0.06 * noise.noise(Vector((x * 0.6, y * 0.6, 5)) + self.off)
        g = self.ghat
        if g and g["side"] == "north":                     # level a pad for the ghat platform, blended back into the bank
            span = g["width"] / 2 + 1.5
            if abs(x) < span + 3 and y > 0:
                shore_y = self.ghat_y
                length = g["steps"] * g["step_d"] + 7.0
                if shore_y - 1.0 < y < shore_y + length + 4:
                    wx = self._ss(span + 3, span, abs(x))
                    wy = self._ss(shore_y + length + 4, shore_y + length, y)
                    target = self.bank * 0.9
                    z = z + (target - z) * wx * wy if y >= shore_y else z
        return z

    def shore_y(self, x):
        """y of the northern shoreline at x (bisection on rnorm)."""
        lo, hi = 0.0, self.ry * 2
        for _ in range(30):
            m = (lo + hi) / 2
            if self.rnorm(x, m) < 1.0: lo = m
            else: hi = m
        return (lo + hi) / 2


# --------------------------------------------------------------------------- materials
def ground_material(name):
    import building
    idx = building._tex_index()
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = _bsdf(m); N = nt.nodes.new; L = nt.links.new
    geo = N("ShaderNodeNewGeometry"); sep = N("ShaderNodeSeparateXYZ"); L(geo.outputs["Position"], sep.inputs[0])
    FLAT = {"mud": (0.20, 0.15, 0.10), "sand": (0.62, 0.53, 0.38), "grass": (0.22, 0.34, 0.10), "rock": (0.40, 0.38, 0.35)}
    def tex(key, scale):
        if key not in idx:   # no CC0 cache: flat colour per band (keeps lakes buildable in CI)
            m["texture_missing"] = key
            c = N("ShaderNodeRGB"); c.outputs[0].default_value = (*FLAT[key], 1)
            n = N("ShaderNodeRGB"); n.outputs[0].default_value = (0.5, 0.5, 1.0, 1)   # flat tangent normal
            return c.outputs[0], n.outputs[0]
        mp = N("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (1 / scale,) * 3
        L(geo.outputs["Position"], mp.inputs["Vector"])
        maps = idx[key]["maps"]
        c = N("ShaderNodeTexImage"); c.image = bpy.data.images.load(maps["color"], check_existing=True)
        c.projection = "BOX"; c.projection_blend = 0.3; L(mp.outputs[0], c.inputs["Vector"])
        n = N("ShaderNodeTexImage"); n.image = bpy.data.images.load(maps["normal"], check_existing=True)
        n.image.colorspace_settings.name = "Non-Color"; n.projection = "BOX"; n.projection_blend = 0.3
        L(mp.outputs[0], n.inputs["Vector"])
        return c.outputs[0], n.outputs[0]
    mud_c, mud_n = tex("mud", 2.5); sand_c, sand_n = tex("sand", 2.0); grass_c, grass_n = tex("grass", 2.0); rock_c, rock_n = tex("rock", 3.0)
    brk = N("ShaderNodeTexNoise"); brk.inputs["Scale"].default_value = 0.35; L(geo.outputs["Position"], brk.inputs["Vector"])
    def band(lo, hi):          # smooth 0->1 as z goes lo->hi, broken up by noise
        a = N("ShaderNodeMath"); a.operation = "ADD"; L(sep.outputs["Z"], a.inputs[0])
        s = N("ShaderNodeMath"); s.operation = "MULTIPLY"; s.inputs[1].default_value = 0.35
        o = N("ShaderNodeMath"); o.operation = "SUBTRACT"; o.inputs[1].default_value = 0.5
        L(brk.outputs["Fac"], o.inputs[0]); L(o.outputs[0], s.inputs[0]); L(s.outputs[0], a.inputs[1])
        mr = N("ShaderNodeMapRange"); mr.inputs[1].default_value = lo; mr.inputs[2].default_value = hi
        L(a.outputs[0], mr.inputs[0]); return mr.outputs[0]
    def mix(fac, a, b_, normal=False):
        mx = N("ShaderNodeMix"); mx.data_type = "RGBA"; L(fac, mx.inputs[0]); L(a, mx.inputs[6]); L(b_, mx.inputs[7]); return mx.outputs[2]
    wet = band(-0.4, 0.05); dry = band(0.15, 0.6)
    col = mix(dry, mix(wet, mud_c, sand_c), grass_c)
    nrm = mix(dry, mix(wet, mud_n, sand_n), grass_n)
    # rock on steep slopes: 1 - normal.z
    nz = N("ShaderNodeSeparateXYZ"); L(geo.outputs["Normal"], nz.inputs[0])
    st = N("ShaderNodeMapRange"); st.inputs[1].default_value = 0.88; st.inputs[2].default_value = 0.75
    L(nz.outputs["Z"], st.inputs[0])
    col = mix(st.outputs[0], col, rock_c); nrm = mix(st.outputs[0], nrm, rock_n)
    # darken + glossy where wet (just above and below the waterline)
    wetness = band(0.12, -0.1)
    dk = N("ShaderNodeMix"); dk.data_type = "RGBA"; dk.blend_type = "MULTIPLY"; dk.inputs[7].default_value = (0.55, 0.55, 0.55, 1)
    L(wetness, dk.inputs[0]); L(col, dk.inputs[6]); L(dk.outputs[2], b.inputs["Base Color"])
    rr = N("ShaderNodeMapRange"); rr.inputs[3].default_value = 0.9; rr.inputs[4].default_value = 0.25
    L(wetness, rr.inputs[0]); L(rr.outputs[0], b.inputs["Roughness"])
    nm = N("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = 0.8; L(nrm, nm.inputs["Color"]); L(nm.outputs[0], b.inputs["Normal"])
    return m


def water_material(name, color, ripple):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = _bsdf(m); N = nt.nodes.new; L = nt.links.new
    b.inputs["Base Color"].default_value = (*color, 1); b.inputs["Roughness"].default_value = 0.02
    b.inputs["Transmission Weight"].default_value = 0.85; b.inputs["IOR"].default_value = 1.33
    geo = N("ShaderNodeNewGeometry"); nz = N("ShaderNodeTexNoise"); nz.noise_dimensions = "4D"
    nz.inputs["Scale"].default_value = 1.2; nz.inputs["Detail"].default_value = 6
    L(geo.outputs["Position"], nz.inputs["Vector"])
    # ripples move with time: W driven by the frame number (no keyframes needed)
    fc = nz.inputs["W"].driver_add("default_value").driver; fc.type = "SCRIPTED"; fc.expression = "frame/48"
    bp = N("ShaderNodeBump"); bp.inputs["Strength"].default_value = ripple
    L(nz.outputs["Fac"], bp.inputs["Height"]); L(bp.outputs[0], b.inputs["Normal"])
    # absorption so deep water darkens
    va = N("ShaderNodeVolumeAbsorption"); va.inputs["Color"].default_value = (*[c * 6 for c in color], 1)
    va.inputs["Density"].default_value = 0.35
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"); L(va.outputs[0], out.inputs["Volume"])
    return m


def simple(name, col, rough=0.6, sss=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = _bsdf(m)
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
    b.inputs["Subsurface Weight"].default_value = sss
    return m


# --------------------------------------------------------------------------- build
def _link(o, root):
    bpy.context.scene.collection.objects.link(o); o.parent = root; return o


def build_lake(doc, name="lake", location=(0, 0, 0), flora_mod=None):
    rng = random.Random(doc["seed"]); F = Field(doc)
    root = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(root)
    root.empty_display_size = 2.0
    S, R = doc["size"], doc["res"]
    # terrain grid
    bm = bmesh.new(); vs = []
    for i in range(R + 1):
        row = []
        for j in range(R + 1):
            x = -S / 2 + S * j / R; y = -S / 2 + S * i / R
            row.append(bm.verts.new((x, y, F.h(x, y))))
        vs.append(row)
    for i in range(R):
        for j in range(R):
            f = bm.faces.new((vs[i][j], vs[i][j + 1], vs[i + 1][j + 1], vs[i + 1][j])); f.smooth = True
    me = bpy.data.meshes.new(name + "_terrain"); bm.to_mesh(me); bm.free()
    me.materials.append(ground_material(name + "_ground"))
    _link(bpy.data.objects.new(name + "_terrain", me), root)
    # water surface: a disc slightly larger than the lake, at z=0
    W = doc["water"]
    bpy.ops.mesh.primitive_circle_add(vertices=128, radius=1.0, fill_type="TRIFAN", location=(0, 0, 0.0))
    wo = bpy.context.object; wo.name = name + "_water"; wo.scale = (F.rx * 1.35, F.ry * 1.35, 1); wo.parent = root
    wo.data.materials.append(water_material(name + "_water", W["color"], W["ripple"]))
    so = wo.modifiers.new("depth", "SOLIDIFY"); so.thickness = F.depth + 0.5; so.offset = -1.0   # closed volume for absorption
    dr = doc.get("dressing", {})
    _reeds(root, rng, F, dr.get("reeds", 0), name)
    _rocks(root, rng, F, dr.get("rocks", 0), name)
    _pads(root, rng, F, dr.get("lotus_pads", 0), name)
    if dr.get("lotus_flowers") and flora_mod is not None:
        for k in range(dr["lotus_flowers"]):
            x, y = _shore_point(F, rng, 0.75, 0.93)
            fl = flora_mod.build_flower(dict(flora_mod.PRESETS["lotus"], leaf={"type": "none"}, stem={"length": 0.5, "radius": 0.01, "color": [0.2, 0.35, 0.1]}),
                                        name="%s_lotus_%d" % (name, k), location=(x, y, 0.22))
            fl.parent = root; fl.scale = (0.8,) * 3; fl.rotation_euler.z = rng.uniform(0, 6.28)
    if doc.get("ghats"):
        _ghats(root, F, doc["ghats"], name)
    root.location = location
    return root


def _shore_point(F, rng, d_lo, d_hi):
    for _ in range(200):
        a = rng.uniform(0, 2 * math.pi); t = rng.uniform(d_lo, d_hi)
        x, y = F.rx * 1.3 * t * math.cos(a), F.ry * 1.3 * t * math.sin(a)
        d = F.rnorm(x, y)
        if d_lo <= d <= d_hi and not (F.ghat and abs(x) < F.ghat["width"] / 2 + 2 and y > 0):
            return x, y
    return 0.0, 0.0


def _reeds(root, rng, F, n, name):
    if not n: return
    m = simple(name + "_reed", (0.22, 0.32, 0.1), 0.6, 0.15)
    tip = simple(name + "_cattail", (0.25, 0.14, 0.07), 0.8)
    meshes = []
    for v in range(4):   # a few reed clump meshes, instanced
        bm = bmesh.new()
        for k in range(14):
            a = rng.uniform(0, 6.28); r = rng.uniform(0, 0.25); h = rng.uniform(0.9, 1.8); lean = rng.uniform(0.05, 0.3)
            base = Vector((r * math.cos(a), r * math.sin(a), 0)); dirn = Vector((math.cos(a) * lean, math.sin(a) * lean, 1)).normalized()
            w = 0.012
            p0 = base; p1 = base + dirn * h * 0.6 + Vector((0, 0, 0)); p2 = base + dirn * h + Vector((math.cos(a) * lean * 0.6, math.sin(a) * lean * 0.6, 0))
            side = Vector((-math.sin(a), math.cos(a), 0)) * w
            q = [bm.verts.new(p0 - side), bm.verts.new(p0 + side), bm.verts.new(p1 + side * 0.7), bm.verts.new(p1 - side * 0.7), bm.verts.new(p2)]
            bm.faces.new((q[0], q[1], q[2], q[3])); bm.faces.new((q[3], q[2], q[4]))
            if k % 4 == 0:   # cattail head
                g = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1.0)
                c = base + dirn * h * 0.8
                for vv in g["verts"]: vv.co = Vector((vv.co.x * 0.02 + c.x, vv.co.y * 0.02 + c.y, vv.co.z * 0.12 + c.z))
                for f in {f for vv in g["verts"] for f in vv.link_faces}: f.material_index = 1
        me = bpy.data.meshes.new("%s_reeds_%d" % (name, v)); bm.to_mesh(me); bm.free()
        me.materials.append(m); me.materials.append(tip); meshes.append(me)
    for i in range(n):
        x, y = _shore_point(F, rng, 0.9, 1.06)
        o = _link(bpy.data.objects.new("%s_reeds_%d" % (name, i), meshes[i % 4]), root)
        o.location = (x, y, F.h(x, y) - 0.05); o.rotation_euler.z = rng.uniform(0, 6.28); o.scale = (rng.uniform(0.7, 1.3),) * 3


def _rocks(root, rng, F, n, name):
    if not n: return
    import building
    m = building.pbr_material(name + "_rock", "rock", (0.9, 0.88, 0.85), 1.2)
    meshes = []
    for v in range(5):
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
        off = Vector((rng.uniform(0, 50), rng.uniform(0, 50), v * 10))
        for vv in bm.verts:
            vv.co *= 1 + 0.35 * noise.noise(vv.co * 1.3 + off) + 0.12 * noise.noise(vv.co * 4 + off)
            vv.co.z *= 0.6
        me = bpy.data.meshes.new("%s_rock_%d" % (name, v)); bm.to_mesh(me); bm.free()
        for p in me.polygons: p.use_smooth = True
        me.materials.append(m); meshes.append(me)
    for i in range(n):
        x, y = _shore_point(F, rng, 0.97, 1.25)
        o = _link(bpy.data.objects.new("%s_rock_%d" % (name, i), meshes[i % 5]), root)
        s = rng.uniform(0.25, 0.9); o.scale = (s * rng.uniform(0.8, 1.3), s, s)
        o.location = (x, y, F.h(x, y) - s * 0.25); o.rotation_euler = (rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), rng.uniform(0, 6.28))


def _pads(root, rng, F, n, name):
    if not n: return
    m = simple(name + "_pad", (0.07, 0.24, 0.06), 0.45)
    bm = bmesh.new(); c = bm.verts.new((0, 0, 0)); ring = []
    N_ = 28
    for j in range(N_):
        a = j / N_ * 2 * math.pi
        r = 0.02 if abs(a) < 0.12 else 1.0
        ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), 0.02 * math.sin(3 * a))))
    for j in range(N_): bm.faces.new((c, ring[j], ring[(j + 1) % N_]))
    me = bpy.data.meshes.new(name + "_lotuspad"); bm.to_mesh(me); bm.free(); me.materials.append(m)
    for i in range(n):
        x, y = _shore_point(F, rng, 0.7, 0.95)
        o = _link(bpy.data.objects.new("%s_pad_%d" % (name, i), me), root)
        s = rng.uniform(0.18, 0.45); o.scale = (s, s, s); o.location = (x, y, 0.012); o.rotation_euler.z = rng.uniform(0, 6.28)


def _ghats(root, F, g, name):
    import building
    stone = building.pbr_material(name + "_ghat", "stone", (0.95, 0.85, 0.72), 1.2)
    W = g["width"]; n = g["steps"]; sh, sd = g["step_h"], g["step_d"]
    y_edge = F.ghat_y
    top = F.bank * 0.9
    for k in range(n):
        z_top = top - k * sh
        y0 = y_edge + 1.0 - k * sd
        o = building.box("%s_step_%d" % (name, k), (1, 1, 1), (0, 0, 0), stone, root)
        depth_back = (n - k) * sd + 2.0
        o.location = (0, y0 + depth_back / 2 - sd, z_top - 1.5); o.scale = (W, depth_back, 3.0)
    # platform + side walls + two small chhatris (reuses the building kit)
    plat = building.box(name + "_ghat_platform", (1, 1, 1), (0, 0, 0), stone, root)
    plat.location = (0, y_edge + 1.0 + 3.0, top - 1.5 + 0.0); plat.scale = (W + 2, 6.0, 3.0)
    mats = {"trim": stone}
    for sx in (-1, 1):
        wall = building.box(name + "_ghat_wall", (1, 1, 1), (0, 0, 0), stone, root)
        y_front = y_edge + 1.0 - (n - 1) * sd - sd          # front edge of the lowest step
        y_back = y_edge + 1.0 + 6.0                         # back of the platform
        wall.location = (sx * (W / 2 + 0.6), (y_front + y_back) / 2, top - 1.2); wall.scale = (1.2, y_back - y_front, 3.6)
        building._chhatri(root, mats, Vector((sx * (W / 2 + 0.6), y_front + 0.8, top + 0.6)))
