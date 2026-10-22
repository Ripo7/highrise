"""Run decor for the game: start gate and finish arch, in the cartoon style.

    python3 art/export_decor.py [--blend decor.blend] [--preview out.png]

Writes public/models/decor.glb with two objects:
  gate    wooden start gate with a banner and a snow load on the beam (about 10 m wide)
  arch    inflatable striped finish arch with a chequered banner (about 26 m wide)

Built facing -Y, standing on the origin, in metres. Parts are tagged by material name
(wood, banner, stripe, snow, ink, cream) and painted with theme colours in game.
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.join(HERE, '..', 'public', 'models', 'decor.glb')
BLEND = argv[argv.index('--blend') + 1] if '--blend' in argv else None
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

PALETTE = {  # Blender preview colours only; the game paints by name from theme.js
    'wood': (0.62, 0.3, 0.14), 'banner': (1.0, 0.22, 0.22), 'stripe': (0.15, 0.75, 0.85),
    'snow': (1, 0.97, 0.92), 'ink': (0.08, 0.06, 0.16), 'cream': (1, 0.9, 0.7),
}
MATS = {}
for name, col in PALETTE.items():
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*col, 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*col, 1)
    MATS[name] = m
NAMES = list(PALETTE)


class Part:
    """Accumulates primitives into one mesh, each tagged with a material."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.done = self.bm.verts.layers.int.new('done')

    def _tag(self, mat, smooth=True):
        for f in self.bm.faces:
            if not any(v[self.done] for v in f.verts):
                f.material_index = NAMES.index(mat)
                f.smooth = smooth
        for v in self.bm.verts:
            v[self.done] = 1

    def _new(self):
        return [v for v in self.bm.verts if not v[self.done]]

    def blob(self, c, size, mat, segs=12, rings=7):
        bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=1.0)
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation(c) @ Matrix.Diagonal((*size, 1)), verts=self._new())
        self._tag(mat)

    def box(self, c, size, mat, bevel=0.0, smooth=False):
        bmesh.ops.create_cube(self.bm, size=1.0)
        new = self._new()
        bmesh.ops.scale(self.bm, vec=size, verts=new)
        if bevel:
            edges = list({e for v in new for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=2, affect='EDGES')
        bmesh.ops.translate(self.bm, vec=c, verts=self._new())
        self._tag(mat, smooth)

    def cyl(self, a, b, r, mat, segs=10, r2=None):
        a, b = Vector(a), Vector(b)
        d = b - a
        bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=d.length)
        rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=self._new())
        self._tag(mat)

    def tri(self, pts, mat):
        vs = [self.bm.verts.new(p) for p in pts]
        self.bm.faces.new(vs)
        self.bm.faces.new(list(reversed([self.bm.verts.new(p) for p in pts])))
        self._tag(mat, False)

    def finish(self, location=(0, 0, 0)):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in MATS.values():
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        ob.location = location
        scene.collection.objects.link(ob)
        me.calc_loop_triangles()
        print(f'{self.name}: {len(me.loop_triangles)} triangles')
        return ob


# ------------------------------------------------------------------ start gate
g = Part('gate')
for sx in (-1, 1):
    x = sx * 4.6
    g.cyl((x, 0, 0), (x, 0, 6.2), 0.38, 'wood', segs=8)
    g.blob((x, 0, 6.45), (0.6, 0.6, 0.35), 'snow')               # snow cap on the post
    g.blob((x, 0, 0.1), (1.1, 0.9, 0.45), 'snow')                 # snow drift at the foot
    g.cyl((x, 0, 6.5), (x, 0, 8.4), 0.05, 'ink', segs=6)          # pennant pole
    g.tri([(x, 0, 8.35), (x + sx * 1.5, 0, 7.95), (x, 0, 7.55)], 'banner')
g.box((0, 0, 5.75), (10.4, 0.7, 0.7), 'wood', bevel=0.12)        # beam
g.blob((0, 0, 6.15), (5.0, 0.55, 0.35), 'snow', segs=16)          # snow load on the beam
g.box((0, -0.05, 4.65), (7.6, 0.18, 1.5), 'banner', bevel=0.08)   # START banner
for k in range(5):                                                # ink stripes on the banner
    g.box((-2.6 + k * 1.3, -0.16, 4.65), (0.42, 0.04, 1.0), 'cream')
for sx in (-1, 1):                                                # banner ties
    g.cyl((sx * 3.6, -0.05, 5.4), (sx * 3.6, -0.05, 5.0), 0.05, 'ink', segs=5)
g.finish((0, 0, 0))

# ------------------------------------------------------------------ finish arch (inflatable)
a = Part('arch')
R, TUBE, N = 12.0, 1.3, 22
for k in range(N):
    t0 = math.pi * k / N
    t1 = math.pi * (k + 1) / N
    p0 = (R * math.cos(t0), 0, R * math.sin(t0))
    p1 = (R * math.cos(t1), 0, R * math.sin(t1))
    a.cyl(p0, p1, TUBE, 'banner' if (k // 2) % 2 == 0 else 'stripe', segs=12)
    a.blob(p1, (TUBE, TUBE, TUBE), 'banner' if (k // 2) % 2 == 0 else 'stripe', segs=12, rings=8)
for sx in (-1, 1):
    a.blob((sx * R, 0, 0.3), (2.2, 2.0, 0.9), 'cream', segs=14)   # inflated feet
    a.blob((sx * R, 0, 0.0), (2.6, 2.4, 0.5), 'snow', segs=14)     # snow banked round them
# chequered banner hung under the crown
cols, rows = 10, 3
W, H = 11.0, 2.4
for i in range(cols):
    for j in range(rows):
        x = -W / 2 + W * (i + 0.5) / cols
        z = R - 2.6 - H * (j + 0.5) / rows
        a.box((x, 0, z), (W / cols, 0.2, H / rows), 'ink' if (i + j) % 2 == 0 else 'cream')
for sx in (-1, 1):
    a.cyl((sx * W / 2, 0, R - 2.6), (sx * W / 2.3, 0, R - 0.9), 0.05, 'ink', segs=5)
a.finish((0, 0, 0))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB', export_materials='EXPORT',
                          export_normals=True, export_texcoords=False)
print('wrote', os.path.abspath(OUT), os.path.getsize(OUT), 'bytes')
if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND))

if PREVIEW:
    bpy.data.objects['gate'].location = (-12, 6, 0)
    bpy.data.objects['arch'].location = (8, 14, 0)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 35
    cam.location = (2, -38, 12)
    cam.rotation_euler = (math.radians(78), 0, 0)
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new('W')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.8, 1.0, 1)
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 960, 540
    scene.view_settings.view_transform = 'Standard'
    scene.render.filepath = os.path.abspath(PREVIEW)
    bpy.ops.render.render(write_still=True)
