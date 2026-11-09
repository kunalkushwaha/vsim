# assetkit.export — the bridge: any assetkit build (or any Blender asset) -> one vsim-ready GLB.
#
#   import export; stats = export.bake_to_glb("haveli", "/tmp/haveli.glb", atlas=2048, lod=1)
#
# vsim's loadGltf() merges a model into ONE mesh with one set of maps, so the bridge bakes:
#   1. realise   every mesh/curve under the root (modifiers applied at `lod` subdivision,
#                instances made real, object-linked materials kept) into one mesh, in the
#                root's local space (asset origin = root origin, metres, Blender Z-up).
#   2. budget    decimate if over `max_tris`.
#   3. atlas UVs smart-project a fresh UV layer "atlas".
#   4. bake      from COPIES of the rich source materials into the atlas with Cycles (EMIT
#                trick): base colour, and — if anything glows (lit windows) — an emissive map.
#                World-projected textures, tints and procedural veins all bake correctly
#                because the bake evaluates the original shaders at each surface point.
#   5. export    one material (base colour [+ emissive]) on TEXCOORD_0 -> GLB (Y-up).
# Live-session safe: works on copies and restores every setting it touches.
import math, os, random
import bpy
from mathutils import Matrix


def _descendants(root):
    out, st = [], [root]
    while st:
        o = st.pop(); out.append(o); st.extend(o.children)
    return out


def _principled(nt):
    return next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)


def _output(nt):
    return next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) or \
        next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)


def _src(sock):
    """(linked output socket, None) or (None, default value) for an input socket."""
    if sock.is_linked:
        return sock.links[0].from_socket, None
    return None, sock.default_value


def _emit_setup(mat, image, mode, night=None):
    """Rewire a material COPY so its surface emits what we want baked; add the target image node."""
    nt = mat.node_tree; out = _output(nt); p = _principled(nt)
    for n in list(nt.nodes):          # per-object randomness -> per-face attribute (survives the merge)
        if n.type == "OBJECT_INFO" and n.outputs["Random"].is_linked:
            at = nt.nodes.new("ShaderNodeAttribute"); at.attribute_type = "GEOMETRY"; at.attribute_name = "piece_rand"
            for l in list(n.outputs["Random"].links): nt.links.new(at.outputs["Fac"], l.to_socket)
    if night is not None and "night" in nt.nodes:
        nt.nodes["night"].outputs[0].default_value = night
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Strength"].default_value = 1.0
    if p is None:  # non-principled material: neutral grey albedo, and it does NOT glow
        em.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1) if mode == "color" else (0, 0, 0, 1)
    elif mode == "color":
        s, v = _src(p.inputs["Base Color"])
        if s: nt.links.new(s, em.inputs["Color"])
        else: em.inputs["Color"].default_value = v
    else:  # emission: color * strength
        cs, cv = _src(p.inputs["Emission Color"]); ss, sv = _src(p.inputs["Emission Strength"])
        if cs: nt.links.new(cs, em.inputs["Color"])
        else: em.inputs["Color"].default_value = cv
        cap = nt.nodes.new("ShaderNodeMath"); cap.operation = "MINIMUM"; cap.inputs[1].default_value = 1.0
        if ss: nt.links.new(ss, cap.inputs[0])
        else: cap.inputs[0].default_value = sv
        nt.links.new(cap.outputs[0], em.inputs["Strength"])
    for l in list(out.inputs["Surface"].links): nt.links.remove(l)
    for l in list(out.inputs["Volume"].links): nt.links.remove(l)
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    # explicit UV nodes keep reading the ORIGINAL layout while we bake into "atlas"
    for n in nt.nodes:
        if n.type == "UVMAP" and not n.uv_map: n.uv_map = "UVMap"
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = image
    for n in nt.nodes: n.select = False
    tn.select = True; nt.nodes.active = tn


def _has_emission(mat):
    p = _principled(mat.node_tree) if mat and mat.node_tree else None
    if not p: return False
    s = p.inputs["Emission Strength"]
    return s.is_linked or s.default_value > 0


