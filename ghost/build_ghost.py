# Blender 4.5: builds ghost.blend / ghost.glb / ghost.usdz
# Human-sized sheet ghost, skeletal animation: hidden lead -> materialize far away -> curved swoop -> settle -> looping idle bob.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix, Quaternion, Euler
D = '/workspace/ar-statue-app'
FPS = 24
LEAD = 2.5          # s hidden (Quick Look: lets AR find the floor before the ghost appears)
MAT = 0.5           # s materialize
FLY = 4.0           # s swoop
P = 4.0             # s idle period (bob + sway + cloth wave are all periodic in P)
CYCLES_USDZ = 30    # idle cycles in the USDZ before it vanishes and the whole thing loops
VANISH = 0.5
TI = LEAD + MAT + FLY
f = lambda s: int(round(s * FPS))
F_TI, F_P = f(TI), f(P)
F_END_USDZ = F_TI + CYCLES_USDZ * F_P + f(VANISH)
F_GLB0, F_GLB1 = f(LEAD), F_TI + 2 * F_P
CENTER = Vector((0, 0, 1.15))   # rest pivot (ghost centre); hem/tail bottom ~0.4 m above floor
TOP, BOT = 1.92, 0.40

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.fps = FPS; sc.unit_settings.system = 'METRIC'

def ss(a, b, x):
    t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t)

# ---------- centerline + profile (s=0 crown .. s=HEM hem rim .. s=1 underside centre) ----------
HEM = 0.8; HEMZ = 0.56
def centre(s):
    if s <= HEM: return Vector((0, 0, TOP - (TOP - HEMZ) * s / HEM))
    return Vector((0, 0, HEMZ + 0.07 * (s - HEM) / (1 - HEM)))   # hollow underside of the sheet
def radius(s, th):
    if s < 0.2: r = 0.25 * math.sqrt(max(0, 1 - ((0.2 - s) / 0.2) ** 2))           # tall dome head
    elif s < 0.3: r = 0.25 + 0.02 * (s - 0.2) / 0.1
    elif s <= HEM: r = 0.27 + 0.20 * ((s - 0.3) / (HEM - 0.3)) ** 1.5               # sheet falls wider
    else: r = 0.47 * (1 - ((s - HEM) / (1 - HEM)) ** 1.4)
    folds = 1 + 0.075 * math.cos(7 * th) * ss(0.35, HEM, s)                         # cloth folds -> hem points
    arms = 0.06 * math.exp(-((s - 0.47) / 0.08) ** 2) * abs(math.cos(th)) ** 8      # soft arm drape
    return max(0.0, r * folds + arms)
def zdrop(s, th):   # scalloped hem: points hang down between folds
    return -0.10 * (0.5 + 0.5 * math.cos(7 * th)) ** 2 * math.exp(-((s - HEM) / 0.07) ** 2)
NS, NT = 96, 70
def build_mesh(name, offset=0.0):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    rings = []
    top = bm.verts.new(centre(0) + Vector((0, 0, offset)))
    for i in range(1, NS):
        s = i / NS; c = centre(s)
        ring = []
        for j in range(NT):
            th = 2 * math.pi * j / NT
            r = radius(s, th) + offset
            ring.append(bm.verts.new(c + Vector((math.cos(th) * r, math.sin(th) * r * 0.88, zdrop(s, th)))))
        rings.append(ring)
    tip = bm.verts.new(centre(1))
    # face order matters for renderers that don't depth-write translucent surfaces: hidden underside first, crown last
    for j in range(NT):
        bm.faces.new((rings[-1][j], rings[-1][(j + 1) % NT], tip))
    for i in reversed(range(len(rings) - 1)):
        a, b = rings[i], rings[i + 1]
        for j in range(NT):
            bm.faces.new((a[j], a[(j + 1) % NT], b[(j + 1) % NT], b[j]))
    for j in range(NT):
        bm.faces.new((top, rings[0][(j + 1) % NT], rings[0][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o); return o
# wispy tail: tapered tube from the lower back, trailing behind (+Y) and curling up
TAILPTS = [Vector((0, 0.25, 0.94)), Vector((0, 0.48, 0.68)), Vector((0, 0.72, 0.47)), Vector((0, 0.98, 0.46)), Vector((0, 1.12, 0.6))]
def tail_at(u):
    n = len(TAILPTS) - 1; x = min(n - 1e-6, u * n); i = int(x); t = x - i
    p0 = TAILPTS[max(0, i - 1)]; p1 = TAILPTS[i]; p2 = TAILPTS[i + 1]; p3 = TAILPTS[min(n, i + 2)]
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
def build_tail(name):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); NU, NV = 48, 20; rings = []
    for i in range(NU):
        u = i / (NU - 1); c = tail_at(u); tg = (tail_at(min(1, u + 0.01)) - tail_at(max(0, u - 0.01))).normalized()
        ax = Vector((1, 0, 0)); ay = tg.cross(ax).normalized(); r = 0.17 * (1 - u) ** 1.2 + 0.006
        r *= 1 + 0.12 * math.sin(u * 9)
        rings.append([bm.verts.new(c + ax * math.cos(2 * math.pi * j / NV) * r + ay * math.sin(2 * math.pi * j / NV) * r * 0.75) for j in range(NV)])
    for i in range(NU - 1):
        for j in range(NV):
            bm.faces.new((rings[i][j], rings[i][(j + 1) % NV], rings[i + 1][(j + 1) % NV], rings[i + 1][j]))
    tipv = bm.verts.new(tail_at(1)); 
    for j in range(NV): bm.faces.new((rings[-1][j], rings[-1][(j + 1) % NV], tipv))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o); return o
