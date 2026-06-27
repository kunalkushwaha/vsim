# Photoreal render of a vsim character via Blender's Cycles path tracer. Imports a glTF, gives skin
# materials real subsurface scattering, sets a studio 3-point light rig + a framed camera, and writes
# a path-traced PNG. This is vsim's "final render" quality path (the editor preview stays real-time).
#
#   blender --background --python scripts/blender/render-cycles.py -- <in.glb> <out.png> [samples=64] [res=800] [azimuth=0]
import bpy, sys, math, mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[-2:]
inp = next(a for a in argv if a.endswith((".glb", ".gltf")))
out = next(a for a in argv if a.endswith(".png"))
opt = {k: v for k, v in (a.split("=", 1) for a in argv if "=" in a)}
SAMPLES = int(opt.get("samples", 64))
RES = int(opt.get("res", 800))
AZ = math.radians(float(opt.get("azimuth", 0)))  # spin the camera around if the model faces away

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=inp)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# --- combined world-space bounding box (Blender is Z-up after glTF import) ---
mn = mathutils.Vector((1e9, 1e9, 1e9)); mx = mathutils.Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        for i in range(3): mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
center = (mn + mx) / 2.0
size = mx - mn
height = size.z
diag = size.length

# --- skin: give body materials subsurface scattering (keep their base-colour texture) ---
for mat in bpy.data.materials:
    if not mat.use_nodes: continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf: continue
    skin = any(s in mat.name.lower() for s in ("body", "human", "skin", "base"))
    def setv(name, val):
        if name in bsdf.inputs: bsdf.inputs[name].default_value = val
    if skin:
        setv("Subsurface Weight", 0.15)
        if "Subsurface Radius" in bsdf.inputs: bsdf.inputs["Subsurface Radius"].default_value = (0.36, 0.18, 0.12)
        setv("Subsurface Scale", 0.08)
        setv("Roughness", 0.45)
    else:
        setv("Roughness", 0.6)

# --- studio 3-point lighting (area lights) ---
def area(name, loc, energy, size_m, color):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = energy; d.size = size_m; d.color = color
    o = bpy.data.objects.new(name, d); o.location = loc
    o.rotation_euler = (center - mathutils.Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(o); return o
r = max(diag, 1.0)
area("key", (center.x - r, center.y - r * 1.2, center.z + r * 0.8), 600 * r * r, r, (1.0, 0.96, 0.9))
area("fill", (center.x + r * 1.3, center.y - r, center.z + r * 0.3), 180 * r * r, r * 1.4, (0.85, 0.9, 1.0))
area("rim", (center.x + r * 0.4, center.y + r * 1.3, center.z + r * 1.1), 400 * r * r, r * 0.6, (1.0, 1.0, 1.0))

# soft ambient world
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.055, 0.07, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6

# --- ground plane (catches shadows) ---
bpy.ops.mesh.primitive_plane_add(size=diag * 8, location=(center.x, center.y, mn.z))
gm = bpy.data.materials.new("ground"); gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.22, 0.22, 0.24, 1)
gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
bpy.context.object.data.materials.append(gm)

# --- camera: 3/4 front, framed to the body, ~portrait lens ---
cam_d = mathutils.Vector((math.sin(AZ + 0.5) , -math.cos(AZ + 0.5), 0.18)).normalized()
loc = center + cam_d * diag * 1.45
cam = bpy.data.cameras.new("cam"); cam.lens = 70
co = bpy.data.objects.new("cam", cam); co.location = loc
co.rotation_euler = (center - loc).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(co); scene.camera = co

# --- Cycles, CPU + denoise, AgX tonemapping (Blender default) ---
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
try: scene.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception as e: print("denoiser note:", e)
scene.cycles.seed = 0  # deterministic
scene.render.resolution_x = int(RES * 0.78)
scene.render.resolution_y = RES
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = out
print(f"rendering {SAMPLES} spp @ {scene.render.resolution_x}x{RES}, height={height:.2f}")
bpy.ops.render.render(write_still=True)
print("RENDERED", out)
