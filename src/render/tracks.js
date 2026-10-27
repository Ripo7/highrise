import * as THREE from 'three';
import { THEME, SUN_DIR } from './theme.js';

// Ski tracks that stay in the snow, run after run, until fresh snow covers them.
//
// Each run leaves a polyline of points (x, distance down the mountain, kind). Kinds:
//   0 carve: two thin, sharp grooves, one per ski
//   1 powder: one trench, shaded like a furrow with a sunny rim
//   2 skid: a wide scraped smear (braking, skidding a turn)
// Points are kept every STEP metres, plus a last one that follows the skis every frame, so
// the tracks start right at the skier. They're laid on the snow as ribbons, on the drawn
// surface itself (the mesh's triangles, not a smoothed height), so they never dip under it.
// Kept in mountain coordinates so they stay put when the snow is rebuilt; saved in the browser.

const MAX = 40000; // points
const STEP = 0.6; // metres between points
// two ribbons per point: [offset from the centre, width] for each ski
const KIND = [
  [[-0.13, 0.1], [0.13, 0.1]], // carve: two sharp grooves, under each ski
  [[0, 0.7], [0, 0]], // powder: one trench, both skis and the boots
  [[0, 1.1], [0, 0]], // skid: one wide smear
];
const LIFT = 0.035; // metres above the drawn snow

