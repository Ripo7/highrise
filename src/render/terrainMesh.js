import * as THREE from 'three';

// Terrain rendered as a diorama block: the sculptable top surface plus four
// stratified side walls down to a base, so the mountain reads as an object you own.

export const BASE_Y = -40;

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

    // topographic contours: fine every 2 m, bold every 10 m
    float c1 = aaLine(vWorld.y, 2.0, 1.0);
    float c2 = aaLine(vWorld.y, 10.0, 1.6);
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
  uniform float uBaseY;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    float depth = vWorld.y - uBaseY;
    // strata: packed snow over ice over dark rock
    vec3 rock = vec3(0.23, 0.26, 0.31);
    vec3 ice = vec3(0.55, 0.68, 0.78);
    vec3 col = mix(rock, ice, smoothstep(10.0, 40.0, depth));
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
    const res = hf.res;
    this.group = new THREE.Group();

    // --- top surface ---
    const count = res * res;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const k = j * res + i;
        const [x, z] = hf.toWorld(i, j);
        positions[k * 3] = x;
        positions[k * 3 + 2] = z;
      }
    }
    const index = new Uint32Array((res - 1) * (res - 1) * 6);
    let p = 0;
    for (let j = 0; j < res - 1; j++) {
      for (let i = 0; i < res - 1; i++) {
        const a = j * res + i;
        const b = a + 1;
        const c = a + res;
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
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 50, 0), hf.size);
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
      uFogNear: { value: 600 },
      uFogFar: { value: 1600 },
      uBrushPos: { value: new THREE.Vector3() },
      uBrushRadius: { value: 12 },
      uBrushOn: { value: 0 },
      uBrushColor: { value: new THREE.Color('#ff5a1f') },
      uFinishZ: { value: finishZ },
      uStart: { value: new THREE.Vector2(start.x, start.z) },
      uContours: { value: 1 },
      uBaseY: { value: BASE_Y },
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
      vertexShader: vert,
      fragmentShader: sideFrag,
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
    });
    for (let s = 0; s < 4; s++) {
      const pos = new Float32Array(res * 2 * 3);
      const nor = new Float32Array(res * 2 * 3);
      const idx = [];
      for (let i = 0; i < res - 1; i++) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        idx.push(a, b, c, c, b, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setIndex(idx);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 50, 0), hf.size);
      const m = new THREE.Mesh(g, sideMat);
      this.sides.push(m);
      this.group.add(m);
    }

    // base slab under the block, slightly larger, for a grounded diorama look
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(hf.size + 6, 4, hf.size + 6),
      new THREE.MeshBasicMaterial({ color: '#2a323c' })
    );
    slab.position.y = BASE_Y - 2;
    this.group.add(slab);

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
    const r = this.hf.res - 1;
    this.update({ i0: 0, i1: r, j0: 0, j1: r });
  }

  // Refresh heights + normals inside a dirty grid rectangle
  update(rect) {
    const { hf } = this;
    const res = hf.res;
    const pos = this.geo.attributes.position.array;
    const nor = this.geo.attributes.normal.array;
    const i0 = Math.max(0, rect.i0 - 1);
    const i1 = Math.min(res - 1, rect.i1 + 1);
    const j0 = Math.max(0, rect.j0 - 1);
    const j1 = Math.min(res - 1, rect.j1 + 1);
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
    if (i0 === 0 || j0 === 0 || i1 === res - 1 || j1 === res - 1) this.updateSides();
  }

  updateSides() {
    const { hf } = this;
    const res = hf.res;
    // 0: north edge (z=-half), 1: south (z=+half), 2: west (x=-half), 3: east (x=+half)
    const defs = [
      { cell: (t) => [t, 0], n: [0, 0, -1] },
      { cell: (t) => [t, res - 1], n: [0, 0, 1] },
      { cell: (t) => [0, t], n: [-1, 0, 0] },
      { cell: (t) => [res - 1, t], n: [1, 0, 0] },
    ];
    defs.forEach((d, s) => {
      const g = this.sides[s].geometry;
      const pos = g.attributes.position.array;
      const nor = g.attributes.normal.array;
      for (let t = 0; t < res; t++) {
        const [i, j] = d.cell(t);
        const [x, z] = hf.toWorld(i, j);
        const y = hf.h[j * res + i];
        const a = t * 6;
        pos[a] = x;
        pos[a + 1] = y;
        pos[a + 2] = z;
        pos[a + 3] = x;
        pos[a + 4] = BASE_Y;
        pos[a + 5] = z;
        nor[a] = nor[a + 3] = d.n[0];
        nor[a + 1] = nor[a + 4] = d.n[1];
        nor[a + 2] = nor[a + 5] = d.n[2];
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.normal.needsUpdate = true;
    });
  }
}
