import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEME } from './theme.js';
import { toonRamp, outlineMaterial } from './toon.js';

// The run editor's structures, built from simple shapes in the same cartoon style as the
// rest of the scene: flat colour bands from the toon ramp, ink outlines on the chunky
// pieces. Everything static is merged into two meshes (outlined and not), so a run full
// of chalets and rails still costs a handful of draw calls. Moving bits: chairlift chairs
// (instanced) and the snow cannons' plumes (points).

const C = {
  wood: THEME.bark[0],
  woodDark: THEME.bark[2],
  stone: THEME.rock[1],
  stoneDark: THEME.rock[2],
  roof: '#c45d64',
  snow: THEME.snow[0],
  snowShade: THEME.snow[1],
  window: '#ffe39a',
  steel: '#8a98d0',
  steelDark: '#5b6799',
  concrete: '#cbc3d8',
  rail: '#ffb547',
  boxSide: THEME.jacket,
  boxTop: '#f4f1ff',
  net: '#ff7a2f',
  netPost: '#4f4a66',
  flagRed: '#ff5d6c',
  flagBlue: '#4f7be8',
  cannon: '#ffd23f',
  cannonDark: '#3f3a57',
  chair: '#ff6464',
  chairSeat: '#4f7be8',
  ice: '#cfd8fb',
};

const DIFF = { green: '#22a35a', blue: '#2f6fd6', red: '#e0412f', black: '#3b2a55', up: '#8a6fd8' };

const MAX_CHAIRS = 600;
const MAX_FLAKES = 3200;

// a world frame on the snow: +x across the run, +y up, +z down the run
function frameMatrix(x, y, z, dir = [0, 1]) {
  const [dx, dz] = dir;
  const m = new THREE.Matrix4();
  m.makeBasis(new THREE.Vector3(dz, 0, -dx), new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, 0, dz));
  m.setPosition(x, y, z);
  return m;
}

// collects coloured pieces, then merges them into one geometry
class Parts {
  constructor() {
    this.list = [];
  }

  add(geo, color, m) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (geo.index) geo.dispose();
    if (m) g.applyMatrix4(m);
    const col = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = col.r;
      arr[i * 3 + 1] = col.g;
      arr[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    this.list.push(g);
  }

  // an axis-aligned box in the local frame m: centre (cx, cy, cz), size (sx, sy, sz)
  box(m, cx, cy, cz, sx, sy, sz, color, rot = null) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    if (rot) g.applyMatrix4(rot);
    g.translate(cx, cy, cz);
    this.add(g, color, m);
  }

  // a cylinder between two world points
  rod(a, b, r, color, seg = 6) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-3) return;
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    this.add(g, color, m);
  }

  merge() {
    if (!this.list.length) return null;
    const g = mergeGeometries(this.list);
    for (const p of this.list) p.dispose();
    this.list = [];
    g.computeBoundingSphere();
    return g;
  }
}

// a pitched roof over a w × d footprint (ridge along z), as two slabs plus snow
function roof(P, m, w, d, wallH, rise, ov) {
  const half = w / 2 + ov;
  const slope = Math.hypot(half, rise);
  const ang = Math.atan2(rise, half);
  for (const side of [-1, 1]) {
    const rot = new THREE.Matrix4().makeRotationZ(-side * ang);
    const cx = (side * half) / 2;
    const cy = wallH + rise / 2;
    P.box(m, cx, cy, 0, slope, 0.35, d + 2 * ov, C.roof, rot);
    // a thick layer of snow on top, not quite to the eaves
    const up = new THREE.Vector3(-side * Math.sin(ang), Math.cos(ang), 0).multiplyScalar(0.3);
    P.box(m, cx * 0.92 + up.x, cy + up.y + 0.02, 0, slope * 0.9, 0.38, d + 2 * ov - 0.3, C.snow, rot);
  }
  // gable ends
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  for (const z of [-d / 2, d / 2]) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false });
    g.translate(0, wallH, z - 0.1);
    P.add(g, C.woodDark, m);
  }
}

