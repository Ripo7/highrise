"""Highrise art direction test: one diorama slope rendered in three styles.

Run headless:  python3 art/style_explore.py <style> <out.png> [width height]
   or inside Blender:  blender -b -P art/style_explore.py -- <style> <out.png>
Styles: faceted, toy, poster

Trees and rocks come from Geometry Nodes generators (TreeFactory, RockFactory) so the same
node groups can later export the game's prop variants. Save the scene with --save file.blend
to open it in Blender and tweak the generator inputs by hand.
"""
import math
import random
import sys

import bpy
import bmesh
from mathutils import Vector, noise

# ---------------------------------------------------------------- args
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
STYLE = argv[0] if argv else 'faceted'
OUT = argv[1] if len(argv) > 1 else f'/tmp/{STYLE}.png'
RES = (int(argv[2]), int(argv[3])) if len(argv) > 3 else (1280, 800)
SAVE = argv[argv.index('--save') + 1] if '--save' in argv else None
SHOT = argv[argv.index('--shot') + 1] if '--shot' in argv else 'wide'   # wide | ride

# ---------------------------------------------------------------- styles
STYLES = {
    # clean low poly, flat facets, low warm sun, blue shadows
    'faceted': dict(
        smooth=False, facets=6, cell=2.5, toon=False,
        sun_elev=14, sun_az=-62, sun_color=(1.0, 0.74, 0.5), sun_strength=7.5, sun_angle=1.5,
        sky_top=(0.2, 0.26, 0.55), sky_horizon=(0.98, 0.62, 0.42), sky_strength=0.65, exposure=0.0, tree_snow=0.2,
        snow=(0.93, 0.95, 1.0), rock=(0.36, 0.33, 0.36), needles=(0.07, 0.24, 0.22), bark=(0.25, 0.13, 0.08),
        strata=[(0.42, 0.26, 0.2), (0.55, 0.36, 0.26), (0.33, 0.2, 0.17), (0.5, 0.3, 0.22)],
        jacket=(0.95, 0.25, 0.08), pants=(0.08, 0.1, 0.2), flag=(0.95, 0.15, 0.1),
        lens=38, dof=False, outline=False, look='AgX - Medium High Contrast',
    ),
    # rounded toy pieces, pastel, soft light, tilt-shift miniature
    'toy': dict(
        smooth=True, facets=18, cell=1.6, toon=False,
        sun_elev=40, sun_az=-35, sun_color=(1.0, 0.9, 0.78), sun_strength=2.6, sun_angle=12,
        sky_top=(0.62, 0.78, 1.0), sky_horizon=(1.0, 0.82, 0.76), sky_strength=0.55, exposure=-0.2, tree_snow=0.16,
        snow=(0.95, 0.93, 0.96), rock=(0.62, 0.52, 0.74), needles=(0.25, 0.75, 0.55), bark=(0.85, 0.5, 0.32),
        strata=[(0.95, 0.55, 0.45), (0.99, 0.78, 0.55), (0.8, 0.45, 0.5), (0.98, 0.66, 0.5)],
        jacket=(1.0, 0.45, 0.4), pants=(0.32, 0.4, 0.75), flag=(1.0, 0.75, 0.25),
        lens=70, dof=True, outline=False, look='None',
    ),
    # flat graphic colour bands, hard shadows, ink outlines
    # A x C: faceted low poly and a low golden sun, drawn as flat colour bands with ink lines
    'mix_warm': dict(
        smooth=False, facets=6, cell=2.5, toon=True, bands=3, cuts=(0.3, 0.74),
        sun_elev=14, sun_az=-62, sun_color=(1.0, 0.86, 0.68), sun_strength=5.0, sun_angle=0.3,
        sky_top=(0.27, 0.3, 0.6), sky_horizon=(1.0, 0.66, 0.42), sky_strength=0.3, exposure=0.0, tree_snow=0.2,
        snow=(1.0, 0.94, 0.84), shadow_snow=(0.48, 0.5, 0.8), rock=(0.42, 0.33, 0.4), needles=(0.1, 0.32, 0.3),
        bark=(0.32, 0.16, 0.1),
        strata=[(0.42, 0.24, 0.22), (0.72, 0.4, 0.27), (0.3, 0.18, 0.2), (0.62, 0.32, 0.24)],
        jacket=(0.98, 0.32, 0.1), pants=(0.1, 0.12, 0.26), flag=(0.98, 0.3, 0.12),
        lens=38, dof=False, outline=True, ink=(0.12, 0.08, 0.18), crease=True, look='None',
    ),
    'mix_ink': dict(
        smooth=False, facets=6, cell=2.5, toon=True, bands=3, cuts=(0.3, 0.74),
        sun_elev=14, sun_az=-62, sun_color=(1, 0.95, 0.88), sun_strength=5.0, sun_angle=0.3,
        sky_top=(0.93, 0.3, 0.32), sky_horizon=(1.0, 0.72, 0.38), sky_strength=0.3, exposure=0.0, tree_snow=0.22,
        snow=(0.99, 0.95, 0.86), shadow_snow=(0.36, 0.42, 0.78), rock=(0.22, 0.2, 0.36), needles=(0.09, 0.14, 0.3),
        bark=(0.09, 0.14, 0.3),
        strata=[(0.2, 0.18, 0.32), (0.93, 0.3, 0.32), (0.2, 0.18, 0.32), (0.98, 0.58, 0.3)],
        jacket=(0.98, 0.82, 0.15), pants=(0.07, 0.12, 0.27), flag=(0.93, 0.3, 0.32),
        lens=38, dof=False, outline=True, ink=(0.05, 0.06, 0.16), crease=True, look='None',
    ),
    # A x C pushed to cartoon: chunky shapes, snow blobs, icing over the block edge, thick ink
    'cartoon': dict(
        smooth=True, facets=10, cell=2.0, toon=True, bands=3, cuts=(0.3, 0.74), cartoon=True,
        puff=0.78, blunt=0.07, tilt=0.08, icing=True, line=2.8,
        sun_elev=16, sun_az=-62, sun_color=(1.0, 0.88, 0.7), sun_strength=5.0, sun_angle=0.3,
        sky_top=(0.32, 0.42, 0.95), sky_horizon=(1.0, 0.72, 0.45), sky_strength=0.3, exposure=0.0, tree_snow=0.1,
        snow=(1.0, 0.96, 0.88), shadow_snow=(0.46, 0.55, 0.98), rock=(0.6, 0.46, 0.68), needles=(0.08, 0.55, 0.42),
        bark=(0.62, 0.3, 0.14),
        strata=[(0.85, 0.42, 0.28), (0.99, 0.66, 0.32), (0.7, 0.3, 0.32), (0.97, 0.52, 0.3)],
        jacket=(1.0, 0.28, 0.12), pants=(0.14, 0.22, 0.62), flag=(1.0, 0.22, 0.22), hat=(0.15, 0.75, 0.85),
        lens=38, dof=False, outline=True, ink=(0.14, 0.08, 0.24), crease=False, look='None',
    ),
    'cartoon_ink': dict(
        smooth=True, facets=10, cell=2.0, toon=True, bands=3, cuts=(0.3, 0.74), cartoon=True,
        puff=0.78, blunt=0.07, tilt=0.08, icing=True, line=2.8,
        sun_elev=16, sun_az=-62, sun_color=(1, 0.95, 0.88), sun_strength=5.0, sun_angle=0.3,
        sky_top=(0.96, 0.3, 0.4), sky_horizon=(1.0, 0.76, 0.36), sky_strength=0.3, exposure=0.0, tree_snow=0.1,
        snow=(1.0, 0.96, 0.86), shadow_snow=(0.4, 0.46, 0.92), rock=(0.3, 0.26, 0.5), needles=(0.1, 0.2, 0.48),
        bark=(0.1, 0.2, 0.48),
        strata=[(0.24, 0.2, 0.42), (0.98, 0.34, 0.38), (0.24, 0.2, 0.42), (1.0, 0.62, 0.3)],
        jacket=(1.0, 0.84, 0.12), pants=(0.1, 0.18, 0.42), flag=(0.98, 0.32, 0.38), hat=(0.98, 0.32, 0.38),
        lens=38, dof=False, outline=True, ink=(0.06, 0.06, 0.2), crease=False, look='None',
    ),
    'poster': dict(
        smooth=True, facets=8, cell=2.2, toon=True,
        sun_elev=24, sun_az=-75, sun_color=(1, 1, 1), sun_strength=4.0, sun_angle=0.2, exposure=0.0, tree_snow=0.22,
        sky_top=(0.93, 0.3, 0.32), sky_horizon=(1.0, 0.72, 0.38), sky_strength=0.25,
        snow=(0.98, 0.95, 0.88), rock=(0.2, 0.18, 0.32), needles=(0.07, 0.12, 0.27), bark=(0.07, 0.12, 0.27),
        strata=[(0.2, 0.18, 0.32), (0.93, 0.3, 0.32), (0.2, 0.18, 0.32), (0.98, 0.58, 0.3)],
        jacket=(0.98, 0.82, 0.15), pants=(0.07, 0.12, 0.27), flag=(0.93, 0.3, 0.32),
        shadow_snow=(0.36, 0.42, 0.78),
        lens=40, dof=False, outline=True, look='None',
    ),
}
S = STYLES[STYLE]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
random.seed(7)

