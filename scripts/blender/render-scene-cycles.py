# Render one baked vsim frame (from scripts/cycles/bake.ts) with Cycles. Builds the world-space
# meshes, the scene's actual lights + camera, and Principled materials (subsurface for skin), then
# path-traces a PNG. Driven per-frame by the Cycles render pipeline.
#
#   blender --background --python scripts/blender/render-scene-cycles.py -- <frame.json> <out.png> [samples]
import bpy, sys, json, base64, math, mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
inp, out = argv[0], argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else 48
data = json.load(open(inp))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def image_from_rgba(name, w, h, b64):
    raw = base64.b64decode(b64)
    img = bpy.data.images.new(name, w, h)
    px = [0.0] * (w * h * 4)
    # glTF/vsim texture row 0 = top; Blender image row 0 = bottom → flip vertically
    for y in range(h):
        sy = h - 1 - y
        for x in range(w * 4):
            px[(y * w * 4) + x] = raw[(sy * w * 4) + x] / 255.0
    img.pixels = px
    img.pack()
    return img

for m in data["meshes"]:
    me = bpy.data.meshes.new(m["name"])
    pos = m["positions"]
    verts = [(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) for i in range(len(pos) // 3)]
    idx = m["indices"]
    faces = [(idx[i], idx[i + 1], idx[i + 2]) for i in range(0, len(idx), 3)]
    me.from_pydata(verts, [], faces)
    me.update()
    obj = bpy.data.objects.new(m["name"], me)
    scene.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for p in me.polygons: p.use_smooth = True  # smooth shading; normals come from vsim's consistent winding
    if m.get("uvs"):
        uv = m["uvs"]; uvl = me.uv_layers.new(name="UV")
        for loop in me.loops:
            vi = loop.vertex_index
            uvl.data[loop.index].uv = (uv[vi * 2], 1.0 - uv[vi * 2 + 1])

    mat = bpy.data.materials.new(m["name"]); mat.use_nodes = True
    b = mat.node_tree.nodes.get("Principled BSDF")
    c = m["color"]; b.inputs["Base Color"].default_value = (c[0], c[1], c[2], 1)
    b.inputs["Roughness"].default_value = m.get("roughness", 0.8)
    b.inputs["Metallic"].default_value = m.get("metalness", 0)
    em = m.get("emissive", [0, 0, 0])
    if any(em):
        if "Emission Color" in b.inputs: b.inputs["Emission Color"].default_value = (em[0], em[1], em[2], 1)
        if "Emission Strength" in b.inputs: b.inputs["Emission Strength"].default_value = 1.0
    if m.get("texture"):
        t = m["texture"]; img = image_from_rgba(m["name"], t["width"], t["height"], t["rgba"])
        tx = mat.node_tree.nodes.new("ShaderNodeTexImage"); tx.image = img
        mat.node_tree.links.new(tx.outputs["Color"], b.inputs["Base Color"])
    if m.get("skin"):
        if "Subsurface Weight" in b.inputs: b.inputs["Subsurface Weight"].default_value = 0.15
        if "Subsurface Radius" in b.inputs: b.inputs["Subsurface Radius"].default_value = (0.36, 0.18, 0.12)
        if "Subsurface Scale" in b.inputs: b.inputs["Subsurface Scale"].default_value = 0.08
    me.materials.append(mat)

# camera
cd = data["camera"]
cam = bpy.data.cameras.new("cam"); co = bpy.data.objects.new("cam", cam)
scene.collection.objects.link(co); scene.camera = co
# build the camera basis explicitly from forward+up (camera looks down -Z, up is +Y, right is +X)
look = mathutils.Vector(cd["forward"]).normalized()
upv = mathutils.Vector(cd["up"]).normalized()
right = look.cross(upv).normalized()
trueup = right.cross(look).normalized()
basis = mathutils.Matrix((right, trueup, -look)).transposed().to_4x4()
co.matrix_world = mathutils.Matrix.Translation(mathutils.Vector(cd["position"])) @ basis
# vsim's fov is VERTICAL; set the lens from a vertical sensor fit so framing matches exactly
cam.sensor_fit = 'VERTICAL'; cam.sensor_height = 24.0
cam.lens = (cam.sensor_height / 2.0) / math.tan(cd["fovY"] / 2.0)

# lights (directional → SUN, point → POINT; ambient/hemisphere fold into the world)
for l in data["lights"]:
    if l["type"] == "directional":
        d = bpy.data.lights.new("sun", 'SUN'); d.energy = max(1.0, l["intensity"] * 4.0); d.color = l["color"]
        o = bpy.data.objects.new("sun", d); scene.collection.objects.link(o)
        o.rotation_euler = mathutils.Vector(l["direction"]).to_track_quat('-Z', 'Y').to_euler()
    elif l["type"] == "point":
        d = bpy.data.lights.new("pt", 'POINT'); d.energy = l["intensity"] * 200; d.color = l["color"]
        o = bpy.data.objects.new("pt", d); o.location = l["position"]; scene.collection.objects.link(o)

# world / ambient: a bright sky so the scene isn't black (prefer the gradient-sky top, then a
# hemisphere's sky tint, then the flat background); add any ambient light on top.
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

scene.view_settings.view_transform = 'Standard'  # predictable (no filmic darkening); matches vsim's tone
scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
try: scene.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception: pass
scene.cycles.seed = 0
scene.render.resolution_x = data["width"]; scene.render.resolution_y = data["height"]
scene.render.image_settings.file_format = 'PNG'; scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("RENDERED", out)