def bake_to_glb(root_name, out_glb, atlas=2048, lod=1, max_tris=None, margin=6, jpeg_quality=90, keep=False, night=None,
                ground=True):
    sc = bpy.context.scene; dg = bpy.context.evaluated_depsgraph_get()
    root = bpy.data.objects[root_name]
    inv = root.matrix_world.inverted()
    parts = [o for o in _descendants(root) if o.type in {"MESH", "CURVE"} and not o.hide_render]
    # --- 1. realise at the requested LOD
    saved_levels = {}
    for o in parts:
        for m in o.modifiers:
            if m.type == "SUBSURF":
                saved_levels[(o.name, m.name)] = m.levels; m.levels = min(m.render_levels, lod)
    dg.update()
    pieces = []
    try:
        for o in parts:
            ev = o.evaluated_get(dg)
            me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
            if not me.polygons:
                bpy.data.meshes.remove(me); continue
            me.transform(inv @ o.matrix_world)
            for i, slot in enumerate(o.material_slots):
                if i < len(me.materials): me.materials[i] = slot.material
                else: me.materials.append(slot.material)
            if "UVMap" not in me.uv_layers:
                if len(me.uv_layers): me.uv_layers[0].name = "UVMap"
                else: me.uv_layers.new(name="UVMap")
            for uv in list(me.uv_layers):
                if uv.name != "UVMap": me.uv_layers.remove(uv)
            ra = me.attributes.new("piece_rand", "FLOAT", "FACE")
            rv = random.Random(o.name).random()
            for d in ra.data: d.value = rv
            po = bpy.data.objects.new("_bake_piece", me); sc.collection.objects.link(po); pieces.append(po)
    finally:
        for o in parts:
            for m in o.modifiers:
                if (o.name, m.name) in saved_levels: m.levels = saved_levels[(o.name, m.name)]
    if not pieces:
        raise ValueError("bake_to_glb(%r): no renderable geometry under the root "
                         "(every part is empty or hide_render)" % root_name)
    bpy.ops.object.select_all(action="DESELECT")
    for p in pieces: p.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    merged = bpy.context.object; merged.name = root_name + "_baked"
    me = merged.data
    for p in me.polygons: p.use_smooth = True
    if ground:   # films place props by their origin on the ground plane: lowest point -> z=0
        zmin = min(v.co.z for v in me.vertices)
        me.transform(Matrix.Translation((0, 0, -zmin)))
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    # glTF / vsim axes (Y-up): [width x, height, depth]
    size_yup = [round(max(xs) - min(xs), 3), round(max(zs) - min(zs), 3), round(max(ys) - min(ys), 3)]
    # --- 2. budget
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if max_tris and tris > max_tris:
        d = merged.modifiers.new("dec", "DECIMATE"); d.ratio = max_tris / tris
        bpy.ops.object.modifier_apply(modifier=d.name)
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
    # --- 3. atlas UVs
    at = me.uv_layers.new(name="atlas"); me.uv_layers.active = at
    me.uv_layers["UVMap"].active_render = True
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.002, area_weight=1.0)
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.002)
    except Exception as e:
        print("pack_islands:", e)
    bpy.ops.object.mode_set(mode="OBJECT")
    # --- 4. bake (on material copies)
    saved = {"engine": sc.render.engine}
    try:
        sc.render.engine = "CYCLES"
    except TypeError:
        pass
    saved["samples"] = sc.cycles.samples; sc.cycles.samples = 8
    originals = list(me.materials)
    emissive = any(_has_emission(m) for m in originals if m)
    results = {}
    try:
        for mode in (["color", "emission"] if emissive else ["color"]):
            img = bpy.data.images.new("%s_%s" % (root_name, mode), atlas, atlas, alpha=False)
            copies = []
            for i, m in enumerate(originals):
                c = (m.copy() if m else bpy.data.materials.new("_blank"))
                c.use_nodes = True; _emit_setup(c, img, mode, night); me.materials[i] = c; copies.append(c)
            bpy.ops.object.select_all(action="DESELECT"); merged.select_set(True); bpy.context.view_layer.objects.active = merged
            bpy.ops.object.bake(type="EMIT", margin=margin, use_clear=True)
            results[mode] = img
            for c in copies: bpy.data.materials.remove(c)
    finally:
        sc.cycles.samples = saved["samples"]
        try: sc.render.engine = saved["engine"]
        except TypeError: pass
    # --- 5. one material on the atlas, then export
    out_mat = bpy.data.materials.new(root_name + "_asset"); out_mat.use_nodes = True
    nt = out_mat.node_tree; p = _principled(nt)
    uvn = nt.nodes.new("ShaderNodeUVMap"); uvn.uv_map = "atlas"
    ci = nt.nodes.new("ShaderNodeTexImage"); ci.image = results["color"]; nt.links.new(uvn.outputs[0], ci.inputs[0])
    nt.links.new(ci.outputs[0], p.inputs["Base Color"]); p.inputs["Roughness"].default_value = 0.7
    if "emission" in results:
        ei = nt.nodes.new("ShaderNodeTexImage"); ei.image = results["emission"]; nt.links.new(uvn.outputs[0], ei.inputs[0])
        nt.links.new(ei.outputs[0], p.inputs["Emission Color"]); p.inputs["Emission Strength"].default_value = 1.0
    me.materials.clear(); me.materials.append(out_mat)
    me.uv_layers.remove(me.uv_layers["UVMap"]); me.uv_layers["atlas"].active = True; me.uv_layers["atlas"].active_render = True
    os.makedirs(os.path.dirname(out_glb) or ".", exist_ok=True)
    saved_mw = merged.matrix_world.copy(); merged.matrix_world = Matrix()
    # export from a throwaway scene holding ONLY the baked asset: the glTF exporter otherwise
    # picks up objects left selected in other scenes of the same .blend
    win = bpy.context.window; prev_scene = win.scene if win else None
    tmp = bpy.data.scenes.new("_export_tmp"); tmp.collection.objects.link(merged)
    kw = dict(filepath=out_glb, export_format="GLB", use_selection=False, use_active_scene=True, export_apply=True,
              export_yup=True, export_animations=False, export_materials="EXPORT")
    try:
        if win: win.scene = tmp
        with bpy.context.temp_override(scene=tmp):
            try:
                bpy.ops.export_scene.gltf(export_image_format="JPEG", export_jpeg_quality=jpeg_quality, **kw)
            except TypeError:
                bpy.ops.export_scene.gltf(**kw)
    finally:
        if win and prev_scene: win.scene = prev_scene
        tmp.collection.objects.unlink(merged); bpy.data.scenes.remove(tmp)
    stats = {"glb": out_glb, "triangles": tris, "atlas": atlas, "emissive": "emission" in results, "size": size_yup,
             "mb": round(os.path.getsize(out_glb) / 1e6, 2)}
    if not keep:
        bpy.data.objects.remove(merged, do_unlink=True); bpy.data.meshes.remove(me)
        for img in results.values(): bpy.data.images.remove(img)
        bpy.data.materials.remove(out_mat)
    else:
        merged.matrix_world = saved_mw
    return stats
