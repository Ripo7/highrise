"""Export the game's trees and rocks from the Geometry Nodes factory.

    python3 art/export_props.py            (Blender as a Python module: pip install bpy)
    blender -b -P art/export_props.py

Writes public/models/props.glb: objects tree_a..tree_f and rock_a..rock_e. Materials are
named snow / needles / bark / rock; the game reads only the names and paints each part with
the theme's colour bands (src/render/theme.js), so palettes change without re-exporting.

Pass --blend file.blend to also save the factory scene to open in Blender.
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from factory import make_variants  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.join(HERE, '..', 'public', 'models', 'props.glb')
BLEND = argv[argv.index('--blend') + 1] if '--blend' in argv else None

# the cartoon look (art/style_explore.py "cartoon"): only the keys the factory reads
# plus a game budget: thousands of these are on screen, so fewer facets than the renders
STYLE = dict(smooth=True, facets=7, cartoon=True, puff=0.78, blunt=0.07, tilt=0.08, tree_snow=0.1,
             blob_segments=8, blob_rings=4, tier_segments=2, rock_detail=2, rock_snow=0.42)

bpy.ops.wm.read_factory_settings(use_empty=True)
M = {}
for name, col in (('snow', (1, 0.96, 0.9)), ('needles', (0.08, 0.55, 0.42)), ('bark', (0.62, 0.3, 0.14)),
                  ('rock', (0.6, 0.46, 0.68))):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*col, 1)
    M[name] = m

trees, rocks, _, _ = make_variants(STYLE, M, 'cartoon')
scene = bpy.context.scene
for k, me in enumerate(trees + rocks):
    name = me.name.split('.')[0]   # the object name is what the game reads
    ob = bpy.data.objects.new(name, me)
    ob.location = ((k % 6) * 14, (k // 6) * 14, 0)  # laid out in a grid when opened in Blender
    scene.collection.objects.link(ob)
    me.calc_loop_triangles()
    print(f'{name}: {len(me.loop_triangles)} triangles, height {max(v.co.z for v in me.vertices):.1f} m')

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB', export_materials='EXPORT',
                          export_normals=True, export_texcoords=False, export_apply=True)
print('wrote', os.path.abspath(OUT), os.path.getsize(OUT), 'bytes')
if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND))
