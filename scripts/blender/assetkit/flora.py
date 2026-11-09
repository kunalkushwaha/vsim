# assetkit.flora — parametric flowers from a small description ("FlowerDoc").
#
#   import flora; root = flora.build_flower(flora.PRESETS["lotus"], name="lotus", location=(0, 0, 0))
#
# Works headless (blender --background --python …) and live through Blender MCP.
# A FlowerDoc is plain data (JSON-able), so an AI can author/revise it and the same doc
# always rebuilds the same flower (seeded).
#
# Pieces:
#   petal   — a lofted curved surface: width profile (base/tip exponents), cup across,
#             bowl along, flick (tip recurve), ruffle (wavy edges), roll (rolled-out edges),
#             midrib keel. UV: U across, V along — the material is a function of UV only.
#   layout  — "rings" (lotus, lily, daisy) or "spiral" (golden angle: rose, marigold, dahlia).
#   color   — base→mid→tip gradient, edge tint, converging veins, speckles, SSS, sheen,
#             translucency.
#   center  — "pod" (lotus seed pod + stamens), "disc" (daisy/sunflower florets),
#             "stamens" (lily), "none".
#   sepals, stem, leaf ("pad" lotus leaf | "blade" lanceolate | "none").
import math, random
import bpy, bmesh
from mathutils import Matrix, Vector

GOLDEN = math.pi * (3 - math.sqrt(5))