# ---------------------------------------------------------------- materials
def mat_principled(name, color, rough=0.8, sss=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    if sss:
        b.inputs['Subsurface Weight'].default_value = sss
        b.inputs['Subsurface Radius'].default_value = (0.6, 0.8, 1.0)
        b.inputs['Subsurface Scale'].default_value = 0.4
    return m


def toon_bands(lit, shadow=None):
    """Colour bands from dark to light as (position, colour)."""
    if shadow is None:
        shadow = tuple(c * 0.45 for c in lit)
    if S.get('bands', 2) == 3:
        mid = tuple(a * 0.5 + b * 0.5 for a, b in zip(lit, shadow))
        mid = tuple(min(1.0, m * 1.08) for m in mid)
        return [(0.0, shadow), (S['cuts'][0], mid), (S['cuts'][1], lit)]
    return [(0.0, shadow), (0.5, lit)]


def fill_ramp(ramp, bands):
    els = ramp.color_ramp.elements
    ramp.color_ramp.interpolation = 'CONSTANT'
    while len(els) < len(bands):
        els.new(0.99)
    for e, (pos, col) in zip(els, bands):
        e.position = pos
        e.color = (*col, 1)


def mat_toon(name, lit, shadow=None):
    """Flat colour bands: the lit colour, and shadow (and mid) colours where light is low."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    diff = nt.nodes.new('ShaderNodeBsdfDiffuse')
    s2r = nt.nodes.new('ShaderNodeShaderToRGB')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    fill_ramp(ramp, toon_bands(lit, shadow))
    m['bands'] = [list(c) for _, c in toon_bands(lit, shadow)]
    em = nt.nodes.new('ShaderNodeEmission')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(diff.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs['Color'], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], em.inputs[0])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def mat(name, color, **kw):
    if S['toon']:
        return mat_toon(name, color, kw.get('shadow'))
    return mat_principled(name, color, kw.get('rough', 0.8), kw.get('sss', 0.0))


M_SNOW = mat('Snow', S['snow'], rough=0.55, sss=0.25 if STYLE == 'toy' else 0.0, shadow=S.get('shadow_snow'))
M_ROCK = mat('Rock', S['rock'], rough=0.9)
M_NEEDLES = mat('Needles', S['needles'], rough=0.85)
M_BARK = mat('Bark', S['bark'], rough=0.9)
M_JACKET = mat('Jacket', S['jacket'], rough=0.5)
M_PANTS = mat('Pants', S['pants'], rough=0.7)
M_FLAG = mat('Flag', S['flag'], rough=0.6)
M_HAT = mat('Hat', S.get('hat', S['flag']), rough=0.7)
M_INK = mat('Goggles', (0.06, 0.06, 0.12), rough=0.3)
M_STRATA = [mat(f'Strata{i}', c, rough=0.9) for i, c in enumerate(S['strata'])]

# terrain: snow with rock showing on steep faces
def terrain_material():
    m = bpy.data.materials.new('Terrain')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')  # normal.z -> rock amount
    ramp.color_ramp.interpolation = 'CONSTANT' if S['toon'] or not S['smooth'] else 'LINEAR'
    ramp.color_ramp.elements[0].position = 0.62
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(geo.outputs['Normal'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], ramp.inputs[0])
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    # reuse the snow and rock shaders by copying their node setups through a mix shader
    def shader_of(src):
        # rebuild the core of a material inside this tree
        if S['toon']:
            d = nt.nodes.new('ShaderNodeBsdfDiffuse')
            s2r = nt.nodes.new('ShaderNodeShaderToRGB')
            r = nt.nodes.new('ShaderNodeValToRGB')
            src_r = src.node_tree.nodes['Color Ramp'].color_ramp
            fill_ramp(r, [(e.position, tuple(e.color[:3])) for e in src_r.elements])
            e = nt.nodes.new('ShaderNodeEmission')
            nt.links.new(d.outputs[0], s2r.inputs[0])
            nt.links.new(s2r.outputs['Color'], r.inputs[0])
            nt.links.new(r.outputs[0], e.inputs[0])
            return e.outputs[0]
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        sb = src.node_tree.nodes['Principled BSDF']
        for k in ('Base Color', 'Roughness', 'Subsurface Weight', 'Subsurface Radius', 'Subsurface Scale'):
            b.inputs[k].default_value = sb.inputs[k].default_value
        return b.outputs[0]
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(ramp.outputs[0], mix.inputs[0])
    # ramp is white on flat ground: factor 1 -> second input (snow), 0 -> rock on steep faces
    nt.links.new(shader_of(M_ROCK), mix.inputs[1])
    nt.links.new(shader_of(M_SNOW), mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return m


M_TERRAIN = terrain_material()

# ---------------------------------------------------------------- geometry nodes helpers
class G:
    """Tiny builder so node graphs read top-down."""

    def __init__(self, name):
        self.nt = bpy.data.node_groups.new(name, 'GeometryNodeTree')
        self.nt.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
        self.inp = self.nt.nodes.new('NodeGroupInput')
        self.out = self.nt.nodes.new('NodeGroupOutput')

    def param(self, name, kind, default, lo=None, hi=None):
        s = self.nt.interface.new_socket(name, in_out='INPUT', socket_type=kind)
        s.default_value = default
        if lo is not None:
            s.min_value = lo
        if hi is not None:
            s.max_value = hi
        return self.inp.outputs[name]

    def node(self, kind, inputs=None, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        for k, v in (inputs or {}).items():
            if hasattr(v, 'links'):  # a socket
                self.nt.links.new(v, n.inputs[k])
            else:
                n.inputs[k].default_value = v
        return n

    def math(self, op, a, b=None, c=None):
        n = self.nt.nodes.new('ShaderNodeMath')
        n.operation = op
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if hasattr(v, 'links'):
                self.nt.links.new(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        return n.outputs[0]

    def finish(self, geo):
        self.nt.links.new(geo, self.out.inputs[0])
        return self.nt


def tree_factory():
    """A fir as stacked cone tiers. Snow covers the top of each tier; Snow sets how much."""
    g = G('TreeFactory')
    seed = g.param('Seed', 'NodeSocketInt', 0)
    height = g.param('Height', 'NodeSocketFloat', 10.0, 2, 40)
    layers = g.param('Layers', 'NodeSocketInt', 4, 2, 9)
    width = g.param('Width', 'NodeSocketFloat', 0.36, 0.1, 1.0)
    snow = g.param('Snow', 'NodeSocketFloat', 0.35, 0, 1)
    facets = g.param('Facets', 'NodeSocketInt', S['facets'], 3, 32)
    smooth = g.param('Smooth', 'NodeSocketBool', S['smooth'])

    trunk_h = g.math('MULTIPLY', height, 0.18)
    canopy = g.math('SUBTRACT', height, trunk_h)
    tier_h = g.math('DIVIDE', g.math('MULTIPLY', canopy, 1.9), layers)   # tiers overlap
    step = g.math('DIVIDE', g.math('SUBTRACT', canopy, g.math('MULTIPLY', tier_h, 0.5)), g.math('SUBTRACT', layers, 1))

    # one tier: a cone centred on its own origin; faces above the snow line get the Snow material
    cone = g.node('GeometryNodeMeshCone', {'Vertices': facets, 'Side Segments': 3, 'Radius Top': S.get('blunt', 0.0),
                                           'Radius Bottom': 1.0, 'Depth': 1.0}, fill_type='NGON')
    pos = g.node('GeometryNodeInputPosition')
    pz = g.node('ShaderNodeSeparateXYZ', {'Vector': pos.outputs[0]})
    jitter = g.node('FunctionNodeRandomValue', {'Min': -0.12, 'Max': 0.12, 'Seed': seed}, data_type='FLOAT')
    snow_line = g.math('ADD', g.math('SUBTRACT', 0.5, snow), jitter.outputs[0])
    is_snow = g.math('GREATER_THAN', pz.outputs['Z'], snow_line)
    m_needles = g.node('GeometryNodeSetMaterial', {'Geometry': cone.outputs['Mesh'], 'Material': M_NEEDLES})
    m_snow = g.node('GeometryNodeSetMaterial', {'Geometry': m_needles.outputs[0], 'Selection': is_snow, 'Material': M_SNOW})

    # tier positions up the trunk
    line = g.node('GeometryNodeMeshLine', {'Count': layers}, mode='OFFSET')
    base = g.node('ShaderNodeCombineXYZ', {'Z': g.math('ADD', trunk_h, g.math('MULTIPLY', tier_h, 0.5))})
    off = g.node('ShaderNodeCombineXYZ', {'Z': step})
    g.nt.links.new(base.outputs[0], line.inputs['Start Location'])
    g.nt.links.new(off.outputs[0], line.inputs['Offset'])

    idx = g.node('GeometryNodeInputIndex')
    t = g.math('DIVIDE', idx.outputs[0], g.math('MAXIMUM', g.math('SUBTRACT', layers, 1), 1))
    wobble = g.node('FunctionNodeRandomValue', {'Min': 0.88, 'Max': 1.1, 'Seed': g.math('ADD', seed, 11)}, data_type='FLOAT')
    radius = g.math('MULTIPLY', g.math('MULTIPLY', g.math('MULTIPLY', canopy, width), g.math('SUBTRACT', 1.0, g.math('MULTIPLY', t, 0.72))), wobble.outputs[0])
    scale = g.node('ShaderNodeCombineXYZ', {'X': radius, 'Y': radius, 'Z': tier_h})
    tilt = S.get('tilt', 0.0)
    spin = g.node('FunctionNodeRandomValue', {'Min': (-tilt, -tilt, 0), 'Max': (tilt, tilt, 6.283), 'Seed': g.math('ADD', seed, 23)}, data_type='FLOAT_VECTOR')
    rot = g.node('FunctionNodeEulerToRotation', {'Euler': spin.outputs[0]})
    tiers = g.node('GeometryNodeInstanceOnPoints', {'Points': line.outputs[0], 'Instance': m_snow.outputs[0],
                                                    'Rotation': rot.outputs[0], 'Scale': scale.outputs[0]})
    tiers_r = g.node('GeometryNodeRealizeInstances', {'Geometry': tiers.outputs[0]})
    blobs_r = None
    if S.get('puff'):
        # a pillow of snow resting on every tier, poking out past the branches
        puff = g.param('Puff', 'NodeSocketFloat', S['puff'], 0, 1.5)
        ball = g.node('GeometryNodeMeshUVSphere', {'Segments': 16, 'Rings': 8, 'Radius': 1.0})
        ball_m = g.node('GeometryNodeSetMaterial', {'Geometry': ball.outputs['Mesh'], 'Material': M_SNOW})
        bscale = g.node('ShaderNodeCombineXYZ', {'X': g.math('MULTIPLY', radius, puff), 'Y': g.math('MULTIPLY', radius, puff),
                                                 'Z': g.math('MULTIPLY', tier_h, 0.3)})
        blobs = g.node('GeometryNodeInstanceOnPoints', {'Points': line.outputs[0], 'Instance': ball_m.outputs[0],
                                                        'Rotation': rot.outputs[0], 'Scale': bscale.outputs[0]})
        blobs_r = g.node('GeometryNodeRealizeInstances', {'Geometry': blobs.outputs[0]})

    trunk = g.node('GeometryNodeMeshCylinder', {'Vertices': g.math('MAXIMUM', g.math('FLOOR', g.math('MULTIPLY', facets, 0.6)), 4),
                                                'Radius': g.math('MULTIPLY', height, 0.055 if S.get('cartoon') else 0.035), 'Depth': g.math('MULTIPLY', trunk_h, 1.6)})
    trunk_up = g.node('GeometryNodeTransform', {'Geometry': trunk.outputs['Mesh'],
                                                'Translation': g.node('ShaderNodeCombineXYZ', {'Z': g.math('MULTIPLY', trunk_h, 0.8)}).outputs[0]})
    trunk_m = g.node('GeometryNodeSetMaterial', {'Geometry': trunk_up.outputs[0], 'Material': M_BARK})
    join = g.node('GeometryNodeJoinGeometry')
    g.nt.links.new(trunk_m.outputs[0], join.inputs[0])
    g.nt.links.new(tiers_r.outputs[0], join.inputs[0])
    if blobs_r:
        g.nt.links.new(blobs_r.outputs[0], join.inputs[0])
    sm = g.node('GeometryNodeSetShadeSmooth', {'Geometry': join.outputs[0], 'Shade Smooth': smooth})
    return g.finish(sm.outputs[0])


def rock_factory():
    """A boulder: an ico sphere pushed around by noise, squashed, snow on the upward faces."""
    g = G('RockFactory')
    seed = g.param('Seed', 'NodeSocketFloat', 0.0)
    size = g.param('Size', 'NodeSocketFloat', 2.0, 0.2, 20)
    rough = g.param('Roughness', 'NodeSocketFloat', 0.45, 0, 1.5)
    detail = g.param('Detail', 'NodeSocketInt', 2 if not S['smooth'] else 3, 1, 5)
    snow = g.param('Snow', 'NodeSocketFloat', 0.55, 0, 1)
    smooth = g.param('Smooth', 'NodeSocketBool', S['smooth'])

    ico = g.node('GeometryNodeMeshIcoSphere', {'Radius': 1.0, 'Subdivisions': detail})
    pos = g.node('GeometryNodeInputPosition')
    nz = g.node('ShaderNodeTexNoise', {'Vector': pos.outputs[0], 'W': seed, 'Scale': 0.9, 'Detail': 1.0}, noise_dimensions='4D')
    centred = g.node('ShaderNodeVectorMath', {0: nz.outputs['Color'], 1: (-0.5, -0.5, -0.5)}, operation='ADD')
    push = g.node('ShaderNodeVectorMath', {0: centred.outputs[0], 3: rough}, operation='SCALE')
    sp = g.node('GeometryNodeSetPosition', {'Geometry': ico.outputs['Mesh'], 'Offset': push.outputs[0]})
    squash = g.node('ShaderNodeCombineXYZ', {'X': g.math('MULTIPLY', size, 1.25), 'Y': size, 'Z': g.math('MULTIPLY', size, 0.62)})
    tr = g.node('GeometryNodeTransform', {'Geometry': sp.outputs[0], 'Scale': squash.outputs[0],
                                          'Translation': g.node('ShaderNodeCombineXYZ', {'Z': g.math('MULTIPLY', size, 0.25)}).outputs[0]})
    m_rock = g.node('GeometryNodeSetMaterial', {'Geometry': tr.outputs[0], 'Material': M_ROCK})
    nrm = g.node('GeometryNodeInputNormal')
    nzc = g.node('ShaderNodeSeparateXYZ', {'Vector': nrm.outputs[0]})
    is_snow = g.math('GREATER_THAN', nzc.outputs['Z'], g.math('SUBTRACT', 1.0, snow))
    m_snow = g.node('GeometryNodeSetMaterial', {'Geometry': m_rock.outputs[0], 'Selection': is_snow, 'Material': M_SNOW})
    sm = g.node('GeometryNodeSetShadeSmooth', {'Geometry': m_snow.outputs[0], 'Shade Smooth': smooth})
    return g.finish(sm.outputs[0])


TREE_NG = tree_factory()
ROCK_NG = rock_factory()


def factory_object(name, ng, **inputs):
    """An object whose geometry is the generator's output, with the given inputs."""
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    mod = ob.modifiers.new('Factory', 'NODES')
    mod.node_group = ng
    for item in ng.interface.items_tree:
        if item.item_type == 'SOCKET' and item.in_out == 'INPUT' and item.name in inputs:
            val = inputs[item.name]
            if hasattr(mod, 'properties'):      # Blender 5.x
                getattr(mod.properties.inputs, item.identifier).value = val
            else:                               # Blender 4.x
                mod[item.identifier] = val
    return ob


def bake(ob):
    """Freeze a generator object into a plain mesh (what the glTF export does too)."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    me.name = ob.name
    bpy.data.objects.remove(ob)
    return me


# prop variants, like the set the game would load
factory_coll = bpy.data.collections.new('Factory')
scene.collection.children.link(factory_coll)
tree_meshes = []
for i in range(6):
    ob = factory_object(f'tree_{chr(97 + i)}', TREE_NG, Seed=i * 7 + 1,
                        Height=(7.5 + (i % 3) * 1.6) if S.get('cartoon') else 9 + (i % 3) * 2.5,
                        Layers=(3 + (i % 2)) if S.get('cartoon') else 3 + (i % 3) + (1 if STYLE == 'faceted' else 0),
                        Width=(0.56 + 0.06 * (i % 2)) if S.get('cartoon') else 0.34 + 0.04 * (i % 2),
                        Snow=S['tree_snow'] + 0.05 * (i % 3))
    tree_meshes.append(bake(ob))
rock_meshes = []
for i in range(5):
    ob = factory_object(f'rock_{chr(97 + i)}', ROCK_NG, Seed=i * 3.7 + 0.5, Size=1.0,
                        Roughness=(0.18 + 0.04 * i) if S.get('cartoon') else 0.4 + 0.08 * i,
                        Snow=0.75 if S.get('cartoon') else 0.55)
    rock_meshes.append(bake(ob))

# ---------------------------------------------------------------- the slope block
W, L = 130.0, 190.0          # across, along the fall line
SLOPE = 0.46                 # ~25 degrees
BASE = -L / 2 * SLOPE - 26   # bottom of the diorama block


def kicker(x, y):
    """A jump in the centre lane at y = 8 (riders go towards -y)."""
    across = max(0.0, 1 - (abs(x) / 9) ** 4)
    u = (y - 8) / 9  # 0 at the lip, 1 at the back
    if -0.1 < u < 1.0:
        prof = math.sin(max(0.0, min(1.0, 1 - u)) * math.pi / 2) ** 1.5 if u > 0 else max(0.0, 1 + u * 10)
        return 3.4 * prof * across
    return 0.0


def height(x, y):
    h = y * SLOPE
    h += 5.0 * noise.noise(Vector((x / 55, y / 55, 0.3)))
    h += 1.6 * noise.noise(Vector((x / 18, y / 18, 1.7)))
    h += 9.0 * (x / (W / 2)) ** 2            # dish: edges a bit higher
    h += 6.0 * math.exp(-((y + 40) / 16) ** 2) * (1 - (x / (W / 2)) ** 2)  # a roller
    h -= 4.0 * math.exp(-((y - 50) / 10) ** 2)                            # a dip
    return h + kicker(x, y)


def slope_block():
    bm = bmesh.new()
    nx, ny = int(W / S['cell']), int(L / S['cell'])
    grid = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            x = -W / 2 + W * i / nx
            y = -L / 2 + L * j / ny
            row.append(bm.verts.new((x, y, height(x, y))))
        grid.append(row)
    top = []
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            f.material_index = 0
            top.append(f)
    # skirt: walk the rim and drop each edge to the base; side faces get strata
    rim = ([grid[0][i] for i in range(nx + 1)] + [grid[j][nx] for j in range(1, ny + 1)]
           + [grid[ny][i] for i in range(nx - 1, -1, -1)] + [grid[j][0] for j in range(ny - 1, 0, -1)])
    low = [bm.verts.new((v.co.x, v.co.y, BASE)) for v in rim]
    n = len(rim)
    upper = rim
    if S.get('icing'):
        # a band of snow hangs over the edge with a wavy, drippy bottom
        drip = []
        for k, v in enumerate(rim):
            d = 4.5 + 1.6 * math.sin(k * 0.21) + 5.0 * max(0.0, math.sin(k * 0.73 + 1.0)) ** 6
            drip.append(bm.verts.new((v.co.x, v.co.y, v.co.z - d)))
        for k in range(n):
            f = bm.faces.new((rim[(k + 1) % n], rim[k], drip[k], drip[(k + 1) % n]))
            f.material_index = 2
        upper = drip
    for k in range(n):
        a, b = upper[k], upper[(k + 1) % n]
        la, lb = low[k], low[(k + 1) % n]
        f = bm.faces.new((b, a, la, lb))
        f.material_index = 1
    bm.faces.new(list(reversed(low))).material_index = 1
    bm.normal_update()
    me = bpy.data.meshes.new('Slope')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M_TERRAIN)
    me.materials.append(strata_material())
    me.materials.append(M_SNOW)
    for p in me.polygons:
        p.use_smooth = S['smooth'] and p.material_index in (0, 2)
    ob = bpy.data.objects.new('Slope', me)
    scene.collection.objects.link(ob)
    return ob


def strata_material():
    """Horizontal bands on the block's sides, from the strata colours."""
    if S['toon']:
        m = bpy.data.materials.new('Sides')
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
    else:
        m = bpy.data.materials.new('Sides')
        m.use_nodes = True
        nt = m.node_tree
    tex = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    wave = nt.nodes.new('ShaderNodeMath')
    wave.operation = 'WRAP'
    wave.inputs[1].default_value = 0.0
    wave.inputs[2].default_value = 22.0
    div = nt.nodes.new('ShaderNodeMath')
    div.operation = 'DIVIDE'
    div.inputs[1].default_value = 22.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    cols = S['strata']
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = (*cols[0], 1)
    els[1].position = 0.38
    els[1].color = (*cols[1], 1)
    for pos, c in ((0.55, cols[2]), (0.8, cols[3])):
        e = els.new(pos)
        e.color = (*c, 1)
    nt.links.new(tex.outputs['Object'], sep.inputs[0])
    # tilt the bands a touch so they read as rock layers
    tilt = nt.nodes.new('ShaderNodeMath')
    tilt.operation = 'MULTIPLY_ADD'
    tilt.inputs[1].default_value = 0.06
    nt.links.new(sep.outputs['X'], tilt.inputs[0])
    nt.links.new(sep.outputs['Z'], tilt.inputs[2])
    nt.links.new(tilt.outputs[0], wave.inputs[0])
    nt.links.new(wave.outputs[0], div.inputs[0])
    nt.links.new(div.outputs[0], ramp.inputs[0])
    if S['toon']:
        e = nt.nodes.new('ShaderNodeEmission')
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        # sides facing away from the sun drop to the darkest band colour
        d = nt.nodes.new('ShaderNodeBsdfDiffuse')
        s2r = nt.nodes.new('ShaderNodeShaderToRGB')
        lr = nt.nodes.new('ShaderNodeValToRGB')
        lr.color_ramp.interpolation = 'CONSTANT'
        lr.color_ramp.elements[1].position = 0.5
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        nt.links.new(d.outputs[0], s2r.inputs[0])
        nt.links.new(s2r.outputs['Color'], lr.inputs[0])
        lr.color_ramp.elements[0].color = (0.55, 0.55, 0.7, 1)
        nt.links.new(lr.outputs[0], mix.inputs['Factor'])
        mix.inputs['Factor'].default_value = 1.0
        nt.links.new(ramp.outputs[0], mix.inputs[6])
        nt.links.new(lr.outputs[0], mix.inputs[7])
        nt.links.new(mix.outputs[2], e.inputs[0])
        nt.links.new(e.outputs[0], out.inputs[0])
    else:
        b = nt.nodes['Principled BSDF']
        b.inputs['Roughness'].default_value = 0.9
        nt.links.new(ramp.outputs[0], b.inputs['Base Color'])
    return m


slope = slope_block()

# ---------------------------------------------------------------- props on the slope
props = bpy.data.collections.new('Props')
scene.collection.children.link(props)


rng = random.Random(3)


def place(me, x, y, s, rz, sink=0.3):
    ob = bpy.data.objects.new(me.name + '.inst', me)
    ob.location = (x, y, height(x, y) - sink * s)
    lean = S.get('tilt', 0.0) * 0.6
    ob.rotation_euler = (rng.uniform(-lean, lean), rng.uniform(-lean, lean), rz)
    ob.scale = (s, s, s)
    props.objects.link(ob)
    return ob


trees = 0
for _ in range(2600):
    x = rng.uniform(-W / 2 + 2, W / 2 - 2)
    y = rng.uniform(-L / 2 + 2, L / 2 - 2)
    edge = (abs(x) - 18) / (W / 2 - 18)       # 0 at the lane edge, 1 at the block edge
    if edge <= 0:
        continue
    clump = noise.noise(Vector((x / 22, y / 22, 4.2))) * 0.5 + 0.5
    if rng.random() > (edge ** 1.4) * 0.55 + clump * 0.35 - 0.15:
        continue
    if abs(x) < 26 and abs(y - 8) < 16:
        continue
    place(rng.choice(tree_meshes), x, y, rng.uniform(0.75, 1.25), rng.uniform(0, 6.3))
    trees += 1
    if trees > 260:
        break
for _ in range(16):
    x = rng.choice((-1, 1)) * rng.uniform(14, W / 2 - 6)
    y = rng.uniform(-L / 2 + 6, L / 2 - 6)
    place(rng.choice(rock_meshes), x, y, rng.uniform(1.2, 3.4), rng.uniform(0, 6.3), sink=0.25)
# a couple of rocks the rider can jump
place(rock_meshes[0], -6, -28, 1.4, 0.4)
place(rock_meshes[2], 10, 40, 2.6, 1.3)

# slalom-style flags down the lane
for k, (x, y) in enumerate(((-13, 44), (12, -14), (-12, -56))):
    z = height(x, y)
    pole = bpy.data.meshes.new('pole')
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.08, radius2=0.08, depth=3.2)
    bmesh.ops.translate(bm, vec=(0, 0, 1.6), verts=bm.verts)
    bm.to_mesh(pole)
    bm.free()
    pole.materials.append(M_PANTS)
    po = bpy.data.objects.new('pole', pole)
    po.location = (x, y, z)
    props.objects.link(po)
    fl = bpy.data.meshes.new('flag')
    fl.from_pydata([(0, 0, 3.1), (1.4, 0.1, 2.75), (0, 0, 2.3)], [], [(0, 1, 2)])
    fl.materials.append(M_FLAG)
    fo = bpy.data.objects.new('flag', fl)
    fo.location = (x, y, z)
    fo.rotation_euler = (0, 0, math.radians(200 if x < 0 else -20))
    props.objects.link(fo)


