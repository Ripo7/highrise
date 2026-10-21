"""Highrise prop factory: Geometry Nodes generators for trees and rocks.

tree_factory / rock_factory build node groups ("TreeFactory", "RockFactory") whose inputs
(Seed, Height, Layers, Width, Snow, Puff...) are what you tweak in Blender. make_variants
freezes a set of variants into plain meshes, which is what the game loads.

S is a style dict (see style_explore.py STYLES), M maps 'snow', 'needles', 'bark', 'rock'
to materials.
"""
import bpy

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


def tree_factory(S, M):
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
    cone = g.node('GeometryNodeMeshCone', {'Vertices': facets, 'Side Segments': S.get('tier_segments', 3), 'Radius Top': S.get('blunt', 0.0),
                                           'Radius Bottom': 1.0, 'Depth': 1.0}, fill_type='NGON')
    pos = g.node('GeometryNodeInputPosition')
    pz = g.node('ShaderNodeSeparateXYZ', {'Vector': pos.outputs[0]})
    jitter = g.node('FunctionNodeRandomValue', {'Min': -0.12, 'Max': 0.12, 'Seed': seed}, data_type='FLOAT')
    snow_line = g.math('ADD', g.math('SUBTRACT', 0.5, snow), jitter.outputs[0])
    is_snow = g.math('GREATER_THAN', pz.outputs['Z'], snow_line)
    m_needles = g.node('GeometryNodeSetMaterial', {'Geometry': cone.outputs['Mesh'], 'Material': M['needles']})
    m_snow = g.node('GeometryNodeSetMaterial', {'Geometry': m_needles.outputs[0], 'Selection': is_snow, 'Material': M['snow']})

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
        ball = g.node('GeometryNodeMeshUVSphere', {'Segments': S.get('blob_segments', 16), 'Rings': S.get('blob_rings', 8), 'Radius': 1.0})
        ball_m = g.node('GeometryNodeSetMaterial', {'Geometry': ball.outputs['Mesh'], 'Material': M['snow']})
        bscale = g.node('ShaderNodeCombineXYZ', {'X': g.math('MULTIPLY', radius, puff), 'Y': g.math('MULTIPLY', radius, puff),
                                                 'Z': g.math('MULTIPLY', tier_h, 0.3)})
        blobs = g.node('GeometryNodeInstanceOnPoints', {'Points': line.outputs[0], 'Instance': ball_m.outputs[0],
                                                        'Rotation': rot.outputs[0], 'Scale': bscale.outputs[0]})
        blobs_r = g.node('GeometryNodeRealizeInstances', {'Geometry': blobs.outputs[0]})

    trunk = g.node('GeometryNodeMeshCylinder', {'Vertices': g.math('MAXIMUM', g.math('FLOOR', g.math('MULTIPLY', facets, 0.6)), 4),
                                                'Radius': g.math('MULTIPLY', height, 0.055 if S.get('cartoon') else 0.035), 'Depth': g.math('MULTIPLY', trunk_h, 1.6)})
    trunk_up = g.node('GeometryNodeTransform', {'Geometry': trunk.outputs['Mesh'],
                                                'Translation': g.node('ShaderNodeCombineXYZ', {'Z': g.math('MULTIPLY', trunk_h, 0.8)}).outputs[0]})
    trunk_m = g.node('GeometryNodeSetMaterial', {'Geometry': trunk_up.outputs[0], 'Material': M['bark']})
    join = g.node('GeometryNodeJoinGeometry')
    g.nt.links.new(trunk_m.outputs[0], join.inputs[0])
    g.nt.links.new(tiers_r.outputs[0], join.inputs[0])
    if blobs_r:
        g.nt.links.new(blobs_r.outputs[0], join.inputs[0])
    sm = g.node('GeometryNodeSetShadeSmooth', {'Geometry': join.outputs[0], 'Shade Smooth': smooth})
    return g.finish(sm.outputs[0])


def rock_factory(S, M):
    """A boulder: an ico sphere pushed around by noise, squashed, snow on the upward faces."""
    g = G('RockFactory')
    seed = g.param('Seed', 'NodeSocketFloat', 0.0)
    size = g.param('Size', 'NodeSocketFloat', 2.0, 0.2, 20)
    rough = g.param('Roughness', 'NodeSocketFloat', 0.45, 0, 1.5)
    detail = g.param('Detail', 'NodeSocketInt', S.get('rock_detail', 2 if not S['smooth'] else 3), 1, 5)
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
    m_rock = g.node('GeometryNodeSetMaterial', {'Geometry': tr.outputs[0], 'Material': M['rock']})
    nrm = g.node('GeometryNodeInputNormal')
    nzc = g.node('ShaderNodeSeparateXYZ', {'Vector': nrm.outputs[0]})
    is_snow = g.math('GREATER_THAN', nzc.outputs['Z'], g.math('SUBTRACT', 1.0, snow))
    m_snow = g.node('GeometryNodeSetMaterial', {'Geometry': m_rock.outputs[0], 'Selection': is_snow, 'Material': M['snow']})
    sm = g.node('GeometryNodeSetShadeSmooth', {'Geometry': m_snow.outputs[0], 'Shade Smooth': smooth})
    return g.finish(sm.outputs[0])


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


def make_variants(S, M, style=''):
    """The prop set the game loads: 6 trees and 5 rocks, each a frozen generator output."""
    TREE_NG = tree_factory(S, M)
    ROCK_NG = rock_factory(S, M)
    STYLE = style
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
                            Snow=S.get('rock_snow', 0.75 if S.get('cartoon') else 0.55))
        rock_meshes.append(bake(ob))
    return tree_meshes, rock_meshes, TREE_NG, ROCK_NG