def principled(name, base, emit, estr, alpha, cull=True):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*base, 1)
    p.inputs['Emission Color'].default_value = (*emit, 1)
    p.inputs['Emission Strength'].default_value = estr
    p.inputs['Alpha'].default_value = alpha
    p.inputs['Roughness'].default_value = 0.6 if alpha < 1 else 1.0
    if base[0] < 0.1: p.inputs['Specular IOR Level'].default_value = 0.0
    m.use_backface_culling = cull
    if alpha < 1: m.surface_render_method = 'BLENDED'
    return m

body = build_mesh('GhostBody'); tail = build_tail('GhostTail')
halo = None
sheet = principled('GhostSheet', (0.93, 0.96, 1.0), (0.82, 0.90, 1.0), 0.75, 0.86)
body.data.materials.append(sheet); tail.data.materials.append(sheet)
# one mesh, tail triangles FIRST: renderers that don't depth-write translucent surfaces then draw the body over the tail
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); tail.select_set(True); bpy.context.view_layer.objects.active = tail
NTV = len(tail.data.vertices)
bpy.ops.object.join(); body = bpy.context.object; body.name = 'GhostBody'; body.data.name = 'GhostBody'; tail = None

# hollow dark eyes + mouth: dark ellipsoids sunk into the face (-Y side)
dark = principled('GhostEyes', (0.01, 0.01, 0.02), (0, 0, 0), 0.0, 1.0)
def face_point(z, x):
    s = (TOP - z) / (TOP - HEMZ) * HEM; best = None
    for j in range(720):
        th = 2 * math.pi * j / 720
        if math.sin(th) > 0: continue
        r = radius(s, th); px = math.cos(th) * r
        if best is None or abs(px - x) < abs(best[0] - x): best = (px, math.sin(th) * r * 0.88)
    return Vector((best[0], best[1], z))
feat = []
for nm, z, x, sc3 in (('EyeL', 1.70, -0.085, (0.052, 0.045, 0.085)), ('EyeR', 1.70, 0.085, (0.052, 0.045, 0.085)), ('Mouth', 1.54, 0.0, (0.05, 0.04, 0.075))):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=1)
    o = bpy.context.object; o.name = nm; o.scale = sc3
    o.location = face_point(z, x) + Vector((0, 0.022, 0))
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth(); o.data.materials.append(dark); feat.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in feat: o.select_set(True)
bpy.context.view_layer.objects.active = feat[0]; bpy.ops.object.join(); eyes = bpy.context.object; eyes.name = 'GhostFace'