export class StructureMeshes {
  constructor(structs) {
    this.structs = structs;
    this.hf = structs.hf;
    this.group = new THREE.Group();
    this.material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() });
    this.ink = outlineMaterial({ width: 1.4, fade: 1500 });
    this.inked = null;
    this.plain = null;
    this.outline = null;
    this.netMesh = null;
    this.cables = null;
    this.lines = []; // chairlift lines: { pts: [Vector3...], len, chairs }
    this.cannons = []; // { nozzle: Vector3, aim: Vector3, rate }
    this.t = 0;

    // nets: orange mesh with a diamond pattern
    this.netMat = new THREE.MeshBasicMaterial({
      color: C.net,
      map: netTexture(),
      transparent: true,
      alphaTest: 0.3,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.cableMat = new THREE.MeshBasicMaterial({ color: '#3f3a57', fog: true });

    // chairs: one instanced mesh for every chairlift
    this.chairs = new THREE.InstancedMesh(chairGeometry(), new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() }), MAX_CHAIRS);
    this.chairs.count = 0;
    this.chairs.frustumCulled = false;
    this.chairs.castShadow = true;
    this.chairs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.chairs);

    // snow cannon plumes
    this.flakes = new Flakes(MAX_FLAKES);
    this.group.add(this.flakes.points);
  }

  setFog(near, far) {
    this.ink.uniforms.uFogNear.value = near;
    this.ink.uniforms.uFogFar.value = far;
  }

  setScale(px) {
    this.flakes.points.material.uniforms.uScale.value = px;
  }

  dispose() {
    for (const m of [this.inked, this.plain, this.outline, this.netMesh, this.cables]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.inked = this.plain = this.outline = this.netMesh = this.cables = null;
  }

  rebuild() {
    this.dispose();
    const hf = this.hf;
    const gy = (x, z) => hf.heightAt(x, z);
    const A = new Parts(); // outlined
    const B = new Parts(); // thin bits, no outline
    const netQuads = [];
    const pylons = [];
    this.cannons = [];
    for (const s of this.structs.list) {
      switch (s.type) {
        case 'rail':
          this.rail(s, A, B, gy);
          break;
        case 'chalet':
          this.chalet(s, A, gy);
          break;
        case 'pylon':
          this.pylon(s, A, gy);
          pylons.push(s);
          break;
        case 'bridge':
          this.bridge(s, A, B, gy);
          break;
        case 'tunnel':
          this.tunnel(s, A, gy);
          break;
        case 'net':
          this.net(s, B, netQuads, gy);
          break;
        case 'pole':
          this.pole(s, B, gy);
          break;
        case 'gate':
          this.gate(s, B, gy);
          break;
        case 'cannon':
          this.cannon(s, A, B, gy);
          break;
        default:
          break;
      }
    }
    const add = (geo, mat, { cast = true, receive = true } = {}) => {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.receiveShadow = receive;
      this.group.add(m);
      return m;
    };
    const ga = A.merge();
    this.inked = add(ga, this.material);
    if (ga) {
      this.outline = new THREE.Mesh(ga, this.ink);
      this.group.add(this.outline);
    }
    this.plain = add(B.merge(), this.material);
    this.netMesh = netQuads.length ? add(netGeometry(netQuads), this.netMat, { cast: false }) : null;
    this.liftLines(pylons, gy);
  }

  // ---------- builders ----------

  rail(s, A, B, gy) {
    const a = new THREE.Vector3(s.x0, s.y0, s.z0);
    const b = new THREE.Vector3(s.x1, s.y1, s.z1);
    const len = a.distanceTo(b);
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    const flat = [dir.x, dir.z];
    const fl = Math.hypot(flat[0], flat[1]) || 1;
    const dir2 = [flat[0] / fl, flat[1] / fl];
    if (s.box) {
      // a wide plastic-topped box on an orange body that reaches the snow
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      const m = frameMatrix(mid.x, mid.y, mid.z, dir2);
      const tilt = new THREE.Matrix4().makeRotationX(-Math.asin(Math.max(-1, Math.min(1, dir.y))));
      m.multiply(tilt);
      A.box(m, 0, -0.03, 0, 0.56, 0.08, len, C.boxTop);
      A.box(m, 0, -0.42, 0, 0.5, 0.72, len - 0.1, C.boxSide);
    } else {
      B.rod(a, b, 0.07, C.rail, 8);
      // end caps and legs down to the snow
      const legs = Math.max(2, Math.round(len / 4) + 1);
      for (let i = 0; i < legs; i++) {
        const p = new THREE.Vector3().lerpVectors(a, b, i / (legs - 1));
        const g = gy(p.x, p.z);
        B.rod(new THREE.Vector3(p.x, g - 0.3, p.z), new THREE.Vector3(p.x, p.y - 0.05, p.z), 0.05, C.steelDark, 5);
        B.box(null, p.x, g + 0.05, p.z, 0.5, 0.12, 0.5, C.steelDark);
      }
    }
  }

  chalet(s, A, gy) {
    const g = gy(s.x, s.z);
    const m = frameMatrix(s.x, g, s.z, s.dir);
    const { w, d } = s;
    const wallH = [2.8, 3.6, 4.4][s.size];
    const rise = [2.2, 3.4, 4.2][s.size];
    // stone foundation reaching down into the slope
    A.box(m, 0, -1.4, 0, w + 0.5, 3.6, d + 0.5, C.stone);
    A.box(m, 0, 0.4 + wallH / 2, 0, w, wallH, d, C.wood);
    roof(A, m, w, d, 0.4 + wallH, rise, 0.9);
    // windows (warm light) and a door on the downhill side
    const nWin = Math.max(1, Math.round(d / 3.5) - 1);
    for (const side of [-1, 1]) {
      for (let i = 0; i < nWin; i++) {
        const z = ((i + 0.5) / nWin - 0.5) * (d - 2);
        A.box(m, side * (w / 2 + 0.03), 0.4 + wallH * 0.55, z, 0.1, 1.0, 1.1, C.window);
      }
    }
    A.box(m, 0, 0.4 + 1.05, d / 2 + 0.04, 1.3, 2.1, 0.1, C.woodDark);
    A.box(m, -w / 4, 0.4 + wallH * 0.6, d / 2 + 0.04, 1.0, 0.9, 0.1, C.window);
    if (s.size > 0) A.box(m, w / 4, 0.4 + wallH * 0.6, d / 2 + 0.04, 1.0, 0.9, 0.1, C.window);
    // chimney
    A.box(m, w * 0.22, 0.4 + wallH + rise * 0.7, -d * 0.2, 0.7, rise * 0.9, 0.7, C.stoneDark);
    A.box(m, w * 0.22, 0.4 + wallH + rise * 1.17, -d * 0.2, 0.85, 0.2, 0.85, C.snow);
    if (s.size === 2) {
      // a terrace with a railing on the downhill side
      A.box(m, 0, 0.25, d / 2 + 2.2, w, 0.3, 4.2, C.wood);
      for (let x = -w / 2 + 0.3; x <= w / 2 - 0.2; x += 2) A.box(m, x, 0.85, d / 2 + 4.15, 0.15, 1.0, 0.15, C.woodDark);
      A.box(m, 0, 1.3, d / 2 + 4.15, w, 0.12, 0.12, C.woodDark);
    }
  }

  pylon(s, A, gy) {
    const g = gy(s.x, s.z);
    const m = frameMatrix(s.x, g, s.z, s.dir);
    A.box(m, 0, -0.5, 0, 2.2, 2, 2.2, C.concrete);
    const tower = new THREE.CylinderGeometry(0.32, 0.62, s.h, 4, 1);
    tower.rotateY(Math.PI / 4);
    tower.translate(0, s.h / 2 + 0.4, 0);
    A.add(tower, C.steel, m);
    A.box(m, 0, s.h + 0.4, 0, 5.2, 0.4, 0.5, C.steelDark);
    for (const side of [-1, 1]) {
      const wheel = new THREE.CylinderGeometry(0.4, 0.4, 0.2, 10);
      wheel.rotateX(Math.PI / 2);
      wheel.translate(side * 2.3, s.h + 0.05, 0);
      A.add(wheel, C.steelDark, m);
    }
    A.box(m, 0, s.h + 0.68, 0, 1.2, 0.18, 0.7, C.snow);
  }

  bridge(s, A, B, gy) {
    const g = gy(s.x, s.z);
    const m = frameMatrix(s.x, g, s.z, s.dir);
    const deck = s.deckY - g;
    const half = s.span / 2;
    A.box(m, 0, deck, 0, s.span + 3, 0.7, 3.6, C.wood);
    A.box(m, 0, deck + 0.42, 0, s.span + 2.6, 0.18, 3.3, C.snow);
    for (const z of [-1.65, 1.65]) {
      A.box(m, 0, deck + 1.35, z, s.span + 3, 0.16, 0.16, C.woodDark);
      for (let x = -half - 1.2; x <= half + 1.2; x += 2.5) B.box(m, x, deck + 0.85, z, 0.14, 1.0, 0.14, C.woodDark);
    }
    for (const side of [-1, 1]) {
      const px = s.x + s.dir[1] * side * half;
      const pz = s.z - s.dir[0] * side * half;
      const pg = gy(px, pz);
      const h = s.deckY - pg + 3.2;
      A.box(m, side * half, deck - 0.35 - h / 2 + 0.01, 0, 2.6, h, 3.8, C.stone);
      A.box(m, side * half, deck + 0.75, 0, 2.8, 0.25, 4, C.snow);
    }
  }

  tunnel(s, A, gy) {
    // an arched shell of snow, following the slope, with wooden portal frames
    const steps = Math.max(2, Math.round(s.L / 2));
    const seg = 14;
    const inner = [];
    const outer = [];
    const t0 = -0.16;
    const t1 = Math.PI + 0.16;
    const ring = (along, rx, ry) => {
      const cx = s.x + s.dir[0] * along;
      const cz = s.z + s.dir[1] * along;
      const g = gy(cx, cz);
      const pts = [];
      for (let k = 0; k <= seg; k++) {
        const t = t0 + ((t1 - t0) * k) / seg;
        const across = Math.cos(t) * rx;
        pts.push(new THREE.Vector3(cx + s.dir[1] * across, g + Math.sin(t) * ry, cz - s.dir[0] * across));
      }
      return pts;
    };
    for (let i = 0; i <= steps; i++) {
      const al = (s.L * i) / steps;
      inner.push(ring(al, s.hw, s.ht));
      outer.push(ring(al, s.hw + 1.3, s.ht + 1.1));
    }
    const quadStrip = (rows, flip, color) => {
      const pos = [];
      for (let i = 0; i < rows.length - 1; i++) {
        for (let k = 0; k < seg; k++) {
          const a = rows[i][k];
          const b = rows[i][k + 1];
          const c = rows[i + 1][k];
          const d = rows[i + 1][k + 1];
          if (flip) pos.push(a, c, b, b, c, d);
          else pos.push(a, b, c, b, d, c);
        }
      }
      const g = new THREE.BufferGeometry().setFromPoints(pos);
      g.computeVertexNormals();
      A.add(g, color);
    };
    quadStrip(outer, false, C.snow);
    quadStrip(inner, true, C.ice);
    // portal frames: the ring between inner and outer at each end, in wood
    for (const i of [0, steps]) {
      const pos = [];
      for (let k = 0; k < seg; k++) {
        const a = inner[i][k];
        const b = inner[i][k + 1];
        const c = outer[i][k];
        const d = outer[i][k + 1];
        if (i === 0) pos.push(a, c, b, b, c, d);
        else pos.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry().setFromPoints(pos);
      g.computeVertexNormals();
      A.add(g, C.wood);
    }
  }

  net(s, B, quads, gy) {
    const n = Math.max(2, Math.round(s.L / 5) + 1);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const al = (s.L * i) / (n - 1);
      const x = s.x + s.dir[0] * al;
      const z = s.z + s.dir[1] * al;
      const g = gy(x, z);
      pts.push({ x, z, g, al });
      B.rod(new THREE.Vector3(x, g - 0.3, z), new THREE.Vector3(x, g + s.h + 0.15, z), 0.06, C.netPost, 5);
    }
    quads.push({ pts, h: s.h });
  }

  pole(s, B, gy) {
    const g = gy(s.x, s.z);
    const col = DIFF[s.color] || DIFF.blue;
    B.rod(new THREE.Vector3(s.x, g - 0.3, s.z), new THREE.Vector3(s.x, g + 1.6, s.z), 0.06, col, 6);
    B.rod(new THREE.Vector3(s.x, g + 1.6, s.z), new THREE.Vector3(s.x, g + 2.0, s.z), 0.065, '#ff8a3d', 6);
  }

  gate(s, B, gy) {
    const col = s.order % 2 ? C.flagBlue : C.flagRed;
    for (const side of [-1, 1]) {
      const x = s.x + s.dir[1] * side * (s.gw / 2);
      const z = s.z - s.dir[0] * side * (s.gw / 2);
      const g = gy(x, z);
      B.rod(new THREE.Vector3(x, g - 0.3, z), new THREE.Vector3(x, g + 2.0, z), 0.05, col, 6);
      // a panel flag hanging outwards from each pole
      const m = frameMatrix(x, g, z, s.dir);
      B.box(m, side * 0.42, 1.55, 0, 0.8, 0.7, 0.04, col);
      B.box(m, side * 0.42, 1.55, 0.03, 0.5, 0.12, 0.02, '#ffffff');
    }
  }

  cannon(s, A, B, gy) {
    const g = gy(s.x, s.z);
    const aim = s.aim;
    const m = frameMatrix(s.x, g, s.z, aim);
    let nozzle;
    if (s.size === 0) {
      // fan gun on a sled
      A.box(m, 0, 0.25, 0, 1.6, 0.3, 1.6, C.cannonDark);
      B.rod(new THREE.Vector3(0, 0.3, 0).applyMatrix4(m), new THREE.Vector3(0, 1.4, -0.2).applyMatrix4(m), 0.08, C.cannonDark);
      const drum = new THREE.CylinderGeometry(0.75, 0.75, 1.5, 14, 1, true);
      drum.rotateX(Math.PI / 2 - 0.45);
      drum.translate(0, 1.6, 0.1);
      A.add(drum, C.cannon, m);
      const back = new THREE.CircleGeometry(0.75, 14);
      back.rotateX(-0.45 + Math.PI);
      back.translate(0, 1.6 - Math.sin(0.45) * 0.0 - 0.32, -0.6);
      A.add(back, C.cannonDark, m);
      nozzle = new THREE.Vector3(0, 1.95, 0.85).applyMatrix4(m);
    } else {
      const h = s.size === 1 ? 6.5 : 10;
      A.box(m, 0, 0.3, 0, 1.2, 0.6, 1.2, C.concrete);
      B.rod(new THREE.Vector3(0, 0.5, 0).applyMatrix4(m), new THREE.Vector3(0, h, 0).applyMatrix4(m), s.size === 1 ? 0.13 : 0.18, C.cannon, 8);
      if (s.size === 1) {
        B.rod(new THREE.Vector3(0, h - 0.3, -0.4).applyMatrix4(m), new THREE.Vector3(0, h + 0.6, 1.3).applyMatrix4(m), 0.12, C.cannonDark, 8);
        nozzle = new THREE.Vector3(0, h + 0.6, 1.4).applyMatrix4(m);
      } else {
        const drum = new THREE.CylinderGeometry(0.85, 0.85, 1.6, 14, 1, true);
        drum.rotateX(Math.PI / 2 - 0.35);
        drum.translate(0, h + 0.4, 0.2);
        A.add(drum, C.cannon, m);
        nozzle = new THREE.Vector3(0, h + 0.75, 1.1).applyMatrix4(m);
      }
    }
    const dir = new THREE.Vector3(aim[0], s.size === 0 ? 0.55 : 0.35, aim[1]).normalize();
    this.cannons.push({ nozzle, dir, power: s.size === 0 ? 11 : 9, carry: Math.random() });
  }

  // chairlifts: pylons in the same grid column, top to bottom, joined by two cables
  liftLines(pylons, gy) {
    this.lines = [];
    const byCol = new Map();
    for (const p of pylons) {
      if (!byCol.has(p.col)) byCol.set(p.col, []);
      byCol.get(p.col).push(p);
    }
    const tubes = [];
    for (const list of byCol.values()) {
      list.sort((a, b) => a.z - b.z);
      // split where pylons are too far apart to share a cable
      let run = [list[0]];
      const flush = () => {
        if (run.length >= 2) this.lines.push(...this.cableLine(run, gy, tubes));
        run = [];
      };
      for (let i = 1; i < list.length; i++) {
        if (list[i].z - list[i - 1].z > 320) flush();
        run.push(list[i]);
      }
      flush();
    }
    if (tubes.length) {
      const g = mergeGeometries(tubes);
      for (const t of tubes) t.dispose();
      this.cables = new THREE.Mesh(g, this.cableMat);
      this.group.add(this.cables);
    }
    // chairs every 14 m on both cables
    let count = 0;
    for (const l of this.lines) {
      l.chairs = Math.min(Math.floor(l.len / 14), MAX_CHAIRS - count);
      count += l.chairs;
    }
    this.chairs.count = count;
  }

  cableLine(run, gy, tubes) {
    const sides = [];
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i < run.length; i++) {
        const p = run[i];
        const top = gy(p.x, p.z) + p.h + 0.25;
        const a = new THREE.Vector3(p.x + p.dir[1] * side * 2.3, top, p.z - p.dir[0] * side * 2.3);
        if (i > 0) {
          // sagging span from the previous pylon
          const prev = pts[pts.length - 1];
          const span = prev.distanceTo(a);
          const sag = span * 0.025;
          for (let k = 1; k <= 8; k++) {
            const t = k / 8;
            const q = new THREE.Vector3().lerpVectors(prev, a, t);
            q.y -= 4 * sag * t * (1 - t);
            pts.push(q);
          }
        } else pts.push(a);
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      tubes.push(new THREE.TubeGeometry(curve, pts.length * 2, 0.06, 4, false));
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
      // the uphill cable (side -1) carries chairs up, the other one down
      sides.push({ pts, len, up: side < 0, chairs: 0 });
    }
    return sides;
  }

  // ---------- per frame ----------

  update(dt, camera) {
    this.t += dt;
    // chairs ride the cables at 2.5 m/s
    const m = this._m || (this._m = new THREE.Matrix4());
    const p = this._p || (this._p = new THREE.Vector3());
    const q = this._q || (this._q = new THREE.Quaternion());
    const one = this._one || (this._one = new THREE.Vector3(1, 1, 1));
    let i = 0;
    for (const l of this.lines) {
      if (!l.chairs) continue;
      const spacing = l.len / l.chairs;
      for (let k = 0; k < l.chairs; k++) {
        let d = (k * spacing + this.t * 2.5) % l.len;
        if (l.up) d = l.len - d;
        pointAlong(l.pts, d, p);
        const a = l.pts[0];
        const b = l.pts[l.pts.length - 1];
        q.setFromAxisAngle(Y, Math.atan2(b.x - a.x, b.z - a.z) + (l.up ? Math.PI : 0));
        m.compose(p, q, one);
        this.chairs.setMatrixAt(i++, m);
      }
    }
    if (i) this.chairs.instanceMatrix.needsUpdate = true;
    // snow cannons blow plumes of snow (only the ones near the camera)
    for (const c of this.cannons) {
      if (c.nozzle.distanceToSquared(camera.position) > 700 * 700) continue;
      c.carry += dt * 110;
      while (c.carry >= 1) {
        c.carry -= 1;
        this.flakes.emit(c.nozzle, c.dir, c.power);
      }
    }
    this.flakes.update(dt);
  }
}