const vert = /* glsl */ `
  attribute float aSide;
  attribute float aKind;
  attribute float aAge;
  varying float vSide;
  varying float vKind;
  varying float vAge;
  varying vec3 vWorld;
  void main() {
    vSide = aSide;
    vKind = aKind;
    vAge = aAge;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const frag = /* glsl */ `
  uniform vec3 uShadow;
  uniform vec3 uMid;
  uniform vec3 uLit;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uFade;
  uniform float uNow;
  varying float vSide;
  varying float vKind;
  varying float vAge;
  varying vec3 vWorld;
  void main() {
    float s = vSide;
    float a;
    vec3 col;
    if (vKind < 0.5) {
      // carve: a crisp groove
      a = 0.55 * (1.0 - smoothstep(0.45, 1.0, abs(s)));
      col = uShadow;
    } else if (vKind < 1.5) {
      // powder trench: a shadowed floor, snow thrown up on both sides, the sunny one bright
      float floor_ = 1.0 - smoothstep(0.15, 0.62, abs(s));
      float rim = smoothstep(0.55, 0.78, abs(s)) * (1.0 - smoothstep(0.82, 1.0, abs(s)));
      col = mix(uMid, uShadow, floor_ * 0.8);
      col = mix(col, s > 0.0 ? uLit : uMid, rim);
      a = 0.6 * floor_ + (s > 0.0 ? 0.6 : 0.3) * rim;
    } else {
      // skid: a wide scraped band, a touch shinier than the snow, with fine scratches
      float scratch = 0.5 + 0.5 * sin(s * 31.0);
      a = (0.14 + 0.08 * scratch) * (1.0 - smoothstep(0.55, 1.0, abs(s)));
      col = mix(uMid, uLit, 0.35);
    }
    // older tracks soften a little (wind, sun)
    float age = clamp((uNow - vAge) / 40.0, 0.0, 1.0);
    a *= mix(1.0, 0.65, age);
    float dist = length(cameraPosition - vWorld);
    a *= 1.0 - smoothstep(180.0, 420.0, dist);
    a *= uFade;
    if (a < 0.01) discard;
    col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

export class Tracks {
  constructor(hf) {
    this.hf = hf;
    this.x = new Float32Array(MAX);
    this.u = new Float32Array(MAX);
    this.kind = new Uint8Array(MAX);
    this.brk = new Uint8Array(MAX); // 1: a new strip starts here (no ribbon to the point before)
    this.age = new Float32Array(MAX); // which run (0, 1, 2...) for the gentle fading
    this.count = 0;
    this.runIndex = 0;
    this.open = false; // a strip is in progress
    this.tip = false; // the last point follows the skis (not yet a kept point)
    this.dirty = 0;
    this.version = 0;

    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 4 * 3);
    this.side = new Float32Array(MAX * 4);
    this.kindAttr = new Float32Array(MAX * 4);
    this.ageAttr = new Float32Array(MAX * 4);
    for (let i = 0; i < MAX; i++) {
      this.side.set([-1, 1, -1, 1], i * 4);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1));
    geo.setAttribute('aKind', new THREE.BufferAttribute(this.kindAttr, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAge', new THREE.BufferAttribute(this.ageAttr, 1).setUsage(THREE.DynamicDrawUsage));
    this.index = new Uint32Array(MAX * 12);
    geo.setIndex(new THREE.BufferAttribute(this.index, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;
    this.indexCount = 0;
    const c = (h) => new THREE.Color(h);
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      uniforms: {
        uShadow: { value: c(THEME.snow[2]) },
        uMid: { value: c(THEME.snow[1]) },
        uLit: { value: c('#ffffff') },
        uFog: { value: c(THEME.haze) },
        uFogNear: { value: 1400 },
        uFogFar: { value: 4200 },
        uFade: { value: 1 },
        uNow: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.sunX = SUN_DIR[0];
    this.fading = 0;
  }

  setFog(near, far) {
    this.material.uniforms.uFogNear.value = near;
    this.material.uniforms.uFogFar.value = far;
  }

  // a new run starts: its tracks are a little crisper than the older ones
  startRun() {
    this.runIndex++;
    this.material.uniforms.uNow.value = this.runIndex * 10;
    this.open = false;
    this.tip = false;
  }

  // the skis left the snow (a jump, a wipeout): the next point starts a new strip
  lift() {
    this.open = false;
    this.tip = false;
  }

  // record the skier's position; kind: 0 carve, 1 powder, 2 skid
  add(x, z, kind) {
    const u = z - this.hf.startZ;
    let n = this.count;
    if (this.open && this.tip && n > 1) {
      // the tip follows the skis until it's a step from the last kept point, then stays
      const dx = x - this.x[n - 2];
      const du = u - this.u[n - 2];
      if (dx * dx + du * du < STEP * STEP) {
        this.x[n - 1] = x;
        this.u[n - 1] = u;
        this.kind[n - 1] = kind;
        this.writePoint(n - 1);
        this.writePoint(n - 2);
        this.flush(n - 2);
        return;
      }
    } else if (this.open && n > 0) {
      const dx = x - this.x[n - 1];
      const du = u - this.u[n - 1];
      if (dx * dx + du * du < 0.01) return;
    }
    if (n >= MAX) {
      this.compact();
      n = this.count;
    }
    this.x[n] = x;
    this.u[n] = u;
    this.kind[n] = kind;
    this.brk[n] = this.open ? 0 : 1;
    this.age[n] = this.runIndex * 10;
    this.count++;
    this.tip = this.open;
    this.open = true;
    this.writePoint(n);
    if (n > 0) this.writePoint(n - 1);
    this.flush(Math.max(0, n - 1));
  }

  // drop the oldest half when full
  compact() {
    const keep = Math.floor(MAX / 2);
    const from = this.count - keep;
    this.x.copyWithin(0, from, this.count);
    this.u.copyWithin(0, from, this.count);
    this.kind.copyWithin(0, from, this.count);
    this.brk.copyWithin(0, from, this.count);
    this.age.copyWithin(0, from, this.count);
    this.count = keep;
    this.brk[0] = 1;
    this.redrape();
  }

  clear() {
    this.count = 0;
    this.open = false;
    this.tip = false;
    this.indexCount = 0;
    this.geo.setDrawRange(0, 0);
    this.version++;
  }

  // fresh snow: fade the tracks out, then clear them
  freshSnow() {
    if (!this.count) return false;
    this.fading = 1;
    return true;
  }

  update(dt) {
    if (this.fading > 0) {
      this.fading = Math.max(0, this.fading - dt / 1.6);
      this.material.uniforms.uFade.value = this.fading;
      if (this.fading === 0) {
        this.clear();
        this.material.uniforms.uFade.value = 1;
      }
    }
  }

  // ribbons: 4 vertices per point (two skis × two edges)
  writePoint(i) {
    const hf = this.hf;
    const x = this.x[i];
    const z = hf.startZ + this.u[i];
    // direction from the neighbours in the same strip
    const hasPrev = i > 0 && !this.brk[i];
    const hasNext = i + 1 < this.count && !this.brk[i + 1];
    const ax = hasPrev ? this.x[i - 1] : x;
    const az = hasPrev ? hf.startZ + this.u[i - 1] : z;
    const bx = hasNext ? this.x[i + 1] : x;
    const bz = hasNext ? hf.startZ + this.u[i + 1] : z;
    let dx = bx - ax;
    let dz = bz - az;
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) {
      dx = 0;
      dz = 1;
    } else {
      dx /= l;
      dz /= l;
    }
    // sideways, with +side towards the sun (so the powder rim lights up on the sunny side)
    let sx = -dz;
    let sz = dx;
    if (sx * this.sunX < 0) {
      sx = -sx;
      sz = -sz;
    }
    const K = KIND[this.kind[i]];
    const p = this.pos;
    let o = i * 12;
    for (const [c, w] of K) {
      for (const e of [-w / 2, w / 2]) {
        const px = x + sx * (c + e);
        const pz = z + sz * (c + e);
        p[o++] = px;
        p[o++] = hf.heightAtMesh(px, pz) + LIFT;
        p[o++] = pz;
      }
    }
    this.kindAttr.fill(this.kind[i], i * 4, i * 4 + 4);
    this.ageAttr.fill(this.age[i], i * 4, i * 4 + 4);
    // the two quads joining this point to the one before
    if (i > 0 && !this.brk[i]) {
      const a = (i - 1) * 4;
      const b = i * 4;
      const idx = this.index;
      let k = (i - 1) * 12;
      idx[k++] = a;
      idx[k++] = b;
      idx[k++] = a + 1;
      idx[k++] = a + 1;
      idx[k++] = b;
      idx[k++] = b + 1;
      idx[k++] = a + 2;
      idx[k++] = b + 2;
      idx[k++] = a + 3;
      idx[k++] = a + 3;
      idx[k++] = b + 2;
      idx[k++] = b + 3;
    } else if (i > 0) {
      this.index.fill(0, (i - 1) * 12, i * 12);
    }
  }

  // upload what changed from point `from` to the end. The ranges pile up until the next
  // frame uploads them all (three.js merges them, then clears them): several points can be
  // added between two frames, and clearing here would leave the earlier ones on the GPU as
  // zeros (ribbons shooting off to the origin, gaps in the tracks)
  flush(from = 0) {
    const g = this.geo;
    const n = this.count;
    const upd = (attr, per) => {
      attr.addUpdateRange(from * per, (n - from) * per);
      attr.needsUpdate = true;
    };
    upd(g.attributes.position, 12);
    upd(g.attributes.aKind, 4);
    upd(g.attributes.aAge, 4);
    const ia = g.index;
    const i0 = Math.max(0, from - 1) * 12;
    ia.addUpdateRange(i0, Math.max(0, (n - 1) * 12 - i0));
    ia.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, (n - 1) * 12));
    this.version++;
  }

  // the snow changed under the tracks (a rebuilt run, sculpting): lay them on it again
  redrape() {
    for (let i = 0; i < this.count; i++) this.writePoint(i);
    this.flush(0);
  }

  // ---------- saving ----------

  pack() {
    const n = this.count;
    const a = new Int16Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = Math.round(this.x[i] * 20);
      a[i * 3 + 1] = Math.round(Math.min(4095, Math.max(-60, this.u[i])) * 8);
      a[i * 3 + 2] = this.kind[i] | (this.brk[i] << 2) | (Math.min(255, this.runIndex - this.age[i] / 10) << 3);
    }
    const bytes = new Uint8Array(a.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  unpack(str) {
    try {
      const bin = atob(str);
      const bytes = new Uint8Array(bin.length - (bin.length % 6));
      for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
      const a = new Int16Array(bytes.buffer);
      const n = Math.min(MAX, a.length / 3);
      this.runIndex = 300;
      for (let i = 0; i < n; i++) {
        this.x[i] = a[i * 3] / 20;
        this.u[i] = a[i * 3 + 1] / 8;
        const f = a[i * 3 + 2];
        this.kind[i] = Math.min(2, f & 3);
        this.brk[i] = (f >> 2) & 1;
        this.age[i] = (this.runIndex - ((f >> 3) & 255)) * 10;
      }
      this.brk[0] = 1;
      this.count = n;
      this.open = false;
      this.tip = false;
      this.material.uniforms.uNow.value = this.runIndex * 10;
      this.redrape();
      return true;
    } catch {
      return false;
    }
  }
}
