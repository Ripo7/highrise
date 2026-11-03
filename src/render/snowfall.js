// Snow in the air: flakes in a box that travels with the camera, drifting down on the wind.
// Each flake's place is worked out on the GPU from its start and the time, wrapped into the
// box, so nothing is updated per flake on the CPU. In low sun the flakes catch the light
// like diamond dust. count 0 draws nothing.

import * as THREE from 'three';

const BOX = 70; // metres: the box around the camera

const vert = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uBox;
  uniform float uSize;
  uniform vec3 uWind;
  varying float vFade;
  varying float vSeed;
  void main() {
    vec3 p = position + uWind * uTime * (0.7 + 0.6 * aSeed);
    // a little flutter
    p.x += sin(uTime * (0.8 + aSeed) + aSeed * 40.0) * 0.6;
    p.z += cos(uTime * (0.6 + aSeed) + aSeed * 23.0) * 0.6;
    // wrapped into the box around the camera
    vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 w = cameraPosition + rel;
    vec4 mv = viewMatrix * vec4(w, 1.0);
    float d = -mv.z;
    // fade in from the far side of the box and away right by the lens
    vFade = (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, length(rel))) * smoothstep(0.6, 2.0, d);
    vSeed = aSeed;
    gl_PointSize = uSize * (0.6 + 0.8 * aSeed) * 300.0 / max(d, 0.5);
    gl_Position = projectionMatrix * mv;
  }
`;

const frag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = (1.0 - smoothstep(0.2, 0.5, length(c))) * vFade * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

export class Snowfall {
  constructor() {
    this.uniforms = {
      uTime: { value: 0 },
      uBox: { value: BOX },
      uSize: { value: 0.09 },
      uWind: { value: new THREE.Vector3(1.2, -1.1, 0.6) },
      uColor: { value: new THREE.Color('#ffffff') },
      uOpacity: { value: 0.75 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.points = null;
    this.group = new THREE.Group();
    this.count = 0;
  }

  // how many flakes (0: none)
  setCount(n) {
    if (n === this.count) return;
    this.count = n;
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
      this.points = null;
    }
    if (!n) return;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < n; k++) {
      pos[k * 3] = rnd() * BOX;
      pos[k * 3 + 1] = rnd() * BOX;
      pos[k * 3 + 2] = rnd() * BOX;
      seed[k] = rnd();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.group.add(this.points);
    if (this.shown !== undefined) this.show(this.shown);
  }

  // how many of them show (up to setCount's)
  show(n) {
    this.shown = n;
    if (this.points) this.points.geometry.setDrawRange(0, Math.min(n, this.count));
    if (this.points) this.points.visible = n > 0;
  }

  update(dt) {
    this.uniforms.uTime.value += dt;
  }
}