const Y = new THREE.Vector3(0, 1, 0);

function pointAlong(pts, d, out) {
  for (let i = 1; i < pts.length; i++) {
    const seg = pts[i].distanceTo(pts[i - 1]);
    if (d <= seg || i === pts.length - 1) {
      return out.lerpVectors(pts[i - 1], pts[i], Math.min(1, d / (seg || 1)));
    }
    d -= seg;
  }
  return out.copy(pts[0]);
}

// a hanging chair: grip on the cable, a rod down, a bench with a back and a safety bar
function chairGeometry() {
  const P = new Parts();
  P.box(null, 0, -0.1, 0, 0.3, 0.3, 0.3, C.steelDark);
  P.box(null, 0, -1.3, 0, 0.08, 2.4, 0.08, C.steelDark);
  P.box(null, 0, -2.5, 0, 1.9, 0.12, 0.6, C.chairSeat);
  P.box(null, 0, -2.15, -0.3, 1.9, 0.7, 0.1, C.chair);
  P.box(null, 0, -1.95, 0.35, 1.9, 0.08, 0.08, C.steelDark);
  return P.merge();
}

// net panels between posts, following the snow
function netGeometry(nets) {
  const pos = [];
  const uv = [];
  for (const n of nets) {
    for (let i = 0; i < n.pts.length - 1; i++) {
      const a = n.pts[i];
      const b = n.pts[i + 1];
      const quad = [
        [a.x, a.g + 0.1, a.z, a.al, 0],
        [b.x, b.g + 0.1, b.z, b.al, 0],
        [a.x, a.g + n.h, a.z, a.al, n.h],
        [b.x, b.g + n.h, b.z, b.al, n.h],
      ];
      for (const k of [0, 1, 2, 2, 1, 3]) {
        pos.push(quad[k][0], quad[k][1], quad[k][2]);
        uv.push(quad[k][3] / 0.9, quad[k][4] / 0.9);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 64, 64);
  x.strokeStyle = '#fff';
  x.lineWidth = 7;
  x.beginPath();
  x.moveTo(0, 0);
  x.lineTo(64, 64);
  x.moveTo(64, 0);
  x.lineTo(0, 64);
  x.stroke();
  x.lineWidth = 9;
  x.beginPath();
  x.moveTo(0, 2);
  x.lineTo(64, 2);
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Soft snow flakes for the cannons: a pooled point cloud drifting in the wind
const flakeVert = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  uniform float uScale;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(aSize * (uScale / -mv.z) * (1.6 - 0.6 * aLife), uScale * 0.08);
  }
`;
const flakeFrag = /* glsl */ `
  varying float vLife;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.05, d) * min(1.0, vLife * 2.5) * 0.7;
    gl_FragColor = vec4(0.97, 0.98, 1.0, a);
  }