# floor shadow disc (keeps the bounding-box bottom on the floor so the hover gap survives placement)
import numpy as np
N = 128; yy, xx = np.mgrid[0:N, 0:N]; d = np.hypot(xx - N / 2 + .5, yy - N / 2 + .5) / (N / 2)
a = np.clip(1 - d, 0, 1) ** 1.8 * 0.55
px = np.zeros((N, N, 4), np.float32); px[..., 3] = a
img = bpy.data.images.new('ghost_shadow', N, N, alpha=True); img.pixels = px.ravel()
img.filepath_raw = D + '/ghost/ghost_shadow.png'; img.file_format = 'PNG'; img.save()
img = bpy.data.images.load(D + '/ghost/ghost_shadow.png')
sm = bpy.data.materials.new('GhostShadow'); sm.use_nodes = True; nt = sm.node_tree; pr = nt.nodes['Principled BSDF']
tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img
pr.inputs['Base Color'].default_value = (0, 0, 0, 1); pr.inputs['Roughness'].default_value = 1
nt.links.new(tx.outputs['Alpha'], pr.inputs['Alpha']); sm.surface_render_method = 'BLENDED'
bpy.ops.mesh.primitive_plane_add(size=1.1, location=(0, 0, 0.004)); shadow = bpy.context.object; shadow.name = 'GhostShadow'
shadow.data.materials.append(sm)

# ---------- armature ----------
arm_d = bpy.data.armatures.new('GhostRig'); arm = bpy.data.objects.new('GhostRig', arm_d); sc.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
eb = arm_d.edit_bones
root = eb.new('Root'); root.head = CENTER; root.tail = CENTER + Vector((0, 0, 0.3))
sh = eb.new('Shadow'); sh.head = (0, 0, 0); sh.tail = (0, 0.3, 0)
BSEG = [0.0, 0.25, 0.5, 0.68]               # body chain C0..C2 (crown -> lower sheet)
chain = []; prev = root
for k in range(3):
    b = eb.new('C%d' % k); b.head = centre(BSEG[k]); b.tail = centre(BSEG[k + 1]); b.parent = prev; b.use_connect = k > 0
    chain.append(b.name); prev = b
hem = []
for k, th in enumerate((-math.pi / 2, 0, math.pi / 2, math.pi)):   # front, right, back, left hem flaps
    b = eb.new('H%d' % k); b.head = centre(0.62); b.tail = Vector((math.cos(th) * 0.45, math.sin(th) * 0.4, HEMZ)); b.parent = eb['C2']
    hem.append((b.name, th))
TU = [0.0, 0.3, 0.6, 1.0]; tbones = []; prev = eb['C2']
for k in range(3):
    b = eb.new('T%d' % k); b.head = tail_at(TU[k]); b.tail = tail_at(TU[k + 1]); b.parent = prev; b.use_connect = k > 0
    tbones.append(b.name); prev = b
bpy.ops.object.mode_set(mode='OBJECT')
ALLB = chain + [h for h, _ in hem] + tbones + ['Shadow']
mids = [(BSEG[k] + BSEG[k + 1]) / 2 for k in range(3)]
def chain_w(s):
    if s <= mids[0]: return {chain[0]: 1.0}
    if s >= mids[-1]: return {chain[-1]: 1.0}
    for k in range(2):
        if mids[k] <= s <= mids[k + 1]:
            t = ss(mids[k], mids[k + 1], s); return {chain[k]: 1 - t, chain[k + 1]: t}
def body_w(v):
    z = v.co.z; s = min(HEM, max(0, (TOP - z) / (TOP - HEMZ) * HEM))
    w = chain_w(s); hw = ss(0.5, 0.78, s) * 0.85
    if v.co.length > 0 and hw > 0:
        th = math.atan2(v.co.y / 0.88, v.co.x); tot = 0; hs = {}
        for nm, a in hem:
            d = math.cos(th - a); g = max(0, d) ** 2; hs[nm] = g; tot += g
        w = {k: x * (1 - hw) for k, x in w.items()}
        for nm, g in hs.items():
            if g > 0: w[nm] = w.get(nm, 0) + hw * g / tot
    return w
def tail_w(v):
    best = min(range(41), key=lambda i: (tail_at(i / 40) - v.co).length); u = best / 40
    if u < 0.15: return {chain[2]: 1 - u / 0.15, tbones[0]: u / 0.15}
    tm = [(TU[k] + TU[k + 1]) / 2 for k in range(3)]
    if u <= tm[0]: return {tbones[0]: 1.0}
    if u >= tm[-1]: return {tbones[-1]: 1.0}
    for k in range(2):
        if tm[k] <= u <= tm[k + 1]:
            t = ss(tm[k], tm[k + 1], u); return {tbones[k]: 1 - t, tbones[k + 1]: t}
