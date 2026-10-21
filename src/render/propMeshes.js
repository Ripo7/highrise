import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TREE } from '../core/props.js';
import { THEME, SUN_DIR, CUT_SHADOW, CUT_LIT } from './theme.js';
import { lightUniforms, shadowVertPars, shadowVert, shadowFragPars, outlineMaterial } from './toon.js';

// Trees and rocks come from the Blender factory (art/export_props.py -> public/models/props.glb):
// 6 tree and 5 rock variants, each drawn as one instanced mesh. Parts are tagged by material
// name (snow / needles / bark / rock) and painted with the theme's three colour bands, so the
// palette lives in theme.js, not in the model. Until the file has loaded, simple stand-ins show.

const MAX_TREES = 9000;
const MAX_ROCKS = 3000;
const KIND = { snow: 0, needles: 1, bark: 2, rock: 3 };
// visual size for scale 1, matching the collision sizes in core/props.js
const TREE_HEIGHT = 10;
const ROCK_RADIUS = 1.6;

const vert = /* glsl */ `
  ${shadowVertPars}
  attribute float aKind;
  varying float vKind;
  varying vec3 vN;
  varying vec3 vWorld;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 w = m * vec4(position, 1.0);
    vWorld = w.xyz;
    vec3 nw = normalize(mat3(m) * normal);
    vN = nw;
    vKind = aKind;
    ${shadowVert}
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const frag = /* glsl */ `
  ${shadowFragPars}
  uniform vec3 uLit[4];
  uniform vec3 uMid[4];
  uniform vec3 uShadow[4];
  uniform vec3 uSunDir;
  uniform float uCutShadow;
  uniform float uCutLit;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vKind;
  varying vec3 vN;
  varying vec3 vWorld;
  void main() {
    int k = int(vKind + 0.5);
    vec3 lit = uLit[0], mid = uMid[0], sh = uShadow[0];
    if (k == 1) { lit = uLit[1]; mid = uMid[1]; sh = uShadow[1]; }
    else if (k == 2) { lit = uLit[2]; mid = uMid[2]; sh = uShadow[2]; }
    else if (k == 3) { lit = uLit[3]; mid = uMid[3]; sh = uShadow[3]; }
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    float ndl = dot(n, normalize(uSunDir));
    float aa = fwidth(ndl) + 0.004;
    float inSun = smoothstep(0.35, 0.65, sunShadow());
    vec3 col = mix(sh, mix(mid, lit, smoothstep(uCutLit - aa, uCutLit + aa, ndl) * inSun),
                   smoothstep(uCutShadow - aa, uCutShadow + aa, ndl) * inSun);
    float dist = length(cameraPosition - vWorld);
    col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

function toonMaterial() {
  const c = (h) => new THREE.Color(h);
  const bands = [THEME.snow, THEME.needles, THEME.bark, THEME.rock];
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    lights: true,
    uniforms: {
      ...lightUniforms(),
      uLit: { value: bands.map((b) => c(b[0])) },
      uMid: { value: bands.map((b) => c(b[1])) },
      uShadow: { value: bands.map((b) => c(b[2])) },
      uSunDir: { value: new THREE.Vector3(...SUN_DIR).normalize() },
      uCutShadow: { value: CUT_SHADOW },
      uCutLit: { value: CUT_LIT },
      uFog: { value: c(THEME.haze) },
      uFogNear: { value: 1400 },
      uFogFar: { value: 4200 },
    },
  });
}

function tagged(geo, kind) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position);
  g.setAttribute('normal', geo.attributes.normal);
  g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(kind), 1));
  g.setIndex(geo.index);
  return g;
}

// stand-ins while props.glb loads: a cone tree and a lump of rock
function fallbackTree() {
  const trunk = tagged(new THREE.CylinderGeometry(0.35, 0.45, 2.4, 6).translate(0, 1.2, 0), KIND.bark);
  const crown = tagged(new THREE.ConeGeometry(3.2, 8, 7).translate(0, 6, 0), KIND.needles);
  return mergeGeometries([trunk, crown]);
}
function fallbackRock() {
  return tagged(new THREE.IcosahedronGeometry(1.4, 1).scale(1, 0.7, 1), KIND.rock);
}

// one merged, normalised geometry per object in the glb
function variantsFrom(gltf) {
  const trees = [];
  const rocks = [];
  for (const node of gltf.scene.children) {
    const parts = [];
    node.updateMatrixWorld(true);
    node.traverse((o) => {
      if (!o.isMesh) return;
      const kind = KIND[o.material?.name] ?? KIND.rock;
      const g = o.geometry.clone();
      // children carry the node's transform; bake everything relative to the node
      const rel = new THREE.Matrix4().copy(node.matrixWorld).invert().multiply(o.matrixWorld);
      g.applyMatrix4(rel);
      parts.push(tagged(g, kind));
    });
    if (!parts.length) continue;
    const geo = mergeGeometries(parts);
    geo.computeBoundingBox();
    (node.name.startsWith('tree') ? trees : rocks).push({ name: node.name, geo });
  }
  const sortByName = (a, b) => a.name.localeCompare(b.name);
  trees.sort(sortByName);
  rocks.sort(sortByName);
  // trees: keep their relative heights, averaging TREE_HEIGHT; rocks: a footprint of ROCK_RADIUS
  const meanH = trees.reduce((s, t) => s + t.geo.boundingBox.max.y, 0) / Math.max(1, trees.length);
  for (const t of trees) t.geo.scale(TREE_HEIGHT / meanH, TREE_HEIGHT / meanH, TREE_HEIGHT / meanH);
  for (const r of rocks) {
    const b = r.geo.boundingBox;
    const rad = Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z);
    r.geo.scale(ROCK_RADIUS / rad, ROCK_RADIUS / rad, ROCK_RADIUS / rad);
  }
  return { trees: trees.map((t) => t.geo), rocks: rocks.map((r) => r.geo) };
}