# --------------------------------------------------------------------------- presets
PRESETS = {
    "lotus": {
        "seed": 7,
        "petal": {"length": 0.32, "width": 0.23, "base_exp": 0.85, "tip_exp": 0.95, "cup": 0.55, "bowl": 0.07,
                  "flick": 0.08, "ruffle": 0.0, "roll": 0.0},
        "layout": {"type": "rings", "rings": [
            {"n": 8, "tilt": 52, "radius": 0.058, "z": 0.010, "scale": 1.0, "offset": 0.0},
            {"n": 8, "tilt": 42, "radius": 0.052, "z": 0.018, "scale": 0.95, "offset": 0.5},
            {"n": 7, "tilt": 33, "radius": 0.046, "z": 0.026, "scale": 0.86, "offset": 0.25, "cup": 0.62},
            {"n": 6, "tilt": 25, "radius": 0.040, "z": 0.034, "scale": 0.7, "offset": 0.7, "cup": 0.7},
        ]},
        "color": {"base": [0.97, 0.90, 0.70], "mid": [0.98, 0.62, 0.74], "tip": [0.80, 0.10, 0.36], "edge": 0.55,
                  "veins": 26, "vein_strength": 0.35, "sss": 0.45, "sheen": 0.25, "translucency": 0.18},
        "center": {"type": "pod", "z": 0.075, "radius": 0.04, "stamens": 92, "stamen_color": [1.0, 0.72, 0.12]},
        "sepals": {"n": 4, "length": 0.19, "width": 0.13, "tilt": 78, "color": [0.32, 0.45, 0.14]},
        "stem": {"length": 0.62, "radius": 0.011, "color": [0.20, 0.35, 0.10]},
        "leaf": {"type": "pad", "radius": 0.42, "offset": [0.32, 0.28], "z": -0.2},
    },
    "marigold": {
        "seed": 3,
        "petal": {"length": 0.045, "width": 0.04, "base_exp": 0.5, "tip_exp": 0.25, "cup": 0.35, "bowl": 0.05,
                  "flick": 0.05, "ruffle": 0.35, "ruffle_freq": 5, "roll": 0.0, "res": [16, 12]},
        "layout": {"type": "spiral", "count": 170, "tilt_start": 12, "tilt_end": 88, "scale_start": 0.55,
                   "scale_end": 1.0, "radius_start": 0.002, "radius_end": 0.03, "z_start": 0.045, "z_end": 0.0},
        "color": {"base": [0.95, 0.42, 0.02], "mid": [1.0, 0.55, 0.02], "tip": [1.0, 0.62, 0.05], "edge": 0.2,
                  "edge_color": [0.85, 0.30, 0.0], "veins": 9, "vein_strength": 0.25, "sss": 0.3, "sheen": 0.35,
                  "translucency": 0.12},
        "center": {"type": "none"},
        "sepals": {"n": 6, "length": 0.03, "width": 0.025, "tilt": 95, "color": [0.15, 0.32, 0.08]},
        "stem": {"length": 0.25, "radius": 0.004, "color": [0.15, 0.32, 0.08]},
        "leaf": {"type": "blade", "length": 0.09, "width": 0.025, "count": 2},
    },
    "rose": {
        "seed": 11,
        "petal": {"length": 0.06, "width": 0.065, "base_exp": 0.7, "tip_exp": 0.35, "cup": 0.9, "bowl": 0.1,
                  "flick": 0.0, "ruffle": 0.06, "ruffle_freq": 3, "roll": 0.55, "res": [22, 16]},
        "layout": {"type": "spiral", "count": 34, "tilt_start": 6, "tilt_end": 62, "scale_start": 0.55,
                   "scale_end": 1.15, "radius_start": 0.003, "radius_end": 0.02, "z_start": 0.012, "z_end": 0.0},
        "color": {"base": [0.75, 0.05, 0.08], "mid": [0.72, 0.02, 0.06], "tip": [0.55, 0.0, 0.04], "edge": 0.3,
                  "veins": 14, "vein_strength": 0.15, "sss": 0.5, "sheen": 0.7, "translucency": 0.1},
        "center": {"type": "none"},
        "sepals": {"n": 5, "length": 0.05, "width": 0.018, "tilt": 110, "color": [0.12, 0.28, 0.08]},
        "stem": {"length": 0.35, "radius": 0.0045, "color": [0.12, 0.28, 0.08]},
        "leaf": {"type": "blade", "length": 0.07, "width": 0.035, "count": 3},
    },
    "lily": {
        "seed": 5,
        "petal": {"length": 0.13, "width": 0.05, "base_exp": 0.6, "tip_exp": 0.9, "cup": 0.25, "bowl": 0.02,
                  "flick": 0.55, "ruffle": 0.08, "ruffle_freq": 4, "roll": 0.0},
        "layout": {"type": "rings", "rings": [
            {"n": 3, "tilt": 38, "radius": 0.008, "z": 0.0, "scale": 1.0, "offset": 0.0},
            {"n": 3, "tilt": 32, "radius": 0.008, "z": 0.004, "scale": 0.96, "offset": 0.5, "width_scale": 1.25},
        ]},
        "color": {"base": [0.98, 0.92, 0.55], "mid": [1.0, 0.96, 0.92], "tip": [0.98, 0.82, 0.88], "edge": 0.15,
                  "veins": 10, "vein_strength": 0.2, "speckle": 0.55, "speckle_color": [0.45, 0.04, 0.12],
                  "sss": 0.4, "sheen": 0.2, "translucency": 0.2},
        "center": {"type": "stamens", "count": 6, "length": 0.09, "stamen_color": [0.55, 0.2, 0.05]},
        "sepals": None,
        "stem": {"length": 0.4, "radius": 0.005, "color": [0.18, 0.35, 0.1]},
        "leaf": {"type": "blade", "length": 0.12, "width": 0.02, "count": 4},
    },
    "daisy": {
        "seed": 2,
        "petal": {"length": 0.04, "width": 0.011, "base_exp": 0.3, "tip_exp": 0.18, "cup": 0.15, "bowl": 0.02,
                  "flick": 0.02, "ruffle": 0.0, "roll": 0.0, "res": [14, 8]},
        "layout": {"type": "rings", "rings": [
            {"n": 21, "tilt": 84, "radius": 0.012, "z": 0.0, "scale": 1.0, "offset": 0.0},
            {"n": 21, "tilt": 78, "radius": 0.011, "z": 0.002, "scale": 0.95, "offset": 0.5},
        ]},
        "color": {"base": [0.95, 0.95, 0.85], "mid": [0.98, 0.98, 0.96], "tip": [0.98, 0.98, 0.98], "edge": 0.0,
                  "veins": 4, "vein_strength": 0.15, "sss": 0.35, "sheen": 0.15, "translucency": 0.15},
        "center": {"type": "disc", "radius": 0.013, "height": 0.006, "florets": 260, "color": [1.0, 0.72, 0.05]},
        "sepals": None,
        "stem": {"length": 0.25, "radius": 0.002, "color": [0.15, 0.34, 0.09]},
        "leaf": {"type": "blade", "length": 0.05, "width": 0.012, "count": 2},
    },
}


# --------------------------------------------------------------------------- helpers
def _link(o, root):
    bpy.context.scene.collection.objects.link(o)
    o.parent = root
    return o