def skin(o, fn):
    for nm in ALLB: o.vertex_groups.new(name=nm)
    for v in o.data.vertices:
        for k, w in fn(v).items():
            if w > 1e-4: o.vertex_groups[k].add([v.index], w, 'REPLACE')
    o.parent = arm; md = o.modifiers.new('Armature', 'ARMATURE'); md.object = arm
def ghost_w(v): return tail_w(v) if v.index < NTV else body_w(v)   # tail verts come first after join
skin(body, ghost_w); skin(eyes, lambda v: {'C0': 1.0}); skin(shadow, lambda v: {'Shadow': 1.0})

# ---------- animation ----------
def bez(p0, p1, p2, p3, u):
    m = 1 - u; return p0 * m**3 + p1 * 3 * m * m * u + p2 * 3 * m * u * u + p3 * u**3
P0 = Vector((-2.6, 6.8, 2.55)); P1 = Vector((3.4, 5.0, 2.9)); P2 = Vector((1.6, 0.9, 1.25)); P3 = CENTER.copy()
def ease(t, a=3.0): return 1 - (1 - t) ** a * (1 + a * t)
def flight_pos(t):
    tau = min(1, max(0, (t - LEAD - MAT) / FLY)); return bez(P0, P1, P2, P3, ease(tau)), tau
W = 2 * math.pi / P
pb = arm.pose.bones
for b in pb: b.rotation_mode = 'QUATERNION'
rest_root = arm_d.bones['Root'].matrix_local; rest_sh = arm_d.bones['Shadow'].matrix_local
def lerp_ang(a, b, t):
    d = (b - a + math.pi) % (2 * math.pi) - math.pi; return a + d * t
phase = 0.0; prev_yaw = 0.0
def state(t):
    """returns centre pos, yaw, pitch, roll, scale, speed, trail"""
    dt = 1 / FPS
    if t < TI:
        p, tau = flight_pos(t); pa, _ = flight_pos(t - dt); pb2, _ = flight_pos(t + dt)
        v = (pb2 - pa) / (2 * dt); acc = (pb2 - 2 * p + pa) / (dt * dt)
        sp = Vector((v.x, v.y)).length
        yaw_move = math.atan2(v.x, -v.y) if sp > 0.05 else 0.0      # local -Y faces the motion
        yaw = lerp_ang(yaw_move, 0.0, ss(0.55, 1.0, tau)) if t >= LEAD + MAT else math.atan2(P1.x - P0.x, -(P1.y - P0.y))
        lat = (v.x * acc.y - v.y * acc.x) / max(sp, 0.3)             # signed lateral accel
        roll = max(-0.45, min(0.45, -0.06 * lat)) * (1 - ss(0.8, 1, tau))
        pitch = -min(0.3, 0.07 * sp)                                 # lean into the swoop
        scl = 0.01 if t < LEAD else 0.01 + 0.99 * ss(LEAD, LEAD + MAT, t)
        return p, yaw, pitch, roll, scl, v.length
    te = t - TI; ramp = ss(0, P, te)
    p = CENTER + Vector((0.03 * math.sin(W * te + 1.1) * ramp, 0.02 * math.sin(W * te + 2.0) * ramp, 0.10 * math.sin(W * te) * ramp))
    yaw = 0.09 * math.sin(W * te + 0.6) * ramp; roll = 0.06 * math.sin(W * te + 1.7) * ramp; pitch = 0.035 * math.sin(W * te + 0.3) * ramp
    scl = 1.0
    tv = F_END_USDZ / FPS - VANISH
    if t > tv:   # vanish (USDZ only): shrink + rise, then the file loops back to the hidden lead
        k = ss(tv, tv + VANISH, t); scl = 1 - 0.99 * k; p = p + Vector((0, 0, 0.6 * k))
    return p, yaw, pitch, roll, scl, 0.0
