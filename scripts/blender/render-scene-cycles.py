# Render baked vsim frames (from apps/studio/cycles-bake.ts) with Cycles. Builds the world-space
# meshes, the scene's actual lights + camera, and Principled materials (PBR maps + subsurface skin),
# then path-traces PNG(s). Renders one frame, or a whole manifest in a single Blender session.
#
#   blender -b -P scripts/blender/render-scene-cycles.py -- <frame.json> <out.png> [samples]
#   blender -b -P scripts/blender/render-scene-cycles.py -- manifest=<manifest.json> [samples=48]
import bpy, sys, json, base64, math, mathutils

def image_from_rgba(name, w, h, b64):
    raw = base64.b64decode(b64)
    img = bpy.data.images.new(name, w, h)
    px = [0.0] * (w * h * 4)
    for y in range(h):           # vsim texture row 0 = top; Blender image row 0 = bottom → flip
        sy = h - 1 - y
        for x in range(w * 4):
            px[(y * w * 4) + x] = raw[(sy * w * 4) + x] / 255.0
    img.pixels = px; img.pack()
    return img

def build_and_render(data, out_png, samples):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    for m in data["meshes"]:
        me = bpy.data.meshes.new(m["name"])
        pos = m["positions"]
        verts = [(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) for i in range(len(pos) // 3)]
        idx = m["indices"]
        me.from_pydata(verts, [], [(idx[i], idx[i + 1], idx[i + 2]) for i in range(0, len(idx), 3)])
        me.update()
        obj = bpy.data.objects.new(m["name"], me); scene.collection.objects.link(obj)
        for p in me.polygons: p.use_smooth = True  # normals come from vsim's consistent winding
        if m.get("uvs"):
            uv = m["uvs"]; uvl = me.uv_layers.new(name="UV")
            for loop in me.loops:
                vi = loop.vertex_index
                uvl.data[loop.index].uv = (uv[vi * 2], 1.0 - uv[vi * 2 + 1])

        mat = bpy.data.materials.new(m["name"]); mat.use_nodes = True; nt = mat.node_tree
        b = nt.nodes.get("Principled BSDF")
        c = m["color"]; b.inputs["Base Color"].default_value = (c[0], c[1], c[2], 1)
        b.inputs["Roughness"].default_value = m.get("roughness", 0.8)
        b.inputs["Metallic"].default_value = m.get("metalness", 0)
        em = m.get("emissive", [0, 0, 0])
        if any(em):
            if "Emission Color" in b.inputs: b.inputs["Emission Color"].default_value = (em[0], em[1], em[2], 1)
            if "Emission Strength" in b.inputs: b.inputs["Emission Strength"].default_value = 1.0

        def teximg(mapdef, name, non_color=False):
            img = image_from_rgba(name, mapdef["width"], mapdef["height"], mapdef["rgba"])
            if non_color: img.colorspace_settings.name = 'Non-Color'
            node = nt.nodes.new("ShaderNodeTexImage"); node.image = img
            return node
        if m.get("texture"):
            nt.links.new(teximg(m["texture"], m["name"] + "_base").outputs["Color"], b.inputs["Base Color"])
        if m.get("normalMap"):
            nx = teximg(m["normalMap"], m["name"] + "_n", non_color=True)
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(nx.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
        if m.get("metallicRoughnessMap"):  # glTF: roughness=G, metalness=B
            mr = teximg(m["metallicRoughnessMap"], m["name"] + "_mr", non_color=True)
            sep = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(mr.outputs["Color"], sep.inputs["Color"])
            nt.links.new(sep.outputs["Green"], b.inputs["Roughness"]); nt.links.new(sep.outputs["Blue"], b.inputs["Metallic"])
        if m.get("emissiveMap") and "Emission Color" in b.inputs:
            nt.links.new(teximg(m["emissiveMap"], m["name"] + "_e").outputs["Color"], b.inputs["Emission Color"])
            b.inputs["Emission Strength"].default_value = 1.0
        if m.get("skin"):
            if "Subsurface Weight" in b.inputs: b.inputs["Subsurface Weight"].default_value = 0.15
            if "Subsurface Radius" in b.inputs: b.inputs["Subsurface Radius"].default_value = (0.36, 0.18, 0.12)
            if "Subsurface Scale" in b.inputs: b.inputs["Subsurface Scale"].default_value = 0.08
        me.materials.append(mat)

    cd = data["camera"]
    cam = bpy.data.cameras.new("cam"); co = bpy.data.objects.new("cam", cam)
    scene.collection.objects.link(co); scene.camera = co
    look = mathutils.Vector(cd["forward"]).normalized(); upv = mathutils.Vector(cd["up"]).normalized()
    right = look.cross(upv).normalized(); trueup = right.cross(look).normalized()
    basis = mathutils.Matrix((right, trueup, -look)).transposed().to_4x4()
    co.matrix_world = mathutils.Matrix.Translation(mathutils.Vector(cd["position"])) @ basis
    cam.sensor_fit = 'VERTICAL'; cam.sensor_height = 24.0
    cam.lens = (cam.sensor_height / 2.0) / math.tan(cd["fovY"] / 2.0)

    for l in data["lights"]:
        if l["type"] == "directional":
            d = bpy.data.lights.new("sun", 'SUN'); d.energy = max(1.0, l["intensity"] * 4.0); d.color = l["color"]
            o = bpy.data.objects.new("sun", d); scene.collection.objects.link(o)
            o.rotation_euler = mathutils.Vector(l["direction"]).to_track_quat('-Z', 'Y').to_euler()
        elif l["type"] == "point":
            d = bpy.data.lights.new("pt", 'POINT'); d.energy = l["intensity"] * 200; d.color = l["color"]
            o = bpy.data.objects.new("pt", d); o.location = l["position"]; scene.collection.objects.link(o)

    world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    hemi = next((l for l in data["lights"] if l["type"] == "hemisphere"), None)
    amb = next((l for l in data["lights"] if l["type"] == "ambient"), None)
    if data.get("sky"):
        c = data["sky"]["top"]; strength = 1.2
    elif hemi:
        c = hemi.get("skyColor") or hemi["color"]; strength = max(0.6, hemi["intensity"] * 1.6)
    else:
        c = data["background"]; strength = 1.0
    if hemi and not data.get("sky"): strength = max(strength, hemi["intensity"] * 1.6)
    if amb: strength += amb["intensity"]
    bg.inputs[0].default_value = (c[0], c[1], c[2], 1); bg.inputs[1].default_value = strength

    scene.view_settings.view_transform = 'Standard'
    scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    try: scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception: pass
    scene.cycles.seed = 0
    scene.render.resolution_x = data["width"]; scene.render.resolution_y = data["height"]
    scene.render.image_settings.file_format = 'PNG'; scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print("RENDERED", out_png)

argv = sys.argv[sys.argv.index("--") + 1:]
opt = {k: v for k, v in (a.split("=", 1) for a in argv if "=" in a)}
samples = int(opt.get("samples", 48))
if "manifest" in opt:
    man = json.load(open(opt["manifest"]))
    for it in man["items"]:
        build_and_render(json.load(open(it["in"])), it["out"], samples)
else:
    build_and_render(json.load(open(argv[0])), argv[1], samples)
