import * as THREE from 'three';
import { THEME, SUN_DIR, CUT_SHADOW, CUT_LIT } from './theme.js';
import { lightUniforms, shadowVertPars, shadowVert, shadowFragPars } from './toon.js';

// Terrain rendered as a diorama slab: the sculptable top surface plus four
// stratified side walls of constant thickness, so the long piste reads as an object
// you own (a tilted slab rather than a 500 m tall block).

export const THICKNESS = 34;

const vert = /* glsl */ `
  ${shadowVertPars}
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vec3 nw = normalize(mat3(modelMatrix) * normal);
    vNormal = nw;
    ${shadowVert}
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const sideVert = /* glsl */ `
  attribute float aDepth;
  attribute float aTop;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepth;
  varying float vTop;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vDepth = aDepth;
    vTop = aTop;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const frag = /* glsl */ `
  ${shadowFragPars}
  uniform vec3 uSunDir;
  uniform vec3 uSnowLit;
  uniform vec3 uSnowMid;
  uniform vec3 uSnowShadow;
  uniform vec3 uRockLit;
  uniform vec3 uRockMid;
  uniform vec3 uRockShadow;
  uniform vec3 uInk;
  uniform float uCutShadow;
  uniform float uCutLit;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uBrushPos;
  uniform float uBrushRadius;
  uniform float uBrushOn;
  uniform vec3 uBrushColor;
  uniform float uFinishZ;
  uniform vec2 uStart;
  uniform float uContours;
  uniform float uRelief;
  uniform sampler2D uLocalMean;
  uniform vec2 uHalf;
  uniform vec2 uLocalSize;

  // Manual bilinear lookup: iPhones can't filter float textures in hardware (they read
  // back as zero with linear filtering), so the texture uses nearest and we blend here.
  float localMeanAt(vec2 uv) {
    vec2 p = uv * uLocalSize - 0.5;
    vec2 f = fract(p);
    vec2 b = (floor(p) + 0.5) / uLocalSize;
    vec2 t = 1.0 / uLocalSize;
    float a = texture2D(uLocalMean, b).r;
    float c = texture2D(uLocalMean, b + vec2(t.x, 0.0)).r;
    float d = texture2D(uLocalMean, b + vec2(0.0, t.y)).r;
    float e = texture2D(uLocalMean, b + t).r;
    return mix(mix(a, c, f.x), mix(d, e, f.x), f.y);
  }
  varying vec3 vWorld;
  varying vec3 vNormal;

  // diverging ramp for local relief: hollows cool blue, flat pale, crests warm orange
  vec3 reliefRamp(float k) {
    vec3 deep = vec3(0.13, 0.33, 0.66);
    vec3 low = vec3(0.47, 0.70, 0.90);
    vec3 mid = vec3(0.93, 0.94, 0.90);
    vec3 high = vec3(0.98, 0.70, 0.38);
    vec3 peak = vec3(0.80, 0.30, 0.12);
    if (k < 0.0) return k < -0.5 ? mix(low, deep, (-k - 0.5) * 2.0) : mix(mid, low, -k * 2.0);
    return k > 0.5 ? mix(high, peak, (k - 0.5) * 2.0) : mix(mid, high, k * 2.0);
  }

  float hash2(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float aaLine(float v, float spacing, float width) {
    float f = abs(fract(v / spacing - 0.5) - 0.5) * spacing;
    float w = fwidth(v) * width;
    return 1.0 - smoothstep(0.0, w, f);
  }

  void main() {
    vec3 n = normalize(vNormal);
    float slope = 1.0 - n.y; // 0 flat .. 1 vertical

    // Cartoon light: three flat bands (0 shadow, 1 mid, 2 lit).
    // The broad band comes from the slope smoothed over ~40 m, so it only changes where the
    // run really gets steeper or flatter; small natural bumps can't flip it into blotches.
    // Features that stand out from that (a kicker, a berm, a roller) then step one band up
    // on their sunny side and one down on the other.
    vec3 L = normalize(uSunDir);
    vec2 uvc = clamp((vWorld.xz + uHalf) / (2.0 * uHalf), 0.0, 1.0);
    vec2 du = vec2(8.0 / (2.0 * uHalf.x), 0.0);
    vec2 dv = vec2(0.0, 8.0 / (2.0 * uHalf.y));
    float gx = (localMeanAt(uvc + du) - localMeanAt(uvc - du)) / 16.0;
    float gz = (localMeanAt(uvc + dv) - localMeanAt(uvc - dv)) / 16.0;
    vec3 ns = normalize(vec3(-gx, 1.0, -gz));
    float ndlS = dot(ns, L);
    float ndl = dot(n, L);
    float aaS = fwidth(ndlS) + 0.002;
    float aa = fwidth(ndl) + 0.003;
    float level = smoothstep(uCutShadow - aaS, uCutShadow + aaS, ndlS) + smoothstep(uCutLit - aaS, uCutLit + aaS, ndlS);
    float rel = ndl - ndlS;
    level += smoothstep(0.17 - aa, 0.17 + aa, rel) - smoothstep(0.17 - aa, 0.17 + aa, -rel);
    // faces turned right away from the sun are always in shadow
    level = min(level, 2.0 * smoothstep(0.02 - aa, 0.02 + aa, ndl));
    // shadows cast by trees, the rider and the terrain drop into the shadow band
    level = clamp(level, 0.0, 2.0) * smoothstep(0.35, 0.65, sunShadow());
    vec3 snow = level < 1.0 ? mix(uSnowShadow, uSnowMid, level) : mix(uSnowMid, uSnowLit, level - 1.0);
    vec3 rock = level < 1.0 ? mix(uRockShadow, uRockMid, level) : mix(uRockMid, uRockLit, level - 1.0);
    // rock only on faces steeper than any drawn run (over about 71 degrees: sculpted walls): every
    // drawn face is skiable, so it reads as snow; the edge is a clean cut with a thin ink line
    float aas = fwidth(slope) + 0.002;
    float rockAmt = smoothstep(0.68 - aas, 0.68 + aas, slope);
    vec3 col = mix(snow, rock, rockAmt);
    col = mix(col, uInk, (1.0 - smoothstep(0.0, aas * 1.6, abs(slope - 0.68))) * 0.55);

    // ink along crests and lips seen edge-on: where the surface turns away from the camera
    // fast (a kicker lip, the top of a roller), not on broad slopes merely seen at an angle
    vec3 vdir = normalize(cameraPosition - vWorld);
    float nv = dot(n, vdir);
    float dnv = fwidth(nv);
    float crest = (1.0 - smoothstep(dnv * 1.2, dnv * 2.6, nv)) * smoothstep(0.01, 0.03, dnv);
    col = mix(col, uInk, crest * 0.85 * (1.0 - uRelief));

    if (uRelief > 0.5) {
      // Relief view: colour by height above/below the surrounding terrain (a ~50 m blur),
      // shade from two low suns so every bump casts a readable shadow
      vec2 uv = clamp((vWorld.xz + uHalf) / (2.0 * uHalf), 0.0, 1.0);
      float local = vWorld.y - localMeanAt(uv);
      float k = clamp(local / 8.0, -1.0, 1.0);
      k = sign(k) * pow(abs(k), 0.7);
      vec3 tint = reliefRamp(k);
      vec3 l1 = normalize(vec3(-0.75, 0.42, -0.5));
      vec3 l2 = normalize(vec3(0.6, 0.5, -0.62));
      float shade = 0.5 * clamp(dot(n, l1), 0.0, 1.0) + 0.35 * clamp(dot(n, l2), 0.0, 1.0) + 0.32;
      // steepness darkens, so cliffs and kicker lips pop
      shade *= 1.0 - 0.45 * smoothstep(0.08, 0.55, slope);
      col = tint * shade * 1.15;
      float fwr = fwidth(vWorld.y);
      float r1 = aaLine(vWorld.y, 2.0, 1.0) * (1.0 - smoothstep(0.5, 1.2, fwr));
      float r2 = aaLine(vWorld.y, 10.0, 1.4) * (1.0 - smoothstep(2.5, 6.0, fwr));
      col *= 1.0 - 0.18 * r1 - 0.38 * r2;
    }

    // topographic contours: fine every 5 m, bold every 25 m; fine lines fade out
    // when zoomed far back so the long piste doesn't turn grey
    float fw = fwidth(vWorld.y);
    float c1 = aaLine(vWorld.y, 5.0, 1.0) * (1.0 - smoothstep(0.6, 1.6, fw));
    float c2 = aaLine(vWorld.y, 25.0, 1.6) * (1.0 - smoothstep(4.0, 9.0, fw));
    float cw = uContours * (1.0 - uRelief);
    col = mix(col, uInk, c1 * 0.12 * cw);
    col = mix(col, uInk, c2 * 0.24 * cw);

    // finish line: dashed band across the slope
    float fz = abs(vWorld.z - uFinishZ);
    float dash = step(0.5, fract(vWorld.x / 6.0));
    col = mix(col, mix(vec3(0.95, 0.3, 0.12), vec3(0.12, 0.14, 0.18), dash), (1.0 - smoothstep(0.8, 1.2, fz)) * 0.9);

    // start marker ring
    float sd = length(vWorld.xz - uStart);
    col = mix(col, vec3(0.16, 0.42, 0.85), (1.0 - smoothstep(0.25, 0.6, abs(sd - 4.0))) * 0.9);

    // brush cursor: soft fill + crisp ring
    if (uBrushOn > 0.5) {
      float d = length(vWorld.xz - uBrushPos.xz);
      float r = uBrushRadius;
      float ring = 1.0 - smoothstep(0.0, fwidth(d) * 1.5 + 0.12, abs(d - r));
      float inner = 1.0 - smoothstep(0.0, r, d);
      col = mix(col, uBrushColor, inner * inner * 0.18);
      col = mix(col, uBrushColor, ring * 0.9);
      float dot0 = 1.0 - smoothstep(0.25, 0.45, d);
      col = mix(col, uBrushColor, dot0);
    }

    float dist = length(cameraPosition - vWorld);

    // close-up snow texture: soft grain, wind ripples and sparkles; it's what makes
    // speed readable when the camera skims the surface
    float near = (1.0 - smoothstep(25.0, 140.0, dist)) * (1.0 - uRelief);
    if (near > 0.0) {
      // fine grain fades out before it gets small enough on screen to shimmer
      float fine = 1.0 - smoothstep(0.15, 0.5, length(fwidth(vWorld.xz * 5.3)));
      float grain = vnoise(vWorld.xz * 1.7) * 0.6 + (vnoise(vWorld.xz * 5.3) - 0.5) * 0.4 * fine + 0.2;
      float ripple = vnoise(vec2(vWorld.x * 0.35 + vWorld.z * 0.12, vWorld.z * 2.2));
      col *= 1.0 + near * ((grain - 0.5) * 0.05 + (ripple - 0.5) * 0.04);
      // tiny sparkles, only right by the camera (larger ones read as road markings)
      vec2 sc = vWorld.xz * 18.0;
      float spark = step(0.992, hash2(floor(sc))) * (1.0 - smoothstep(0.15, 0.45, length(fract(sc) - 0.5)));
      col += spark * max(0.0, ndl) * 0.3 * (1.0 - smoothstep(6.0, 30.0, dist));
    }

    float fog = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFog, fog);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const sideFrag = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uSnowLit;
  uniform vec3 uSnowMid;
  uniform vec3 uInk;
  uniform vec3 uStrata0;
  uniform vec3 uStrata1;
  uniform vec3 uStrata2;
  uniform vec3 uStrata3;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepth;
  varying float vTop;
  void main() {
    vec3 n = normalize(vNormal);
    float s = vWorld.x + vWorld.z;          // distance along the wall
    float below = vTop - vWorld.y;          // metres under the top edge
    // rock layers, gently tilted
    float b = fract((vWorld.y + 0.06 * s) / 22.0);
    vec3 col = b < 0.38 ? uStrata0 : b < 0.55 ? uStrata1 : b < 0.8 ? uStrata2 : uStrata3;
    // snow hanging over the rim like icing, with a drippy edge
    float drip = 2.4 + 0.9 * sin(s * 0.21) + 4.0 * pow(max(0.0, sin(s * 0.73 + 1.0)), 6.0);
    float ab = fwidth(below) + 0.01;
    float icing = 1.0 - smoothstep(drip - ab, drip + ab, below);
    float lit = step(0.15, dot(n, normalize(uSunDir)));
    col = mix(col, mix(uSnowMid, uSnowLit, lit), icing);
    // faces turned from the sun drop into a cool shadow band
    col *= mix(vec3(0.7, 0.68, 0.86), vec3(1.0), lit);
    // ink: under the icing and along the rim
    float line = 1.0 - smoothstep(ab * 1.0, ab * 2.2, abs(below - drip));
    line = max(line, 1.0 - smoothstep(ab * 1.5, ab * 3.0, below));
    col = mix(col, uInk, line);
    float dist = length(cameraPosition - vWorld);
    col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class TerrainMesh {
  constructor(hf, { finishZ, start }) {
    this.hf = hf;
    const { nx, nz } = hf;
    this.group = new THREE.Group();

    // --- top surface ---
    const count = nx * nz;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const [x, z] = hf.toWorld(i, j);
        positions[k * 3] = x;
        positions[k * 3 + 2] = z;
      }
    }
    const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        index[p++] = a;
        index[p++] = c;
        index[p++] = b;
        index[p++] = b;
        index[p++] = c;
        index[p++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const bound = new THREE.Sphere(new THREE.Vector3(0, 200, 0), Math.hypot(hf.halfX, hf.halfZ, 400));
    geo.boundingSphere = bound;
    this.geo = geo;

    const sunDir = new THREE.Vector3(...SUN_DIR).normalize();
    const T = THEME;
    const c = (hex) => new THREE.Color(hex);
    this.uniforms = {
      uSunDir: { value: sunDir },
      uSnowLit: { value: c(T.snow[0]) },
      uSnowMid: { value: c(T.snow[1]) },
      uSnowShadow: { value: c(T.snow[2]) },
      uRockLit: { value: c(T.rock[0]) },
      uRockMid: { value: c(T.rock[1]) },
      uRockShadow: { value: c(T.rock[2]) },
      uInk: { value: c(T.ink) },
      uCutShadow: { value: CUT_SHADOW },
      uCutLit: { value: CUT_LIT },
      uStrata0: { value: c(T.strata[0]) },
      uStrata1: { value: c(T.strata[1]) },
      uStrata2: { value: c(T.strata[2]) },
      uStrata3: { value: c(T.strata[3]) },
      uFog: { value: c(T.haze) },
      // fog scales with the run so long runs fade into the distance, not into a wall
      uFogNear: { value: Math.max(1400, hf.sizeZ * 1.2) },
      uFogFar: { value: Math.max(4200, hf.sizeZ * 3.5) },
      uBrushPos: { value: new THREE.Vector3() },
      uBrushRadius: { value: 12 },
      uBrushOn: { value: 0 },
      uBrushColor: { value: new THREE.Color('#ff5a1f') },
      uFinishZ: { value: finishZ },
      uStart: { value: new THREE.Vector2(start.x, start.z) },
      uContours: { value: 1 },
      uRelief: { value: 0 },
      uLocalMean: { value: null },
      uHalf: { value: new THREE.Vector2(hf.halfX, hf.halfZ) },
      uLocalSize: { value: new THREE.Vector2(1, 1) },
    };
    // blurred copy of the terrain at 1/6 resolution: the "surroundings" the relief view
    // compares each point against
    this.ds = 6;
    this.lx = Math.ceil(hf.nx / this.ds);
    this.lz = Math.ceil(hf.nz / this.ds);
    this.low = new Float32Array(this.lx * this.lz);
    this.lowTmp = new Float32Array(this.lx * this.lz);
    this.localMean = new Float32Array(this.lx * this.lz);
    this.localTex = new THREE.DataTexture(this.localMean, this.lx, this.lz, THREE.RedFormat, THREE.FloatType);
    this.localTex.magFilter = THREE.NearestFilter;
    this.localTex.minFilter = THREE.NearestFilter;
    this.localTex.generateMipmaps = false;
    this.uniforms.uLocalSize.value.set(this.lx, this.lz);
    this.uniforms.uLocalMean.value = this.localTex;
    this.localDirty = true;
    Object.assign(this.uniforms, lightUniforms());
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
      lights: true,
    });
    this.top = new THREE.Mesh(geo, this.material);
    this.top.receiveShadow = true;
    this.group.add(this.top);

    // --- side walls (4 strips: top edge vertex + base vertex) ---
    this.sides = [];
    const sideMat = new THREE.ShaderMaterial({
      vertexShader: sideVert,
      fragmentShader: sideFrag,
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
    });
    // 0: top end (z=-half), 1: bottom end (z=+half), 2: left edge, 3: right edge
    this.sideDefs = [
      { n: nx, cell: (t) => [t, 0], dir: [0, 0, -1] },
      { n: nx, cell: (t) => [t, nz - 1], dir: [0, 0, 1] },
      { n: nz, cell: (t) => [0, t], dir: [-1, 0, 0] },
      { n: nz, cell: (t) => [nx - 1, t], dir: [1, 0, 0] },
    ];
    for (const def of this.sideDefs) {
      const len = def.n;
      const pos = new Float32Array(len * 2 * 3);
      const nor = new Float32Array(len * 2 * 3);
      const depth = new Float32Array(len * 2);
      for (let t = 0; t < len; t++) depth[t * 2 + 1] = 1;
      const top = new Float32Array(len * 2);
      const idx = [];
      for (let i = 0; i < len - 1; i++) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        idx.push(a, b, c, c, b, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
      g.setAttribute('aTop', new THREE.BufferAttribute(top, 1).setUsage(THREE.DynamicDrawUsage));
      g.setIndex(idx);
      g.boundingSphere = bound;
      const m = new THREE.Mesh(g, sideMat);
      this.sides.push(m);
      this.group.add(m);
    }

    this.updateAll();
    this.refreshLocalMean();
  }

  setRelief(on) {
    this.uniforms.uRelief.value = on ? 1 : 0;
  }

  // Recompute the blurred surroundings (cheap: ~7k cells), at most once per frame
  refreshLocalMean() {
    if (!this.localDirty) return;
    const now = performance.now();
    if (this.lastLocal && now - this.lastLocal < 120) return;
    this.lastLocal = now;
    this.localDirty = false;
    const { hf, ds, lx, lz, low, lowTmp, localMean } = this;
    for (let j = 0; j < lz; j++) {
      for (let i = 0; i < lx; i++) low[j * lx + i] = hf.heightAtCell(i * ds + ds / 2, j * ds + ds / 2);
    }
    // separable box blur, radius ~4 cells (~36 m) x2 passes ≈ gaussian
    const R = 4;
    const pass = (src, dst, alongX) => {
      for (let j = 0; j < lz; j++) {
        for (let i = 0; i < lx; i++) {
          let sum = 0;
          let n = 0;
          for (let d = -R; d <= R; d++) {
            const ii = alongX ? i + d : i;
            const jj = alongX ? j : j + d;
            if (ii < 0 || jj < 0 || ii >= lx || jj >= lz) continue;
            sum += src[jj * lx + ii];
            n++;
          }
          dst[j * lx + i] = sum / n;
        }
      }
    };
    pass(low, lowTmp, true);
    pass(lowTmp, localMean, false);
    pass(localMean, lowTmp, true);
    pass(lowTmp, localMean, false);
    this.localTex.needsUpdate = true;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.material.dispose();
    this.sides[0]?.material.dispose();
    this.localTex.dispose();
  }

  setStart(x, z) {
    this.uniforms.uStart.value.set(x, z);
  }

  setBrush(on, x = 0, y = 0, z = 0, radius = 10) {
    this.uniforms.uBrushOn.value = on ? 1 : 0;
    if (on) {
      this.uniforms.uBrushPos.value.set(x, y, z);
      this.uniforms.uBrushRadius.value = radius;
    }
  }

  updateAll() {
    this.update({ i0: 0, i1: this.hf.nx - 1, j0: 0, j1: this.hf.nz - 1 });
  }

  // Refresh heights + normals inside a dirty grid rectangle
  update(rect) {
    const { hf } = this;
    const res = hf.nx;
    const pos = this.geo.attributes.position.array;
    const nor = this.geo.attributes.normal.array;
    const i0 = Math.max(0, rect.i0 - 1);
    const i1 = Math.min(hf.nx - 1, rect.i1 + 1);
    const j0 = Math.max(0, rect.j0 - 1);
    const j1 = Math.min(hf.nz - 1, rect.j1 + 1);
    const c2 = 2 * hf.cell;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * res + i;
        pos[k * 3 + 1] = hf.h[k];
        const dx = (hf.heightAtCell(i + 1, j) - hf.heightAtCell(i - 1, j)) / c2;
        const dz = (hf.heightAtCell(i, j + 1) - hf.heightAtCell(i, j - 1)) / c2;
        const len = Math.hypot(dx, 1, dz);
        nor[k * 3] = -dx / len;
        nor[k * 3 + 1] = 1 / len;
        nor[k * 3 + 2] = -dz / len;
      }
    }
    this.localDirty = true;
    // upload only the touched rows: a full-mesh upload every frame stutters on phones
    const start = j0 * res * 3;
    const count = (j1 - j0 + 1) * res * 3;
    for (const attr of [this.geo.attributes.position, this.geo.attributes.normal]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(start, count);
      attr.needsUpdate = true;
    }
    if (i0 === 0 || j0 === 0 || i1 === hf.nx - 1 || j1 === hf.nz - 1) this.updateSides();
  }

  updateSides() {
    const { hf } = this;
    this.sideDefs.forEach((d, s) => {
      const g = this.sides[s].geometry;
      const pos = g.attributes.position.array;
      const nor = g.attributes.normal.array;
      const top = g.attributes.aTop.array;
      for (let t = 0; t < d.n; t++) {
        const [i, j] = d.cell(t);
        const [x, z] = hf.toWorld(i, j);
        const y = hf.h[j * hf.nx + i];
        // the slab's underside follows the long profile (smoothed via the centre column)
        const yBase = Math.min(y, hf.heightAt(0, z)) - THICKNESS;
        top[t * 2] = top[t * 2 + 1] = y;
        const a = t * 6;
        pos[a] = x;
        pos[a + 1] = y;
        pos[a + 2] = z;
        pos[a + 3] = x;
        pos[a + 4] = yBase;
        pos[a + 5] = z;
        nor[a] = nor[a + 3] = d.dir[0];
        nor[a + 1] = nor[a + 4] = d.dir[1];
        nor[a + 2] = nor[a + 5] = d.dir[2];
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.normal.needsUpdate = true;
      g.attributes.aTop.needsUpdate = true;
    });
  }
}
