import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TREE } from '../core/props.js';

// Trees and rocks drawn as two instanced meshes (one draw call each), low-poly and
// flat-shaded to match the diorama look: snow-dusted firs and grey boulders with snow caps.

const MAX_TREES = 9000;
const MAX_ROCKS = 3000;

function colorize(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(c, pos.getX(i), pos.getY(i), pos.getZ(i));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function treeGeometry() {
  const bark = new THREE.Color('#5b4636');
  const needle = new THREE.Color('#2c5a4e');
  const snow = new THREE.Color('#e9f0f4');
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 5).toNonIndexed();
  trunk.translate(0, 1.1, 0);
  parts.push(colorize(trunk, (c) => c.copy(bark)));
  const tiers = [
    [2.6, 4.2, 3.4],
    [2.0, 3.6, 5.4],
    [1.3, 3.0, 7.3],
  ];
  for (const [r, h, y] of tiers) {
    const cone = new THREE.ConeGeometry(r, h, 7).toNonIndexed();
    cone.translate(0, y, 0);
    // dusted with snow on the upper half of each tier
    parts.push(colorize(cone, (c, x, py) => c.copy(needle).lerp(snow, py > y + h * 0.05 ? 0.55 : 0)));
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  // lumpy, deterministic
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 0.78 + 0.32 * Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453 % 1);
    pos.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  const ng = g.toNonIndexed();
  const stone = new THREE.Color('#7b8591');
  const dark = new THREE.Color('#5d6670');
  const snow = new THREE.Color('#eef3f6');
  colorize(ng, (c, x, y) => c.copy(y > 0.35 ? snow : y > -0.1 ? stone : dark));
  ng.computeVertexNormals();
  return ng;
}

export class PropMeshes {
  constructor(props) {
    this.props = props;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.trees = new THREE.InstancedMesh(treeGeometry(), mat, MAX_TREES);
    this.rocks = new THREE.InstancedMesh(rockGeometry(), mat, MAX_ROCKS);
    for (const m of [this.trees, this.rocks]) {
      m.count = 0;
      m.frustumCulled = false; // spread over the whole run; one draw call anyway
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.group = new THREE.Group();
    this.group.add(this.trees, this.rocks);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this.drawn = -1;
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
      this._p.set(p.x, y - 0.25 * p.s, z);
      this._s.set(p.s * (1.1 + 0.3 * Math.sin(p.r * 3)), p.s, p.s * (1.1 + 0.3 * Math.cos(p.r * 5)));
    }
    return this._m.compose(this._p, this._q, this._s);
  }

  // rebuild every instance (after props are added or removed)
  rebuild() {
    let t = 0;
    let r = 0;
    for (const p of this.props.list) {
      if (p.k === TREE) {
        if (t >= MAX_TREES) continue;
        p._i = t;
        this.trees.setMatrixAt(t++, this.place(p));
      } else {
        if (r >= MAX_ROCKS) continue;
        p._i = r;
        this.rocks.setMatrixAt(r++, this.place(p));
      }
    }
    this.trees.count = t;
    this.rocks.count = r;
    this.trees.instanceMatrix.needsUpdate = true;
    this.rocks.instanceMatrix.needsUpdate = true;
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
    let t = false;
    let k = false;
    for (const p of this.props.near(cx, cz, r)) {
      if (p._i === undefined) continue;
      if (p.k === TREE) {
        this.trees.setMatrixAt(p._i, this.place(p));
        t = true;
      } else {
        this.rocks.setMatrixAt(p._i, this.place(p));
        k = true;
      }
    }
    if (t) this.trees.instanceMatrix.needsUpdate = true;
    if (k) this.rocks.instanceMatrix.needsUpdate = true;
  }
}
