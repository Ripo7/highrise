import * as THREE from 'three';

// Terrain rendered as a diorama slab: the sculptable top surface plus four
// stratified side walls of constant thickness, so the long piste reads as an object
// you own (a tilted slab rather than a 500 m tall block).

export const THICKNESS = 34;

const vert = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const sideVert = /* glsl */ `
  attribute float aDepth;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepth;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vDepth = aDepth;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const frag = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSnow;
  uniform vec3 uSnowShade;
  uniform vec3 uRock;
  uniform vec3 uSky;
  uniform vec3 uBounce;
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
  varying vec3 vWorld;
  varying vec3 vNormal;

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

    // snow tinted cooler on steeper faces, rock showing through cliffs
    vec3 base = mix(uSnow, uSnowShade, smoothstep(0.05, 0.35, slope));
    base = mix(base, uRock, smoothstep(0.42, 0.62, slope));

    // light: wrapped sun + sky/bounce hemisphere
    float ndl = dot(n, normalize(uSunDir));
    float sun = clamp(ndl * 0.75 + 0.25, 0.0, 1.0);
    vec3 hemi = mix(uBounce, uSky, n.y * 0.5 + 0.5);
    vec3 col = base * (hemi * 0.55 + vec3(1.0, 0.97, 0.92) * sun * 0.75);

    // topographic contours: fine every 5 m, bold every 25 m; fine lines fade out
    // when zoomed far back so the long piste doesn't turn grey
    float fw = fwidth(vWorld.y);
    float c1 = aaLine(vWorld.y, 5.0, 1.0) * (1.0 - smoothstep(0.6, 1.6, fw));
    float c2 = aaLine(vWorld.y, 25.0, 1.6) * (1.0 - smoothstep(4.0, 9.0, fw));
    col = mix(col, col * 0.86, c1 * 0.35 * uContours);
    col = mix(col, col * 0.72, c2 * 0.55 * uContours);

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
    float near = 1.0 - smoothstep(25.0, 140.0, dist);
    if (near > 0.0) {
      float grain = vnoise(vWorld.xz * 1.7) * 0.6 + vnoise(vWorld.xz * 5.3) * 0.4;
      float ripple = vnoise(vec2(vWorld.x * 0.35 + vWorld.z * 0.12, vWorld.z * 2.2));
      col *= 1.0 + near * ((grain - 0.5) * 0.09 + (ripple - 0.5) * 0.05);
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
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepth;
  void main() {
    vec3 n = normalize(vNormal);
    // strata: packed snow over ice over dark rock (vDepth 0 at the top edge, 1 at the base)
    vec3 rock = vec3(0.23, 0.26, 0.31);
    vec3 ice = vec3(0.55, 0.68, 0.78);
    vec3 snow = vec3(0.93, 0.96, 0.98);
    vec3 col = mix(ice, rock, smoothstep(0.25, 0.85, vDepth));
    col = mix(snow, col, smoothstep(0.0, 0.08, vDepth));
    float band = 0.5 + 0.5 * sin(vWorld.y * 0.9 + sin(vWorld.x * 0.05 + vWorld.z * 0.05) * 2.0);
    col *= 0.88 + 0.12 * band;
    float sun = clamp(dot(n, normalize(uSunDir)) * 0.5 + 0.6, 0.0, 1.0);
    col *= sun;
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

    const sunDir = new THREE.Vector3(-0.55, 0.75, 0.35).normalize();
    const fog = new THREE.Color('#dfe8ee');
    this.uniforms = {
      uSunDir: { value: sunDir },
      uSnow: { value: new THREE.Color('#f7f9fb') },
      uSnowShade: { value: new THREE.Color('#d6e2ec') },
      uRock: { value: new THREE.Color('#6b7480') },
      uSky: { value: new THREE.Color('#bcd2e6') },
      uBounce: { value: new THREE.Color('#e9dccd') },
      uFog: { value: fog },
      uFogNear: { value: 1400 },
      uFogFar: { value: 4200 },
      uBrushPos: { value: new THREE.Vector3() },
      uBrushRadius: { value: 12 },
      uBrushOn: { value: 0 },
      uBrushColor: { value: new THREE.Color('#ff5a1f') },
      uFinishZ: { value: finishZ },
      uStart: { value: new THREE.Vector2(start.x, start.z) },
      uContours: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
    });
    this.top = new THREE.Mesh(geo, this.material);
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
      g.setIndex(idx);
      g.boundingSphere = bound;
      const m = new THREE.Mesh(g, sideMat);
      this.sides.push(m);
      this.group.add(m);
    }

    this.updateAll();
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
      for (let t = 0; t < d.n; t++) {
        const [i, j] = d.cell(t);
        const [x, z] = hf.toWorld(i, j);
        const y = hf.h[j * hf.nx + i];
        // the slab's underside follows the long profile (smoothed via the centre column)
        const yBase = Math.min(y, hf.heightAt(0, z)) - THICKNESS;
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
    });
  }
}