# ---------------------------------------------------------------- the skier
def box(name, size, loc, m, rot=(0, 0, 0), parent=None, bevel=0.0):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=bevel, segments=3, affect='EDGES')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    if S['smooth']:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = rot
    ob.parent = parent
    scene.collection.objects.link(ob)
    return ob


def ball(name, r, loc, m, parent):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=r)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.parent = parent
    scene.collection.objects.link(ob)
    return ob


from mathutils import Matrix
sx, sy = 3.0, 27.0           # above the kicker, heading down (-y) towards it
rig = bpy.data.objects.new('Skier', None)
# the rig's forward is +y: turn to face downhill with a little carve, roll into the turn, sit on the slope
R = (Matrix.Rotation(math.atan(SLOPE), 4, 'X') @ Matrix.Rotation(math.radians(192), 4, 'Z')
     @ Matrix.Rotation(math.radians(-14), 4, 'Y'))
SK_SCALE = (1.0 if SHOT == 'ride' else 1.5) * (1.12 if S.get('cartoon') else 1.0)   # a touch heroic in the wide shot so he reads
rig.matrix_world = Matrix.Translation((sx, sy, height(sx, sy))) @ R @ Matrix.Scale(SK_SCALE, 4)
scene.collection.objects.link(rig)
bev = 0.04 if S['smooth'] else 0.0
for side in (-1, 1):
    box('ski', (0.12, 1.9, 0.04), (side * 0.16, 0.05, 0.03), M_FLAG if STYLE != 'poster' else M_JACKET, parent=rig, bevel=0.015 if bev else 0)
    box('leg', (0.16, 0.2, 0.62), (side * 0.15, -0.05, 0.4), M_PANTS, rot=(math.radians(-25), 0, 0), parent=rig, bevel=bev)