def _bsdf(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def _simple_mat(name, col, rough=0.5, sss=0.2):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = _bsdf(m)
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
    b.inputs["Subsurface Weight"].default_value = sss; b.inputs["Subsurface Scale"].default_value = 0.005
    return m


# --------------------------------------------------------------------------- petal geometry
def petal_mesh(name, length, width, base_exp=0.85, tip_exp=0.95, cup=0.5, bowl=0.06, flick=0.1,
               ruffle=0.0, ruffle_freq=6, roll=0.0, res=(34, 16), phase=0.0, **_):
    nu, nv = res

    def f(u):
        return (u ** base_exp) * ((1 - u) ** tip_exp)
    fmax = max(f(i / 400) for i in range(1, 400))

    def wid(u):
        return width * (0.1 + 0.9 * f(u) / fmax)

    bm = bmesh.new(); uvl = bm.loops.layers.uv.new("UVMap"); grid = []
    for i in range(nu + 1):
        u = i / nu
        w = wid(u) if i < nu else 0.0
        row = []
        for j in range(nv + 1):
            v = -1 + 2 * j / nv
            x = v * w / 2
            z = length * u
            y = -cup * v * v * w * 0.6                                    # edges curl toward the centre
            y += -bowl * length * math.sin(math.pi * u)                   # lengthwise bowl
            y += flick * length * max(0.0, u - 0.6) ** 2 / 0.16           # tip recurves outward
            y += roll * w * max(0.0, abs(v) - 0.55) ** 2 * 2.2 * u        # rolled-back edges (rose)
            y += ruffle * w * abs(v) ** 3 * math.sin(ruffle_freq * math.pi * u * 2 + phase + 3 * v) * 0.5
            y += 0.0035 * width / 0.2 * math.exp(-(v / 0.1) ** 2) * math.sin(math.pi * u)  # midrib keel
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for i in range(nu):
        for j in range(nv):
            fc = bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
            for loop, (ii, jj) in zip(fc.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
                loop[uvl].uv = (jj / nv, ii / nu)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    return me


# --------------------------------------------------------------------------- petal material
def petal_material(name, c):
    base, mid, tip = c["base"], c["mid"], c["tip"]
    edge_col = c.get("edge_color", tip)
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    out = N("ShaderNodeOutputMaterial"); bsdf = N("ShaderNodeBsdfPrincipled")
    uvn = N("ShaderNodeUVMap"); sep = N("ShaderNodeSeparateXYZ"); L(uvn.outputs[0], sep.inputs[0])
    ramp = N("ShaderNodeValToRGB"); cr = ramp.color_ramp; cr.interpolation = "EASE"
    cr.elements[0].position = 0.0; cr.elements[0].color = (*base, 1)
    cr.elements[1].position = 0.95; cr.elements[1].color = (*tip, 1)
    cr.elements.new(0.42).color = (*mid, 1)
    L(sep.outputs["Y"], ramp.inputs[0])

    def math_node(op, a, b=None, val=None):
        n = N("ShaderNodeMath"); n.operation = op
        L(a, n.inputs[0])
        if b is not None: L(b, n.inputs[1])
        if val is not None: n.inputs[1].default_value = val
        return n.outputs[0]
    # edge tint
    e = math_node("POWER", math_node("MULTIPLY", math_node("ABSOLUTE", math_node("SUBTRACT", sep.outputs["X"], val=0.5)), val=2.0), val=3.0)
    e = math_node("MULTIPLY", e, val=c.get("edge", 0.5))
    mixe = N("ShaderNodeMix"); mixe.data_type = "RGBA"; mixe.inputs[7].default_value = (*edge_col, 1)
    L(e, mixe.inputs[0]); L(ramp.outputs[0], mixe.inputs[6])
    col_out = mixe.outputs[2]
    # veins
    noise = N("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 6.0; L(uvn.outputs[0], noise.inputs["Vector"])
    u_w = math_node("ADD", sep.outputs["X"], math_node("MULTIPLY", noise.outputs["Fac"], val=0.03))
    s = math_node("SINE", math_node("MULTIPLY", u_w, val=2 * math.pi * c.get("veins", 20)))
    vr = N("ShaderNodeValToRGB")
    vr.color_ramp.elements[0].position = 0.80; vr.color_ramp.elements[0].color = (0, 0, 0, 1)
    vr.color_ramp.elements[1].position = 0.98; vr.color_ramp.elements[1].color = (1, 1, 1, 1)
    L(s, vr.inputs[0])
    mixv = N("ShaderNodeMix"); mixv.data_type = "RGBA"; mixv.blend_type = "MULTIPLY"
    mixv.inputs[7].default_value = (0.78, 0.4, 0.5, 1)
    L(math_node("MULTIPLY", vr.outputs[0], val=c.get("vein_strength", 0.3)), mixv.inputs[0]); L(col_out, mixv.inputs[6])
    col_out = mixv.outputs[2]
    # speckles (lily): voronoi dots, stronger toward the base half
    if c.get("speckle", 0) > 0:
        vo = N("ShaderNodeTexVoronoi"); vo.inputs["Scale"].default_value = 22; L(uvn.outputs[0], vo.inputs["Vector"])
        dots = math_node("LESS_THAN", vo.outputs["Distance"], val=0.12)
        basew = math_node("SUBTRACT", math_node("MULTIPLY", sep.outputs["Y"], val=-1.6), val=-1.1)  # 1.1 - 1.6V
        mask = math_node("MULTIPLY", dots, math_node("MINIMUM", basew, val=1.0))
        mask = math_node("MULTIPLY", math_node("MAXIMUM", mask, val=0.0), val=c["speckle"])
        mixs = N("ShaderNodeMix"); mixs.data_type = "RGBA"; mixs.inputs[7].default_value = (*c["speckle_color"], 1)
        L(mask, mixs.inputs[0]); L(col_out, mixs.inputs[6]); col_out = mixs.outputs[2]
    L(col_out, bsdf.inputs["Base Color"])
    bump = N("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.08
    L(vr.outputs[0], bump.inputs["Height"]); L(bump.outputs[0], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.42
    bsdf.inputs["Subsurface Weight"].default_value = c.get("sss", 0.4)
    bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.45)
    bsdf.inputs["Subsurface Scale"].default_value = 0.012
    bsdf.inputs["Sheen Weight"].default_value = c.get("sheen", 0.2)
    tr = N("ShaderNodeBsdfTranslucent"); L(col_out, tr.inputs["Color"])
    ms = N("ShaderNodeMixShader"); ms.inputs[0].default_value = c.get("translucency", 0.15)
    L(bsdf.outputs[0], ms.inputs[1]); L(tr.outputs[0], ms.inputs[2]); L(ms.outputs[0], out.inputs["Surface"])
    return m


def leaf_material(name, dark=(0.03, 0.14, 0.03), light=(0.10, 0.28, 0.07), vein=(0.22, 0.38, 0.12), radial=True):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = _bsdf(m)
    N = nt.nodes.new; L = nt.links.new
    # everything reads the mesh's own UVs (not Object coords) so it survives export's merge into one object
    tc = N("ShaderNodeTexCoord"); sx = N("ShaderNodeSeparateXYZ"); L(tc.outputs["UV"], sx.inputs[0])
    if radial:   # pad UVs are centred at (0.5, 0.5): veins radiate from the pad's centre
        cy = N("ShaderNodeMath"); cy.operation = "SUBTRACT"; cy.inputs[1].default_value = 0.5; L(sx.outputs["Y"], cy.inputs[0])
        cx = N("ShaderNodeMath"); cx.operation = "SUBTRACT"; cx.inputs[1].default_value = 0.5; L(sx.outputs["X"], cx.inputs[0])
        at = N("ShaderNodeMath"); at.operation = "ARCTAN2"; L(cy.outputs[0], at.inputs[0]); L(cx.outputs[0], at.inputs[1])
        mm = N("ShaderNodeMath"); mm.operation = "MULTIPLY"; mm.inputs[1].default_value = 22; L(at.outputs[0], mm.inputs[0])
    else:
        mm = N("ShaderNodeMath"); mm.operation = "MULTIPLY"; mm.inputs[1].default_value = 40
        ad = N("ShaderNodeMath"); ad.operation = "ADD"; L(sx.outputs["Y"], ad.inputs[0])
        ab = N("ShaderNodeMath"); ab.operation = "ABSOLUTE"; sub = N("ShaderNodeMath"); sub.operation = "SUBTRACT"
        sub.inputs[1].default_value = 0.5; L(sx.outputs["X"], sub.inputs[0]); L(sub.outputs[0], ab.inputs[0])
        L(ab.outputs[0], ad.inputs[1]); L(ad.outputs[0], mm.inputs[0])
    sn = N("ShaderNodeMath"); sn.operation = "SINE"; L(mm.outputs[0], sn.inputs[0])
    vr = N("ShaderNodeValToRGB"); vr.color_ramp.elements[0].position = 0.93; vr.color_ramp.elements[1].position = 0.99
    L(sn.outputs[0], vr.inputs[0])
    nz = N("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 18; L(tc.outputs["UV"], nz.inputs["Vector"])
    cr = N("ShaderNodeValToRGB"); cr.color_ramp.elements[0].color = (*dark, 1); cr.color_ramp.elements[1].color = (*light, 1)
    L(nz.outputs["Fac"], cr.inputs[0])
    mx = N("ShaderNodeMix"); mx.data_type = "RGBA"; mx.inputs[7].default_value = (*vein, 1)
    fac = N("ShaderNodeMath"); fac.operation = "MULTIPLY"; fac.inputs[1].default_value = 0.22
    L(vr.outputs[0], fac.inputs[0]); L(fac.outputs[0], mx.inputs[0]); L(cr.outputs[0], mx.inputs[6])
    L(mx.outputs[2], b.inputs["Base Color"])
    bp = N("ShaderNodeBump"); bp.inputs["Strength"].default_value = 0.25
    L(vr.outputs[0], bp.inputs["Height"]); L(bp.outputs[0], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = 0.5; b.inputs["Coat Weight"].default_value = 0.1
    b.inputs["Sheen Weight"].default_value = 0.08; b.inputs["Specular IOR Level"].default_value = 0.35
    return m


# --------------------------------------------------------------------------- parts
def _place(o, pos, azimuth, tilt_deg, twist_deg, scale):
    o.matrix_world = Matrix.Translation(pos) @ Matrix.Rotation(azimuth - math.pi / 2, 4, "Z") \
        @ Matrix.Rotation(-math.radians(tilt_deg), 4, "X") @ Matrix.Rotation(math.radians(twist_deg), 4, "Z") \
        @ Matrix.Scale(scale, 4)


def _finish_petal(o, thickness):
    so = o.modifiers.new("thick", "SOLIDIFY"); so.thickness = thickness; so.offset = 0
    o.modifiers.new("ss", "SUBSURF").levels = 1


def _petals(doc, root, rng, mat, tag):
    P = dict(doc["petal"]); lay = doc["layout"]; thick = P.get("thickness", max(0.0008, P["width"] * 0.013))
    out = []
    if lay["type"] == "rings":
        for ri, ring in enumerate(lay["rings"]):
            pp = dict(P); pp.update({k: ring[k] for k in ("cup", "flick", "bowl", "ruffle", "roll") if k in ring})
            pp["width"] = P["width"] * ring.get("width_scale", 1.0)
            variants = []
            for k in range(3):
                q = dict(pp)
                q["length"] *= rng.uniform(0.95, 1.05); q["width"] *= rng.uniform(0.94, 1.06)
                q["cup"] *= rng.uniform(0.85, 1.15); q["flick"] *= rng.uniform(0.7, 1.3); q["phase"] = rng.uniform(0, 6.28)
                me = petal_mesh("%s_r%d_v%d" % (tag, ri, k), **q); me.materials.append(mat); variants.append(me)
            n = ring["n"]
            for i in range(n):
                a = (i + ring.get("offset", 0) + rng.uniform(-0.08, 0.08)) / n * 2 * math.pi
                o = _link(bpy.data.objects.new("%s_petal_%d_%d" % (tag, ri, i), variants[rng.randrange(3)]), root)
                r = ring["radius"]
                _place(o, Vector((r * math.cos(a), r * math.sin(a), ring.get("z", 0))), a,
                       ring["tilt"] + rng.uniform(-4, 4), rng.uniform(-6, 6), ring.get("scale", 1.0) * rng.uniform(0.94, 1.04))
                _finish_petal(o, thick); out.append(o)
    else:  # golden-angle spiral, innermost first
        cnt = lay["count"]; variants = []
        for k in range(5):
            q = dict(P); q["length"] *= rng.uniform(0.92, 1.08); q["width"] *= rng.uniform(0.92, 1.08)
            q["cup"] *= rng.uniform(0.85, 1.15); q["phase"] = rng.uniform(0, 6.28)
            me = petal_mesh("%s_sp_v%d" % (tag, k), **q); me.materials.append(mat); variants.append(me)
        for i in range(cnt):
            t = (i / (cnt - 1)) ** 0.8
            a = i * GOLDEN
            r = lay["radius_start"] + (lay["radius_end"] - lay["radius_start"]) * t
            z = lay["z_start"] + (lay["z_end"] - lay["z_start"]) * t
            tilt = lay["tilt_start"] + (lay["tilt_end"] - lay["tilt_start"]) * t + rng.uniform(-4, 4)
            sc = lay["scale_start"] + (lay["scale_end"] - lay["scale_start"]) * t
            o = _link(bpy.data.objects.new("%s_petal_s%d" % (tag, i), variants[rng.randrange(5)]), root)
            _place(o, Vector((r * math.cos(a), r * math.sin(a), z)), a, tilt, rng.uniform(-8, 8), sc * rng.uniform(0.94, 1.05))
            _finish_petal(o, thick); out.append(o)
    return out


def _center(doc, root, rng, tag):
    c = doc.get("center") or {"type": "none"}
    t = c.get("type", "none")
    if t == "pod":
        z = c.get("z", 0.075); R = c.get("radius", 0.04)
        POD = _simple_mat(tag + "_pod", (0.78, 0.80, 0.28), 0.45, 0.25)
        CARP = _simple_mat(tag + "_carpel", (0.55, 0.62, 0.12), 0.35, 0.2)
        bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=R * 0.55, radius2=R, depth=R * 1.25, location=(0, 0, z))
        pod = bpy.context.object; pod.name = tag + "_pod"; pod.data.materials.append(POD)
        bpy.context.scene.collection.objects.unlink(pod) if False else None; pod.parent = root
        for p in pod.data.polygons: p.use_smooth = True
        bv = pod.modifiers.new("bevel", "BEVEL"); bv.width = R * 0.15; bv.segments = 4
        pod.modifiers.new("ss", "SUBSURF").levels = 1
        top = z + R * 0.625 + 0.0005
        pts = [(0, 0)] + [(R * 0.4 * math.cos(a), R * 0.4 * math.sin(a)) for a in [i / 6 * 2 * math.pi for i in range(6)]] \
            + [(R * 0.75 * math.cos(a), R * 0.75 * math.sin(a)) for a in [(i + 0.5) / 11 * 2 * math.pi for i in range(11)]]
        for i, (x, y) in enumerate(pts):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=16, ring_count=8, location=(x, y, top))
            cp = bpy.context.object; cp.scale = (R * 0.14, R * 0.14, R * 0.09); cp.name = "%s_carpel_%d" % (tag, i)
            cp.data.materials.append(CARP); cp.parent = root
            for p in cp.data.polygons: p.use_smooth = True
        _stamen_ring(root, rng, tag, c.get("stamens", 90), R * 0.9, R * 1.15, z - R * 0.2, 0.055, c.get("stamen_color", (1, 0.72, 0.12)))
    elif t == "disc":
        R = c.get("radius", 0.013); H = c.get("height", 0.006)
        DISC = _simple_mat(tag + "_disc", c.get("color", (1.0, 0.72, 0.05)), 0.6, 0.2)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=32, ring_count=16, location=(0, 0, 0.0))
        d = bpy.context.object; d.scale = (R, R, H); d.name = tag + "_disc"; d.data.materials.append(DISC); d.parent = root
        for p in d.data.polygons: p.use_smooth = True
        FL = _simple_mat(tag + "_floret", [x * 0.85 for x in c.get("color", (1.0, 0.72, 0.05))], 0.5, 0.2)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=8, ring_count=5)
        proto = bpy.context.object; fme = proto.data; fme.materials.append(FL); bpy.data.objects.remove(proto)
        n = c.get("florets", 200)
        for i in range(n):
            rr = R * 0.95 * math.sqrt(i / n); a = i * GOLDEN
            zz = H * math.sqrt(max(0.0, 1 - (rr / R) ** 2))
            o = _link(bpy.data.objects.new("%s_floret_%d" % (tag, i), fme), root)
            s = R * 0.055 * (1.2 - 0.5 * rr / R)
            o.location = (rr * math.cos(a), rr * math.sin(a), zz); o.scale = (s, s, s * 0.8)
    elif t == "stamens":
        _stamen_ring(root, rng, tag, c.get("count", 6), 0.004, 0.006, 0.0, c.get("length", 0.08),
                     c.get("stamen_color", (0.55, 0.2, 0.05)), long_filament=True)
        PIST = _simple_mat(tag + "_pistil", (0.6, 0.75, 0.35), 0.4, 0.2)
        cu = bpy.data.curves.new(tag + "_pistil", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.0015
        sp = cu.splines.new("BEZIER"); sp.bezier_points.add(1)
        L = c.get("length", 0.08) * 1.05
        for bp, co in zip(sp.bezier_points, [(0, 0, 0), (0, -0.01, L)]):
            bp.co = co; bp.handle_left_type = bp.handle_right_type = "AUTO"
        cu.materials.append(PIST); _link(bpy.data.objects.new(tag + "_pistil", cu), root)


def _stamen_ring(root, rng, tag, n, r0, r1, z, length, color, long_filament=False):
    STAM = _simple_mat(tag + "_stamen", color, 0.5, 0.3)
    TIP = _simple_mat(tag + "_stamen_tip", (0.98, 0.95, 0.85), 0.4, 0.2)
    FIL = _simple_mat(tag + "_filament", (0.85, 0.85, 0.6), 0.4, 0.2) if long_filament else STAM
    cu = bpy.data.curves.new("stamen_curve", "CURVE"); cu.dimensions = "3D"
    cu.bevel_depth = 0.0011 if not long_filament else 0.0009; cu.bevel_resolution = 2
    sp = cu.splines.new("BEZIER"); sp.bezier_points.add(2)
    for bp, co in zip(sp.bezier_points, [(0, 0, 0), (0, length * 0.11, length * 0.55), (0, length * 0.29, length)]):
        bp.co = co; bp.handle_left_type = bp.handle_right_type = "AUTO"
    tmp = bpy.data.objects.new("tmp", cu); bpy.context.scene.collection.objects.link(tmp)
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(tmp); bpy.data.curves.remove(cu)
    bm = bmesh.new(); bm.from_mesh(me)
    for f in bm.faces: f.material_index = 0
    def ell(c, s, mi):
        g = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
        for v in g["verts"]: v.co = Vector((v.co.x * s[0] + c[0], v.co.y * s[1] + c[1], v.co.z * s[2] + c[2]))
        for f in {f for v in g["verts"] for f in v.link_faces}: f.material_index = mi; f.smooth = True
    if long_filament:
        ell((0, length * 0.29, length + 0.004), (0.003, 0.0025, 0.009), 1)
    else:
        ell((0, length * 0.245, length * 0.84), (0.0026, 0.0026, 0.011), 1)
        ell((0, length * 0.3, length * 1.045), (0.0018, 0.0018, 0.003), 2)
    bm.to_mesh(me); bm.free(); me.name = tag + "_stamen"
    me.materials.clear(); me.materials.append(FIL); me.materials.append(STAM); me.materials.append(TIP)
    for p in me.polygons: p.use_smooth = True
    for i in range(n):
        a = i / n * 2 * math.pi + rng.uniform(-0.03, 0.03)
        r = rng.uniform(r0, r1)
        o = _link(bpy.data.objects.new("%s_stamen_%d" % (tag, i), me), root)
        _place(o, Vector((r * math.cos(a), r * math.sin(a), z)), a, rng.uniform(5, 30) if not long_filament else rng.uniform(12, 22),
               0, rng.uniform(0.85, 1.1))


def _sepals(doc, root, rng, tag):
    s = doc.get("sepals")
    if not s: return
    m = petal_material(tag + "_sepal", {"base": [c * 1.2 for c in s["color"]], "mid": s["color"], "tip": [c * 0.7 for c in s["color"]],
                                         "edge": 0.2, "veins": 8, "vein_strength": 0.2, "sss": 0.2, "sheen": 0.1, "translucency": 0.05})
    me = petal_mesh(tag + "_sepal", s["length"], s["width"], cup=0.3, bowl=0.05, flick=0.05, res=(20, 10)); me.materials.append(m)
    for i in range(s["n"]):
        a = (i + 0.12) / s["n"] * 2 * math.pi
        o = _link(bpy.data.objects.new("%s_sepal_%d" % (tag, i), me), root)
        _place(o, Vector((0.6 * s["width"] * math.cos(a) * 0.4, 0.6 * s["width"] * math.sin(a) * 0.4, -0.004)), a,
               s["tilt"] + rng.uniform(-5, 5), rng.uniform(-6, 6), 1.0)
        _finish_petal(o, max(0.0008, s["width"] * 0.015))


def _stem_and_leaves(doc, root, rng, tag):
    st = doc.get("stem")
    if not st: return
    Ls, R = st["length"], st["radius"]
    SM = _simple_mat(tag + "_stem", st["color"], 0.4, 0.2)
    cu = bpy.data.curves.new(tag + "_stem", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = R; cu.bevel_resolution = 4
    sp = cu.splines.new("BEZIER"); sp.bezier_points.add(2)
    bend = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)).normalized() * Ls * 0.06
    for bp, co in zip(sp.bezier_points, [Vector((0, 0, -Ls)) + bend, Vector((0, 0, -Ls * 0.45)) + bend * 0.4, Vector((0, 0, -0.002))]):
        bp.co = co; bp.handle_left_type = bp.handle_right_type = "AUTO"
    cu.materials.append(SM); _link(bpy.data.objects.new(tag + "_stem", cu), root)
    lf = doc.get("leaf") or {"type": "none"}
    if lf["type"] == "pad":
        _lotus_pad(root, rng, tag, lf)
    elif lf["type"] == "blade":
        LM = leaf_material(tag + "_leaf", radial=False)
        me = petal_mesh(tag + "_leafblade", lf["length"], lf["width"], base_exp=0.6, tip_exp=1.1, cup=0.25, bowl=0.04, flick=0.25,
                        ruffle=0.04, res=(24, 10))
        me.materials.append(LM)
        for i in range(lf.get("count", 2)):
            a = i * GOLDEN * 1.0 + rng.uniform(-0.3, 0.3)
            z = -Ls * (0.35 + 0.4 * i / max(1, lf.get("count", 2)))
            o = _link(bpy.data.objects.new("%s_leaf_%d" % (tag, i), me), root)
            _place(o, Vector((R * math.cos(a), R * math.sin(a), z)), a, 55 + rng.uniform(-10, 10), 0, 1.0)
            _finish_petal(o, 0.0008)


def _lotus_pad(root, rng, tag, lf):
    R = lf.get("radius", 0.42); NR, NA = 24, 96
    bm = bmesh.new(); center = bm.verts.new((0, 0, 0)); rings = []
    for i in range(1, NR + 1):
        r = R * i / NR; ring = []
        for j in range(NA):
            a = j / NA * 2 * math.pi
            rr = (0.02 * i / NR) if (abs(((a + math.pi) % (2 * math.pi)) - math.pi) < 0.05 and i > 2) else r
            z = 0.06 * (r / R) ** 2 - 0.015 + (0.012 * math.sin(7 * a) + 0.006 * math.sin(13 * a + 1)) * (r / R) ** 3
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        rings.append(ring)
    for j in range(NA): bm.faces.new((center, rings[0][j], rings[0][(j + 1) % NA]))
    for i in range(NR - 1):
        for j in range(NA):
            bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % NA], rings[i][(j + 1) % NA]))
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            lp[uvl].uv = (lp.vert.co.x / R * 0.5 + 0.5, lp.vert.co.y / R * 0.5 + 0.5)
    me = bpy.data.meshes.new(tag + "_pad"); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    me.materials.append(leaf_material(tag + "_pad"))
    o = _link(bpy.data.objects.new(tag + "_pad", me), root)
    ox, oy = lf.get("offset", (0.32, 0.28))
    o.location = (ox, oy, lf.get("z", -0.2) + 0.015); o.rotation_euler = (0.04, -0.03, rng.uniform(0, 6.28))
    o.modifiers.new("thick", "SOLIDIFY").thickness = 0.004
    o.modifiers.new("ss", "SUBSURF").levels = 1


# --------------------------------------------------------------------------- entry point
def build_flower(doc, name="flower", location=(0, 0, 0)):
    """Build a flower from a FlowerDoc (see PRESETS). Returns the root empty (origin = flower head base)."""
    rng = random.Random(doc.get("seed", 1))
    root = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(root)
    root.empty_display_size = 0.02
    root["flower_doc"] = repr(doc)
    mat = petal_material(name + "_petal", doc["color"])
    _petals(doc, root, rng, mat, name)
    _center(doc, root, rng, name)
    _sepals(doc, root, rng, name)
    _stem_and_leaves(doc, root, rng, name)
    root.location = location
    return root