export class PropMeshes {
  constructor(props) {
    this.props = props;
    this.material = toonMaterial();
    this.outline = outlineMaterial({ instanced: true, width: 1.5, fade: 900 });
    this.group = new THREE.Group();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this.drawn = -1;
    this.setVariants([fallbackTree()], [fallbackRock()]);
    new GLTFLoader().load(
      `${import.meta.env.BASE_URL}models/props.glb`,
      (gltf) => {
        const v = variantsFrom(gltf);
        if (v.trees.length && v.rocks.length) {
          this.setVariants(v.trees, v.rocks);
          this.rebuild();
        }
      },
      undefined,
      (err) => console.warn('props.glb failed to load, keeping stand-ins', err),
    );
  }

  setVariants(treeGeos, rockGeos) {
    for (const m of [...(this.trees || []), ...(this.rocks || [])]) {
      this.group.remove(m, m.userData.ink);
      m.geometry.dispose();
      m.dispose();
    }
    const make = (geo, cap) => {
      const m = new THREE.InstancedMesh(geo, this.material, cap);
      m.count = 0;
      m.frustumCulled = false; // spread over the whole run; one draw call anyway
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.receiveShadow = true;
      // the ink outline: same instances, drawn as an inverted hull
      const ink = new THREE.InstancedMesh(geo, this.outline, cap);
      ink.instanceMatrix = m.instanceMatrix;
      ink.count = 0;
      ink.frustumCulled = false;
      m.userData.ink = ink;
      this.group.add(m, ink);
      return m;
    };
    // a variant can't hold more than its share plus slack (props pick variants evenly)
    this.trees = treeGeos.map((g) => make(g, Math.ceil((MAX_TREES / treeGeos.length) * 1.5)));
    this.rocks = rockGeos.map((g) => make(g, Math.ceil((MAX_ROCKS / rockGeos.length) * 1.5)));
    this.drawn = -1;
  }

  setFog(near, far) {
    for (const mat of [this.material, this.outline]) {
      mat.uniforms.uFogNear.value = near;
      mat.uniforms.uFogFar.value = far;
    }
  }

  // which variant a prop shows: fixed by its random rotation, so it never changes
  variant(p, n) {
    const f = Math.abs(Math.sin(p.r * 12.9898 + p.s * 78.233) * 43758.5453) % 1;
    return Math.min(n - 1, Math.floor(f * n));
  }

  place(p) {
    const hf = this.props.hf;
    const z = this.props.worldZ(p);
    const y = hf.heightAt(p.x, z);
    this._q.setFromAxisAngle(this._up, p.r);
    if (p.k === TREE) {
      this._p.set(p.x, y - 0.3, z);
      this._s.setScalar(p.s);
    } else {
      this._p.set(p.x, y - 0.3 * p.s, z);
      this._s.set(p.s * (1 + 0.15 * Math.sin(p.r * 3)), p.s, p.s * (1 + 0.15 * Math.cos(p.r * 5)));
    }
    return this._m.compose(this._p, this._q, this._s);
  }

  // rebuild every instance (after props are added or removed)
  rebuild() {
    const tc = this.trees.map(() => 0);
    const rc = this.rocks.map(() => 0);
    for (const p of this.props.list) {
      const set = p.k === TREE ? this.trees : this.rocks;
      const counts = p.k === TREE ? tc : rc;
      const v = this.variant(p, set.length);
      const mesh = set[v];
      if (counts[v] >= mesh.instanceMatrix.count) {
        p._i = undefined;
        continue;
      }
      p._v = v;
      p._i = counts[v];
      mesh.setMatrixAt(counts[v]++, this.place(p));
    }
    this.trees.forEach((m, i) => {
      m.count = m.userData.ink.count = tc[i];
      m.instanceMatrix.needsUpdate = true;
    });
    this.rocks.forEach((m, i) => {
      m.count = m.userData.ink.count = rc[i];
      m.instanceMatrix.needsUpdate = true;
    });
    this.drawn = this.props.version;
  }

  sync() {
    if (this.drawn !== this.props.version) this.rebuild();
  }

  // the snow moved under some props (sculpting): sit them back on it
  refreshRect(rect) {
    if (!rect) return;
    const hf = this.props.hf;
    const [x0, z0] = hf.toWorld(rect.i0, rect.j0);
    const [x1, z1] = hf.toWorld(rect.i1, rect.j1);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const r = Math.hypot(x1 - x0, z1 - z0) / 2 + 2;
    const touched = new Set();
    for (const p of this.props.near(cx, cz, r)) {
      if (p._i === undefined) continue;
      const mesh = (p.k === TREE ? this.trees : this.rocks)[p._v];
      if (!mesh) continue;
      mesh.setMatrixAt(p._i, this.place(p));
      touched.add(mesh);
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
  }
}
