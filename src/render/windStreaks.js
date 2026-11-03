// Speed you can see: fine streaks of blown snow rushing past the camera, drawn out along
// the air's motion relative to the lens (so they stream past whichever way you go, and
// curl when you turn). They live in a box that travels with the camera, wrapped on the GPU
// like the falling snow, and only show at speed and towards the edges of the picture,
// never over the skier. Each streak is a thin ribbon a pixel or two wide on screen.

import * as THREE from 'three';

const BOX = 34; // metres: the box round the camera
const COUNT = 220;

const vert = /* glsl */ `
  attribute vec3 aSeed;
  attribute float aEnd; // 0 the tail, 1 the head
  attribute float aSide; // -1 / 1 across the ribbon
  uniform vec3 uOffset; // how far the air has moved past the camera (m)
  uniform vec3 uVel; // the air's velocity relative to the camera (m/s)
  uniform float uLen; // a streak is this many seconds of motion long
  uniform float uBox;
  uniform float uWidth; // pixels
  uniform vec2 uView; // drawing buffer size (pixels)
  varying float vAlpha;
  varying float vEnd;
  void main() {
    vec3 rel = mod(aSeed * uBox + uOffset - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 head = cameraPosition + rel;
    float len = 0.6 + 0.8 * fract(aSeed.x * 7.13 + aSeed.z * 3.7);
    vec3 tail = head - uVel * uLen * len;
    vec4 a = projectionMatrix * viewMatrix * vec4(tail, 1.0);
    vec4 b = projectionMatrix * viewMatrix * vec4(head, 1.0);
    // across the ribbon, in pixels
    vec2 sa = a.xy / max(a.w, 1e-3) * uView;
    vec2 sb = b.xy / max(b.w, 1e-3) * uView;
    vec2 d = sb - sa;
    float dl = length(d);
    vec2 across = dl > 1e-3 ? vec2(-d.y, d.x) / dl : vec2(0.0, 1.0);
    vec4 p = mix(a, b, aEnd);
    p.xy += across * aSide * uWidth / uView * p.w;
    gl_Position = p;
    vEnd = aEnd;
    // fade: in from the far side of the box, away right by the lens, and off the middle of
    // the picture (where the skier is): streaks belong to the edges
    float dist = length(rel);
    float depth = -(viewMatrix * vec4(head, 1.0)).z;
    vec2 ndc = b.xy / max(b.w, 1e-3);
    vAlpha = (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, dist)) * smoothstep(1.2, 3.5, depth)
      * smoothstep(0.28, 0.75, length(ndc * vec2(1.0, 0.8))) * step(0.0, depth);
  }
`;

const frag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAmt;
  varying float vAlpha;
  varying float vEnd;
  void main() {
    // brightest at the head, fading along the tail
    float a = vAlpha * uAmt * smoothstep(0.0, 1.0, vEnd) * 0.55;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

export class WindStreaks {
  constructor() {
    const pos = new Float32Array(COUNT * 4 * 3); // unused by the shader, needed by three
    const seed = new Float32Array(COUNT * 4 * 3);
    const end = new Float32Array(COUNT * 4);
    const side = new Float32Array(COUNT * 4);
    const index = [];
    let s = 9871;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < COUNT; i++) {
      const sd = [rnd(), rnd(), rnd()];
      for (let v = 0; v < 4; v++) {
        seed.set(sd, (i * 4 + v) * 3);
        end[i * 4 + v] = v < 2 ? 0 : 1;
        side[i * 4 + v] = v % 2 ? 1 : -1;
      }
      const o = i * 4;
      index.push(o, o + 1, o + 2, o + 2, o + 1, o + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setIndex(index);
    this.uniforms = {
      uOffset: { value: new THREE.Vector3() },
      uVel: { value: new THREE.Vector3() },
      uLen: { value: 0.07 },
      uBox: { value: BOX },
      uWidth: { value: 1.2 },
      uView: { value: new THREE.Vector2(1, 1) },
      uColor: { value: new THREE.Color('#ffffff') },
      uAmt: { value: 0 },
    };
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.visible = false;
    this._last = new THREE.Vector3();
    this._vel = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this.has = false;
  }

  // drawing-buffer size (device pixels) and pixels per CSS pixel (the width is in CSS pixels)
  setView(w, h, ratio) {
    this.uniforms.uView.value.set(Math.max(1, w), Math.max(1, h));
    this.uniforms.uWidth.value = 1.1 * Math.max(1, ratio);
  }

  // once a frame: the camera's position (it moves with the skier), and how much to show
  // (0: none .. 1: full, from the speed)
  update(dt, camPos, amount, wind) {
    const u = this.uniforms;
    if (!this.has || dt <= 0) {
      this._last.copy(camPos);
      this.has = true;
      u.uAmt.value = 0;
      this.mesh.visible = false;
      return;
    }
    // the camera's velocity, smoothed (a snap of the camera isn't speed)
    this._v.subVectors(camPos, this._last).divideScalar(dt);
    this._last.copy(camPos);
    if (this._v.length() > 120) this._v.copy(this._vel);
    this._vel.lerp(this._v, Math.min(1, dt * 6));
    // the air relative to the lens: the wind minus our own motion
    u.uVel.value.set(wind ? wind.x : 0, 0, wind ? wind.y : 0).sub(this._vel);
    u.uOffset.value.addScaledVector(u.uVel.value, dt);
    u.uAmt.value += (amount - u.uAmt.value) * Math.min(1, dt * 4);
    this.mesh.visible = u.uAmt.value > 0.01;
  }

  reset() {
    this.has = false;
    this._vel.set(0, 0, 0);
    this.uniforms.uAmt.value = 0;
    this.mesh.visible = false;
  }
}
