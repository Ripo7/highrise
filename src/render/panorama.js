// The world beyond the slope: the mountain floats high over a sea of clouds, and ranges of
// low-poly peaks rise out of it all round, the far ones higher, so they stack up in rows.
//
//   peaks   a ring of real 3D relief (ridged noise on a polar grid), shaded like the rest of
//           the art: three flat bands from the sun on faceted faces, snow with rock on the
//           steep faces, their feet dissolving into the cloud tops
//   clouds  a disc at the cloud level: billows lit from the sun, cool in their hollows,
//           drifting slowly on the wind
//
// Both fade with distance into the sky right behind them (the sky's own gradient, worked
// out the same way per pixel), so they sit in the air rather than in front of it. The cloud
// level follows the slope: a few hundred metres below its lowest snow (place()).
// The colours are the light's (light.js) and the sky's, so a preset changes them with
// everything else.

import * as THREE from 'three';
import { LIGHT } from './light.js';
import { ATMO, cloudPars } from './atmosphere.js';
import { CUT_SHADOW, CUT_LIT } from './theme.js';

const R0 = 3600; // the ring of peaks: inner radius (m)
const R1 = 13000; // outer
const ANGLES = 288;
const RINGS = 22;
const CLOUD_R = 26000; // the sea of clouds reaches this far