def key(fr):
    global phase
    t = fr / FPS
    p, yaw, pitch, roll, scl, spd = state(t)
    R = (Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(pitch, 4, 'X') @ Matrix.Rotation(roll, 4, 'Y'))
    M = Matrix.Translation(p) @ R @ Matrix.Diagonal((scl, scl, scl, 1))
    bas = rest_root.inverted() @ M @ Matrix.Translation(-CENTER) @ rest_root
    l, q, s = bas.decompose()
    r = pb['Root']; r.location = l; r.rotation_quaternion = q; r.scale = s
    for a in ('location', 'rotation_quaternion', 'scale'): r.keyframe_insert(a, frame=fr)
    gs = max(0.25, min(1.25, 1.25 - 0.3 * (p.z - CENTER.z))) * (0.01 + 0.99 * ss(0.3, 1.0, scl))
    Ms = Matrix.Translation((p.x, p.y, 0)) @ Matrix.Diagonal((gs, gs, gs, 1))
    l, q, s = (rest_sh.inverted() @ Ms @ rest_sh).decompose()
    b = pb['Shadow']; b.location = l; b.rotation_quaternion = q; b.scale = s
    for a in ('location', 'rotation_quaternion', 'scale'): b.keyframe_insert(a, frame=fr)
    # cloth/tail: travelling wave down the chain; stronger + faster while flying, tail trails with speed
    fly = min(1.0, spd / 2.5)
    phase += (2 * W if t >= TI else 2 * W * (1 + 1.2 * fly)) / FPS
    def rk(nm, bx, bz):
        c = pb[nm]; c.rotation_quaternion = Euler((bx, 0, bz)).to_quaternion(); c.keyframe_insert('rotation_quaternion', frame=fr)
    for k, nm in enumerate(chain):
        if k == 0: continue
        amp = (0.02 + 0.015 * k) * (1 + 1.5 * fly)
        rk(nm, amp * math.sin(phase - 0.9 * k) - fly * 0.06 * k, 0.6 * amp * math.sin(phase - 0.9 * k + 1.3))
    for k, (nm, th) in enumerate(hem):          # hem flaps flutter, out of phase
        amp = 0.06 * (1 + 1.8 * fly)
        rk(nm, amp * math.sin(phase + 1.57 * k), 0.4 * amp * math.sin(phase + 1.57 * k + 0.8))
    for k, nm in enumerate(tbones):             # tail whips: travelling wave, lifts while flying
        amp = (0.10 + 0.07 * k) * (1 + 1.2 * fly)
        rk(nm, amp * math.sin(phase - 1.1 * k) * 0.6 + fly * 0.10, amp * math.sin(phase - 1.1 * k + 0.5))
# make the idle wave phase exactly periodic: snap phase at TI to a multiple of 2pi
F_LAST = F_END_USDZ - 1
for fr in range(0, F_LAST + 1):
    if fr == F_TI: phase = round(phase / (2 * math.pi)) * 2 * math.pi
    key(fr)
for fc in arm.animation_data.action.fcurves:
    for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'
sc.frame_start = 0; sc.frame_end = F_LAST
bpy.ops.wm.save_as_mainfile(filepath=D + '/ghost/ghost.blend')
print('TIMING', dict(FPS=FPS, F_TI=F_TI, F_P=F_P, F_END_USDZ=F_END_USDZ, F_GLB0=F_GLB0, F_GLB1=F_GLB1))

def sel_all():
    bpy.ops.object.select_all(action='DESELECT')
    for o in (arm, body, eyes, shadow): o.select_set(True)
    bpy.context.view_layer.objects.active = arm
sel_all()
if 'usd' in sys.argv:
    bpy.ops.wm.usd_export(filepath=D + '/ghost.usdz', selected_objects_only=True, export_animation=True, export_armatures=True,
        export_shapekeys=False, only_deform_bones=False, export_materials=True, generate_preview_surface=True, export_textures=True,
        convert_orientation=True, export_global_forward_selection='NEGATIVE_Z', export_global_up_selection='Y',
        convert_scene_units='METERS', export_uvmaps=True, export_lights=False, export_cameras=False, usdz_downscale_size='KEEP')
if 'glb' in sys.argv:
    sc.frame_start = F_GLB0; sc.frame_end = F_GLB1
    bpy.ops.export_scene.gltf(filepath=D + '/ghost.glb', export_format='GLB', use_selection=True, export_yup=True,
        export_animations=True, export_animation_mode='ACTIVE_ACTIONS', export_frame_range=True, export_force_sampling=True,
        export_anim_single_armature=True, export_anim_slide_to_zero=True, export_def_bones=False, export_image_format='AUTO', export_apply=False)
    sc.frame_start = 0; sc.frame_end = F_LAST