if S.get('cartoon'):
    box('torso', (0.56, 0.42, 0.62), (0, 0.12, 0.98), M_JACKET, rot=(math.radians(-24), 0, 0), parent=rig, bevel=0.14)
    ball('head', 0.3, (0, 0.34, 1.62), M_SNOW, rig)
    hat = ball('hat', 0.31, (0, 0.32, 1.7), M_HAT, rig)
    hat.scale = (1, 1, 0.78)
    ball('pompom', 0.12, (0, 0.28, 2.0), M_SNOW, rig)
    box('goggles', (0.5, 0.12, 0.16), (0, 0.6, 1.6), M_INK, parent=rig, bevel=0.05)
    for side in (-1, 1):
        box('arm', (0.16, 0.5, 0.16), (side * 0.38, 0.32, 0.98), M_JACKET, rot=(math.radians(-20), 0, side * 0.35), parent=rig, bevel=0.07)
        ball('mitt', 0.12, (side * 0.48, 0.58, 0.9), M_HAT, rig)
else:
    box('torso', (0.42, 0.3, 0.6), (0, 0.12, 0.98), M_JACKET, rot=(math.radians(-28), 0, 0), parent=rig, bevel=bev * 2)
    ball('head', 0.15, (0, 0.28, 1.42), M_PANTS, rig)
    for side in (-1, 1):
        box('arm', (0.1, 0.48, 0.1), (side * 0.3, 0.3, 0.95), M_JACKET, rot=(math.radians(-20), 0, side * 0.3), parent=rig, bevel=bev)