`;

class Flakes {
  constructor(max) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.decay = new Float32Array(max);
    this.size = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({ uniforms: { uScale: { value: 300 } }, vertexShader: flakeVert, fragmentShader: flakeFrag, transparent: true, depthWrite: false })
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.active = 0;
  }

  emit(p, dir, power) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    const s = power * (0.7 + Math.random() * 0.5);
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = dir.x * s + (Math.random() - 0.5) * 2.2;
    this.vel[i * 3 + 1] = dir.y * s + (Math.random() - 0.5) * 1.6;
    this.vel[i * 3 + 2] = dir.z * s + (Math.random() - 0.5) * 2.2;
    this.life[i] = 1;
    this.decay[i] = 1 / (2.2 + Math.random() * 1.6);
    this.size[i] = 1.1 + Math.random() * 1.6;
    this.active = Math.min(this.max, this.active + 1);
  }

  update(dt) {
    if (!this.active) return;
    const { pos, vel, life, decay } = this;
    const drag = Math.exp(-dt * 1.4);
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      life[i] = Math.max(0, life[i] - decay[i] * dt);
      if (life[i] > 0) alive++;
      const k = i * 3;
      vel[k] = vel[k] * drag + 0.6 * dt; // a light breeze across the slope
      vel[k + 1] = vel[k + 1] * drag - 1.8 * dt;
      vel[k + 2] = vel[k + 2] * drag;
      pos[k] += vel[k] * dt;
      pos[k + 1] += vel[k + 1] * dt;
      pos[k + 2] += vel[k + 2] * dt;
    }
    this.active = alive;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aLife.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
}
