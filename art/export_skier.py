"""The cartoon skier: modelled, rigged and posed in Blender, exported for the game.

    python3 art/export_skier.py [--blend skier.blend] [--preview out_dir]

Writes public/models/skier.glb: one skinned mesh on a small skeleton, plus one animation per
pose (Stance, Crouch, Tuck, Air, Brake, Tumble). Each pose is a single held frame; the game
plays them all at once and blends their weights from what the rider is doing.

Parts are tagged by material name (jacket, pants, hat, skin, goggles, snow, ski, pole) and
the game paints them with theme colours. Built facing -Y (Blender's front), feet on the
skis at the origin, life size (the game scales him up so he reads from far away).
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.join(HERE, '..', 'public', 'models', 'skier.glb')
BLEND = argv[argv.index('--blend') + 1] if '--blend' in argv else None
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

PALETTE = {  # only for Blender previews; the game uses src/render/theme.js
    'jacket': (1.0, 0.28, 0.12), 'pants': (0.14, 0.22, 0.62), 'hat': (0.15, 0.75, 0.85),
    'skin': (0.95, 0.68, 0.52), 'goggles': (0.08, 0.06, 0.16), 'snow': (1, 1, 1),
    'ski': (1.0, 0.22, 0.22), 'pole': (0.2, 0.2, 0.3),
}
MATS = {}
for name, col in PALETTE.items():
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*col, 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*col, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.7
    MATS[name] = m
MAT_INDEX = {n: i for i, n in enumerate(PALETTE)}

# ------------------------------------------------------------------ skeleton (metres)
HIP_Z = 0.86
KNEE_Z = 0.48
ANKLE_Z = 0.14
THIGH = HIP_Z - KNEE_Z
SHIN = KNEE_Z - ANKLE_Z
LEG_X = 0.13
SHOULDER = (0.25, 0.0, 1.28)
ELBOW = (0.31, -0.02, 1.03)
WRIST = (0.34, -0.06, 0.8)

BONES = [  # name, head, tail, parent
    ('root', (0, 0, 0), (0, 0, 0.3), None),
    ('hips', (0, 0, HIP_Z), (0, 0, HIP_Z + 0.12), 'root'),
    ('spine', (0, 0, HIP_Z + 0.12), (0, 0, 1.32), 'hips'),
    ('head', (0, 0, 1.32), (0, 0, 1.75), 'spine'),
]
for side, sx in (('L', 1), ('R', -1)):
    BONES += [
        (f'thigh.{side}', (sx * LEG_X, 0, HIP_Z), (sx * LEG_X, 0, KNEE_Z), 'hips'),
        (f'shin.{side}', (sx * LEG_X, 0, KNEE_Z), (sx * LEG_X, 0, ANKLE_Z), f'thigh.{side}'),
        # arm bones hang straight down from each joint so both sides' axes mirror exactly
        (f'arm.{side}', (sx * SHOULDER[0], SHOULDER[1], SHOULDER[2]), (sx * SHOULDER[0], SHOULDER[1], ELBOW[2]), 'spine'),
        (f'forearm.{side}', (sx * ELBOW[0], ELBOW[1], ELBOW[2]), (sx * ELBOW[0], ELBOW[1], WRIST[2]), f'arm.{side}'),
    ]

arm_data = bpy.data.armatures.new('SkierRig')
rig = bpy.data.objects.new('SkierRig', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, head, tail, parent in BONES:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = head, tail
    b.roll = 0
    if parent:
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')

# ------------------------------------------------------------------ body parts
bm = bmesh.new()
deform = bm.verts.layers.deform.verify()
done = bm.verts.layers.int.new('done')  # 1 once a vertex belongs to a finished part
GROUPS = [b[0] for b in BONES]


def add(_before, bone, mat):
    """Tag every vertex not yet in a part with the bone, and its faces with the material."""
    gi = GROUPS.index(bone)
    for v in bm.verts:
        if not v[done]:
            v[deform][gi] = 1.0
    for f in bm.faces:
        if not any(v[done] for v in f.verts):
            f.material_index = MAT_INDEX[mat]
            f.smooth = mat not in ('ski', 'goggles')
    for v in bm.verts:
        v[done] = 1


def blob(center, size, bone, mat, segs=14, rings=9, rot=None):
    """A puffy ellipsoid: the cartoon building block."""
    res = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    m = Matrix.Translation(center) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1))
    bmesh.ops.transform(bm, matrix=m, verts=res['verts'])
    add(None, bone, mat)


def box(center, size, bone, mat, rot=None, bevel=0.0):
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res['verts']
    bmesh.ops.scale(bm, vec=size, verts=verts)
    if bevel:
        edges = list({e for v in verts for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, affect='EDGES')
    verts = [v for v in bm.verts if not v[done]]
    m = Matrix.Translation(center) @ (rot or Matrix.Identity(4))
    bmesh.ops.transform(bm, matrix=m, verts=verts)
    add(None, bone, mat)


def limb(a, b, r, bone, mat, segs=10):
    """A capsule-ish sausage between two points."""
    a, b = Vector(a), Vector(b)
    d = b - a
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    blob((a + b) / 2, (r, r, d.length / 2 + r * 0.6), bone, mat, segs=segs, rings=8, rot=rot)


def cylinder(a, b, r, bone, mat, segs=6):
    a, b = Vector(a), Vector(b)
    d = b - a
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=d.length)
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=res['verts'])
    add(None, bone, mat)


for side, sx in (('L', 1), ('R', -1)):
    x = sx * LEG_X
    # skis: long, thin, tips curling up at the front (-Y)
    res = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.1, 1.75, 0.035), verts=res['verts'])
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if e.verts[0] in res['verts'] and abs((e.verts[0].co - e.verts[1].co).y) > 1], cuts=6)
    for v in bm.verts:
        if not v[done] and v.co.y < -0.55:
            t = (-v.co.y - 0.55) / 0.33
            v.co.z += 0.16 * t * t
    bmesh.ops.translate(bm, vec=(x, -0.05, 0.02), verts=[v for v in bm.verts if not v[done]])
    add(None, 'root', 'ski')
    # chunky boots
    box((x, -0.02, 0.1), (0.15, 0.3, 0.17), 'root', 'pole', bevel=0.04)
    # puffy trousers
    limb((x, 0, ANKLE_Z + 0.04), (x, 0, KNEE_Z), 0.1, f'shin.{side}', 'pants')
    limb((x, 0, KNEE_Z), (x, 0, HIP_Z), 0.115, f'thigh.{side}', 'pants')
    # arms: sleeves, a mitten, a ski pole held by the mitten
    sh = (sx * SHOULDER[0], SHOULDER[1], SHOULDER[2])
    el = (sx * ELBOW[0], ELBOW[1], ELBOW[2])
    wr = (sx * WRIST[0], WRIST[1], WRIST[2])
    limb(sh, el, 0.085, f'arm.{side}', 'jacket')
    limb(el, wr, 0.075, f'forearm.{side}', 'jacket')
    blob((wr[0], wr[1] - 0.01, wr[2] - 0.05), (0.075, 0.07, 0.085), f'forearm.{side}', 'hat')
    cylinder((wr[0], wr[1], wr[2] + 0.04), (wr[0] + sx * 0.04, wr[1] + 0.12, 0.02), 0.012, f'forearm.{side}', 'pole')
    blob((wr[0] + sx * 0.035, wr[1] + 0.105, 0.12), (0.05, 0.05, 0.012), f'forearm.{side}', 'pole', segs=8, rings=4)

# a puffy jacket, a big head with a beanie, pom-pom and goggles
blob((0, 0.0, 1.05), (0.25, 0.2, 0.3), 'spine', 'jacket')
blob((0, 0.0, 0.9), (0.24, 0.19, 0.12), 'hips', 'pants')
blob((0, -0.02, 1.3), (0.16, 0.14, 0.06), 'spine', 'snow')  # scarf/collar
blob((0, -0.02, 1.55), (0.22, 0.21, 0.22), 'head', 'skin')
blob((0, 0.0, 1.63), (0.235, 0.225, 0.18), 'head', 'hat')
blob((0, 0.02, 1.85), (0.08, 0.08, 0.08), 'head', 'snow')
box((0, -0.2, 1.57), (0.34, 0.07, 0.11), 'head', 'goggles', bevel=0.03)

mesh = bpy.data.meshes.new('Skier')
bm.to_mesh(mesh)
bm.free()
for m in MATS.values():
    mesh.materials.append(m)
body = bpy.data.objects.new('Skier', mesh)
scene.collection.objects.link(body)
for g in GROUPS:
    body.vertex_groups.new(name=g)
body.parent = rig
mod = body.modifiers.new('Rig', 'ARMATURE')
mod.object = rig
mesh.calc_loop_triangles()
print('skier triangles', len(mesh.loop_triangles))

# ------------------------------------------------------------------ poses
# Sign conventions (checked): rotating a downward bone by +X swings its tail backwards (+Y),
# an upward bone by +X leans it forwards (-Y). Arms swing out sideways around Z.


def leg_angles(drop):
    """Knee bend that lowers the hips by `drop` while the boots stay put on the skis."""
    lo, hi = 0.0, 1.5
    for _ in range(40):
        t1 = (lo + hi) / 2
        t2 = math.asin(min(1.0, THIGH * math.sin(t1) / SHIN))
        h = THIGH * (1 - math.cos(t1)) + SHIN * (1 - math.cos(t2))
        lo, hi = (t1, hi) if h < drop else (lo, t1)
    return t1, t2


def pose(drop=0.0, lean=0.0, head=0.0, arm_fwd=0.0, arm_out=0.15, elbow=0.3, legs=None, roll=0.0):
    """Hips down by `drop` (m), torso forward `lean`, head tilt, arm swing/spread, elbows."""
    p = {'hips': {'loc': (0, -drop, 0), 'rot': (0, roll, 0)}}
    t1, t2 = legs if legs else leg_angles(drop)
    for side, sx in (('L', 1), ('R', -1)):
        p[f'thigh.{side}'] = {'rot': (-t1, 0, 0)}
        p[f'shin.{side}'] = {'rot': (t1 + t2, 0, 0)}
        p[f'arm.{side}'] = {'rot': (-arm_fwd, 0, -sx * arm_out)}
        p[f'forearm.{side}'] = {'rot': (-elbow, 0, 0)}
    p['spine'] = {'rot': (lean, 0, 0)}
    p['head'] = {'rot': (head - lean * 0.6, 0, 0)}
    return p


POSES = {
    # athletic stance: knees soft, chest over the boots, poles ready
    'Stance': pose(drop=0.1, lean=0.32, head=0.0, arm_fwd=0.45, arm_out=0.2, elbow=0.45),
    # loading a jump: deep knees, arms swung back
    'Crouch': pose(drop=0.3, lean=0.55, head=-0.15, arm_fwd=-0.55, arm_out=0.25, elbow=0.25),
    # racing tuck: folded right down, fists in front of the face
    'Tuck': pose(drop=0.36, lean=1.05, head=-0.55, arm_fwd=1.25, arm_out=-0.1, elbow=1.35),
    # flying: tall, arms spread for balance
    'Air': pose(drop=0.06, lean=0.12, head=0.05, arm_fwd=0.35, arm_out=1.05, elbow=0.35),
    # braking: sitting back a little, arms forward
    'Brake': pose(drop=0.18, lean=0.08, head=0.1, arm_fwd=0.8, arm_out=0.45, elbow=0.2),
    # wipeout: starfish, everything flung out
    'Tumble': pose(drop=0.08, lean=-0.35, head=0.4, arm_fwd=0.6, arm_out=2.1, elbow=0.1),
}

bpy.context.view_layer.objects.active = rig
rig.animation_data_create()
for pb in rig.pose.bones:
    pb.rotation_mode = 'XYZ'
actions = []
for name, p in POSES.items():
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    for pb in rig.pose.bones:
        spec = p.get(pb.name, {})
        pb.location = spec.get('loc', (0, 0, 0))
        pb.rotation_euler = spec.get('rot', (0, 0, 0))
        for f in (1, 2):
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_euler', frame=f)
    actions.append(act)
rig.animation_data.action = bpy.data.actions['Stance']
bpy.context.view_layer.update()

# sanity check: boots stay on the skis in every pose (the skis hang off the root)
for name in POSES:
    rig.animation_data.action = bpy.data.actions[name]
    scene.frame_set(1)
    bpy.context.view_layer.update()
    foot = rig.pose.bones['shin.L'].tail
    hand = rig.pose.bones['forearm.L'].tail
    hand_r = rig.pose.bones['forearm.R'].tail
    print(f'{name:7s} ankle ({foot.x:+.2f},{foot.y:+.2f},{foot.z:+.2f})  hand L ({hand.x:+.2f},{hand.y:+.2f},{hand.z:+.2f}) R ({hand_r.x:+.2f},{hand_r.y:+.2f},{hand_r.z:+.2f})')
rig.animation_data.action = bpy.data.actions['Stance']
scene.frame_set(1)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB', export_materials='EXPORT',
                          export_texcoords=False, export_skins=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_anim_single_armature=True,
                          export_frame_range=False, export_force_sampling=True)
print('wrote', os.path.abspath(OUT), os.path.getsize(OUT), 'bytes')
if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND))

# ------------------------------------------------------------------ preview renders
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 50
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new('W')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.8, 1.0, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 360, 420
    scene.view_settings.view_transform = 'Standard'
    for name in POSES:
        rig.animation_data.action = bpy.data.actions[name]
        scene.frame_set(1)
        for view, (loc, rot) in {'side': ((3.6, -0.6, 1.0), (math.radians(84), 0, math.radians(80))),
                                 'front': ((1.4, -3.4, 1.2), (math.radians(82), 0, math.radians(22)))}.items():
            cam.location = loc
            cam.rotation_euler = rot
            scene.render.filepath = os.path.join(os.path.abspath(PREVIEW), f'skier_{name}_{view}.png')
            bpy.ops.render.render(write_still=True)