# ---------------------------------------------------------------- light, sky, camera
sun_d = bpy.data.lights.new('Sun', 'SUN')
sun_d.energy = S['sun_strength']
sun_d.color = S['sun_color']
sun_d.angle = math.radians(S['sun_angle'])
sun = bpy.data.objects.new('Sun', sun_d)
el, az = math.radians(S['sun_elev']), math.radians(S['sun_az'])
sun.rotation_euler = (math.pi / 2 - el, 0, az)
scene.collection.objects.link(sun)

world = bpy.data.worlds.new('Sky')
scene.world = world
world.use_nodes = True
wn = world.node_tree
bg = wn.nodes['Background']
grad_c = wn.nodes.new('ShaderNodeTexCoord')
grad_s = wn.nodes.new('ShaderNodeSeparateXYZ')
grad_r = wn.nodes.new('ShaderNodeValToRGB')
grad_r.color_ramp.elements[0].position = 0.0
grad_r.color_ramp.elements[0].color = (*S['sky_horizon'], 1)
grad_r.color_ramp.elements[1].position = 0.45
grad_r.color_ramp.elements[1].color = (*S['sky_top'], 1)
wn.links.new(grad_c.outputs['Generated'], grad_s.inputs[0])
wn.links.new(grad_s.outputs['Z'], grad_r.inputs[0])
wn.links.new(grad_r.outputs[0], bg.inputs['Color'])
bg.inputs['Strength'].default_value = S['sky_strength']
# what the camera sees behind the diorama: a backdrop graded down the frame (the sky above still lights the scene)
win = wn.nodes.new('ShaderNodeTexCoord')
wsep = wn.nodes.new('ShaderNodeSeparateXYZ')
wramp = wn.nodes.new('ShaderNodeValToRGB')
wramp.color_ramp.elements[0].color = (*S['sky_horizon'], 1)
wramp.color_ramp.elements[1].color = (*S['sky_top'], 1)
wn.links.new(win.outputs['Window'], wsep.inputs[0])
wn.links.new(wsep.outputs['Y'], wramp.inputs[0])
back = wn.nodes.new('ShaderNodeBackground')
back.inputs['Strength'].default_value = 1.0
wn.links.new(wramp.outputs[0], back.inputs['Color'])
lp = wn.nodes.new('ShaderNodeLightPath')
wmix = wn.nodes.new('ShaderNodeMixShader')
wn.links.new(lp.outputs['Is Camera Ray'], wmix.inputs[0])
wn.links.new(bg.outputs[0], wmix.inputs[1])
wn.links.new(back.outputs[0], wmix.inputs[2])
wn.links.new(wmix.outputs[0], wn.nodes['World Output'].inputs[0])