// deterministic value noise (the same mountains every time)
function hash(x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// ridged: sharp crests, broad valleys
function ridged(x, y) {
  let f = 0;
  let amp = 0.55;
  let freq = 1;
  let weight = 1;
  for (let k = 0; k < 5; k++) {
    let n = 1 - Math.abs(2 * vnoise(x * freq + k * 17.3, y * freq - k * 9.1) - 1);
    n *= n * weight;
    weight = Math.min(1, n * 1.6);
    f += n * amp;
    freq *= 2.1;
    amp *= 0.48;
  }
  return f;
}
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// metres above the cloud level at (x, z) on the ring
export function peakHeight(x, z) {
  const r = Math.hypot(x, z);
  // rising out of the clouds past the inner edge; the far rows taller, so they show over
  // the near ones
  const env = smooth(R0, R0 + 1800, r) * (0.45 + 0.55 * smooth(R0, R1 * 0.8, r)) * (1 - smooth(R1 * 0.8, R1, r));
  const n = ridged(x / 2600, z / 2600);
  // a few big summits, far off
  const big = Math.pow(vnoise(x / 6000 + 3.1, z / 6000 - 7.7), 3) * smooth(R0 + 2000, R1 * 0.7, r);
  return -220 + env * (n * 760 + big * 1500);
}

const mountVert = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// the sky behind a pixel, as sky.js draws it (linear)
const skyBehind = /* glsl */ `
  uniform vec3 uTopS;
  uniform vec3 uHorizonS;
  uniform float uViewH;
  vec3 skyBehind() {
    float y = 1.0 - gl_FragCoord.y / uViewH;
    vec3 g = mix(uTopS, uHorizonS, clamp(y / 0.7, 0.0, 1.0));
    return mix(g * 0.0773993808, pow((g + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), g));
  }
`;

const mountFrag = /* glsl */ `
  ${skyBehind}
  uniform vec3 uSunDir;
  uniform vec3 uSnowLit;
  uniform vec3 uSnowMid;
  uniform vec3 uSnowShadow;
  uniform vec3 uRockLit;
  uniform vec3 uRockMid;
  uniform vec3 uRockShadow;
  uniform vec3 uFog;
  uniform vec3 uCloudLit;
  uniform float uCloudY;
  uniform float uShadowAmt;
  uniform float uCutShadow;
  uniform float uCutLit;
  varying vec3 vWorld;
  void main() {
    // faceted: one normal per triangle, the low-poly look of the trees and rocks
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (n.y < 0.0) n = -n;
    vec3 L = normalize(uSunDir);
    float ndl = dot(n, L);
    // soft light (overcast) closes the bands up, as on the snow
    float lit = smoothstep(uCutLit - 0.02, uCutLit + 0.02, ndl);
    float mid = smoothstep(uCutShadow - 0.02, uCutShadow + 0.02, ndl);
    lit = mix(0.5, lit, uShadowAmt * 0.6 + 0.4);
    vec3 snow = mix(uSnowShadow, mix(uSnowMid, uSnowLit, lit), mid);
    // (far rock is half snow-dusted: lone dark facets read as holes at this distance)
    vec3 rock = mix(mix(uRockShadow, mix(uRockMid, uRockLit, lit), mid), snow, 0.4);
    // bare rock on the steep faces, more of it lower down
    float steep = 1.0 - n.y;
    float rocky = smoothstep(0.54, 0.62, steep + 0.1 * (1.0 - smoothstep(0.0, 700.0, vWorld.y - uCloudY)));
    vec3 col = mix(snow, rock, rocky);
    // the air: hazy at a few kilometres, then into the sky behind
    float d = length(vWorld - cameraPosition);
    col = mix(col, uFog, 0.22 + 0.34 * smoothstep(3000.0, 12000.0, d));
    col = mix(col, skyBehind(), smoothstep(6000.0, 18000.0, d) * 0.85);
    // the feet in the clouds
    col = mix(col, uCloudLit, smoothstep(uCloudY + 90.0, uCloudY - 20.0, vWorld.y));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const cloudVert = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const cloudFrag = /* glsl */ `
  ${cloudPars}
  ${skyBehind}
  uniform vec3 uSunDir;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudDark;
  uniform vec3 uSunCol;
  uniform float uShadowAmt;
  uniform vec4 uSlab; // the slope's footprint: centre x, z, half width, half length
  uniform float uSlabY; // its mean height
  uniform float uCloudY;
  uniform float uRelief; // 1: the heaps lit from their slopes; 0 (Low): flat, cheaper
  varying vec3 vWorld;
  // billow height: big rounded heaps with smaller ones on them
  float billow(vec2 p) {
    float f = cNoise(p) * 0.6 + cNoise(p * 2.3 + 7.1) * 0.28 + cNoise(p * 5.1 - 3.3) * 0.12;
    return f;
  }
  void main() {
    float d = length(vWorld - cameraPosition);
    vec2 p = (vWorld.xz + uCloudOff * 0.35) / 640.0;
    float f = billow(p);
    // lit from its slope, as if the heaps were relief (fine detail only up close)
    vec3 n = vec3(0.0, 1.0, 0.0);
    if (uRelief > 0.5) {
      float e = 0.06;
      float fx = billow(p + vec2(e, 0.0));
      float fz = billow(p + vec2(0.0, e));
      n = normalize(vec3(-(fx - f) * 9.0, 1.0, -(fz - f) * 9.0));
    }
    vec3 L = normalize(uSunDir);
    float ndl = dot(n, L);
    float aa = fwidth(ndl) + 0.02;
    float lit = smoothstep(0.42 - aa, 0.42 + aa, ndl) * mix(0.4, 1.0, uShadowAmt);
    // the hollows between heaps sink into a cool shade
    float hollow = 1.0 - smoothstep(0.32, 0.55, f);
    vec3 col = mix(uCloudDark, uCloudLit, 0.55 + 0.45 * lit);
    // the low light warms the tops (golden hour's peach horizon; grey under an overcast sky)
    vec3 hz = mix(uHorizonS * 0.0773993808, pow((uHorizonS + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), uHorizonS));
    col = mix(col, col * hz * 1.08, 0.35 * (0.4 + 0.6 * lit));
    col = mix(col, uCloudDark * 0.9, hollow * 0.7);
    // the slope's own shadow on the clouds below it, along the sun
    vec2 up = vWorld.xz + L.xz / max(L.y, 0.15) * (uSlabY - uCloudY);
    vec2 q = abs(up - uSlab.xy) - uSlab.zw;
    float inSlab = 1.0 - smoothstep(-40.0, 60.0, max(q.x, q.y));
    col = mix(col, uCloudDark * 0.82, inSlab * 0.55 * uShadowAmt);
    // the sun glancing off the tops towards it
    vec3 vd = normalize(cameraPosition - vWorld);
    col += uSunCol * pow(max(0.0, dot(reflect(-L, n), vd)), 24.0) * 0.12 * uShadowAmt;
    // far off, into the sky behind (the horizon)
    col = mix(col, skyBehind(), smoothstep(4500.0, 22000.0, d));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Panorama {
  // sky: the Sky (its gradient and cloud colours are shared, so the light sets them once)
  constructor(sky) {
    this.group = new THREE.Group();
    const su = sky.uniforms;
    const shared = {
      uTopS: su.uTopS,
      uHorizonS: su.uHorizonS,
      uViewH: su.uViewH,
      uCloudLit: su.uCloudLit,
      uCloudDark: su.uCloudDark,
      uSunCol: su.uSunCol,
      uSunDir: LIGHT.uSunDir,
      uShadowAmt: LIGHT.uShadowAmt,
      uCloudY: { value: 0 },
    };
    this.uCloudY = shared.uCloudY;

    // the peaks
    const pos = new Float32Array((ANGLES + 1) * RINGS * 3);
    let o = 0;
    for (let j = 0; j < RINGS; j++) {
      // rings closer together near the inside (where they're seen up close)
      const t = j / (RINGS - 1);
      const r = R0 + (R1 - R0) * t * t * (0.6 + 0.4 * t) * 1.0;
      for (let i = 0; i <= ANGLES; i++) {
        const a = ((i % ANGLES) / ANGLES) * Math.PI * 2;
        // a little jitter so the grid doesn't show as rings and spokes
        const jr = r + (j > 0 && j < RINGS - 1 ? (hash(i, j) - 0.5) * (R1 - R0) / RINGS * 0.6 : 0);
        const ja = a + (hash(j, i + 99) - 0.5) * ((Math.PI * 2) / ANGLES) * 0.5 * (i % ANGLES ? 1 : 0);
        const x = Math.cos(ja) * jr;
        const z = Math.sin(ja) * jr;
        pos[o++] = x;
        pos[o++] = peakHeight(x, z);
        pos[o++] = z;
      }
    }
    // the seam: the last column is the first one again
    for (let j = 0; j < RINGS; j++) {
      const a = (j * (ANGLES + 1)) * 3;
      const b = (j * (ANGLES + 1) + ANGLES) * 3;
      pos[b] = pos[a];
      pos[b + 1] = pos[a + 1];
      pos[b + 2] = pos[a + 2];
    }
    const idx = [];
    for (let j = 0; j < RINGS - 1; j++) {
      for (let i = 0; i < ANGLES; i++) {
        const a = j * (ANGLES + 1) + i;
        const b = a + 1;
        const c = a + ANGLES + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    this.peaks = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: mountVert,
        fragmentShader: mountFrag,
        side: THREE.DoubleSide,
        fog: false,
        uniforms: {
          ...shared,
          uSnowLit: LIGHT.uSnowLit,
          uSnowMid: LIGHT.uSnowMid,
          uSnowShadow: LIGHT.uSnowShadow,
          uRockLit: LIGHT.uRockLit,
          uRockMid: LIGHT.uRockMid,
          uRockShadow: LIGHT.uRockShadow,
          uFog: LIGHT.uFog,
          uCutShadow: { value: CUT_SHADOW },
          uCutLit: { value: CUT_LIT },
        },
      })
    );
    this.peaks.frustumCulled = false;
    this.peaks.renderOrder = -800;

    // the sea of clouds
    const disc = new THREE.CircleGeometry(CLOUD_R, 96);
    disc.rotateX(-Math.PI / 2);
    this.clouds = new THREE.Mesh(
      disc,
      new THREE.ShaderMaterial({
        vertexShader: cloudVert,
        fragmentShader: cloudFrag,
        fog: false,
        depthWrite: false,
        uniforms: { ...shared, ...ATMO, uSlab: { value: new THREE.Vector4(0, 0, 1, 1) }, uSlabY: { value: 0 }, uRelief: { value: 1 } },
      })
    );
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -900;
    this.group.add(this.clouds, this.peaks);
    this.group.matrixAutoUpdate = false;
    this.place(0);
  }

  // the picture quality: the cloud tops lit as relief (Medium, High) or flat (Low)
  setDetail(on) {
    this.clouds.material.uniforms.uRelief.value = on ? 1 : 0;
  }

  // the cloud level (m): everything here sits on it
  place(cloudY) {
    this.uCloudY.value = cloudY;
    this.group.position.set(0, cloudY, 0);
    this.group.updateMatrix();
    this.group.updateMatrixWorld(true);
  }

  // where the clouds go for this slope: a few hundred metres below its lowest snow
  placeUnder(hf) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < hf.h.length; k += 5) {
      lo = Math.min(lo, hf.h[k]);
      hi = Math.max(hi, hf.h[k]);
    }
    if (!Number.isFinite(lo)) return;
    this.place(Math.round(lo - 320 - 0.2 * (hi - lo)));
    const u = this.clouds.material.uniforms;
    u.uSlab.value.set(0, 0, hf.halfX, hf.halfZ);
    u.uSlabY.value = (lo + hi) / 2;
  }
}