cam_d = bpy.data.cameras.new('Cam')
cam_d.lens = S['lens']
cam = bpy.data.objects.new('Cam', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
if SHOT == 'ride':
    # the game's chase cam: low behind the rider, looking down the run
    cam_d.lens = 22
    cam.location = Vector((sx + 1.2, sy + 8.5, height(sx + 1.2, sy + 8.5) + 4.2))
    target = Vector((0, sy - 30, height(0, sy - 30) + 1))
else:
    # three-quarter view from below and to the side, like the game's orbit camera
    target = Vector((0, 0, height(0, 0) - 10))
    dist = {'toy': 520}.get(STYLE, 335)
    yaw, pitch = math.radians(-40), math.radians(30)
    cam.location = target + Vector((math.sin(yaw) * -math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * dist
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_d.clip_end = 2000
if S['dof']:
    cam_d.dof.use_dof = True
    cam_d.dof.focus_object = rig
    cam_d.dof.aperture_fstop = 0.003 if SHOT == 'wide' else 0.5
    scene.eevee.bokeh_max_size = 60

# ---------------------------------------------------------------- render settings
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = RES
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
ee = scene.eevee
ee.taa_render_samples = 32
for attr, val in (('use_shadows', True), ('shadow_ray_count', 2), ('shadow_step_count', 8),
                  ('use_raytracing', True), ('fast_gi_method', 'GLOBAL_ILLUMINATION')):
    if hasattr(ee, attr):
        try:
            setattr(ee, attr, val)
        except Exception:
            pass
if S['outline']:
    scene.render.use_freestyle = True
    scene.render.line_thickness_mode = 'ABSOLUTE'
    scene.render.line_thickness = 1.4
    fs = scene.view_layers[0].freestyle_settings
    ls = fs.linesets[0] if len(fs.linesets) else fs.linesets.new('Ink')
    if ls.linestyle is None:
        ls.linestyle = bpy.data.linestyles.new('Ink')
    ls.select_by_visibility = True
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_crease = S.get('crease', False)
    ls.select_material_boundary = False
    ls.linestyle.color = S.get('ink', (0.05, 0.06, 0.16))
    # far away the props are small, so the ink gets thinner in the wide shot
    scene.render.line_thickness = S.get('line', 1.4) * RES[0] / 1280 * (0.6 if SHOT == 'wide' and S.get('cartoon') else 1.0)
vs = scene.view_settings
try:
    if S['look'] == 'None':
        vs.view_transform = 'Standard'
    else:
        vs.view_transform = 'AgX'
        vs.look = S['look']
except TypeError:
    pass
vs.exposure = S['exposure']
scene.render.filepath = OUT
print('trees', trees, 'style', STYLE)
if SAVE:
    bpy.ops.wm.save_as_mainfile(filepath=SAVE)
bpy.ops.render.render(write_still=True)
print('rendered', OUT)
