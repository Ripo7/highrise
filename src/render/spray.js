import * as THREE from 'three';
import { LIGHT } from './light.js';

// Snow spray kicked up by the skis: a pooled point cloud with soft round sprites.
// A little dust off the tails as you go, a fan of snow thrown out of the turn when the
// edges bite or the skis skid (a wall of it in a hockey stop), clouds in powder, and a
// burst on landing. Thrown from behind the boots, so it never hides the skier.

const MAX = 2600;

// Point size is in device pixels: scale it with the drawing-buffer height (a third of it,
// which keeps the look tuned on a 900 px screen) so spray looks the same at any resolution, cap it so a flake right
// by the lens can't fill the screen, and fade flakes that are about to hit the camera.
const vert = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  uniform float uScale;
  varying float vLife;
  varying float vNear;
  varying float vPuff;
  varying float vRand;
  varying vec3 vWorld;
  void main() {
    vLife = aLife;
    vPuff = smoothstep(1.5, 3.0, aSize);
    vRand = fract(sin(float(gl_VertexID) * 12.9898) * 43758.5453);
    vWorld = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float z0 = -mv.z;
    // a puff is a ball, not a flat card: drawn a radius nearer the camera, so the snow it
    // sits in doesn't cut it off along a straight line
    mv.xyz *= max(0.2, 1.0 - aSize * 0.17 * vPuff / max(length(mv.xyz), 1e-3));
    gl_Position = projectionMatrix * mv;
    float px = aSize * (uScale / z0) * (0.6 + 0.4 * aLife);
    // (a powder puff can be bigger: a cloud is half a metre or more from a few metres away)
    gl_PointSize = min(px, uScale * mix(0.12, 0.45, vPuff));
    vNear = smoothstep(0.8, 3.0, z0);
  }
`;

// Lit like the snow it came from: each sprite shaded as a soft little ball (a lit side and
// a cool shaded side, in the snow's own colours), so a cloud of it reads against white
// snow; and a
// flake glows when the sun is behind it (light scattered forward through the powder,
// brighter than white for the bloom).
const frag = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uLit;
  uniform vec3 uMid;
  uniform vec3 uShade;
  uniform float uGlint;
  varying float vLife;
  varying float vNear;
  varying float vPuff;
  varying float vRand;
  varying vec3 vWorld;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    // big powder puffs are thinner, each a little different (a cloud, not a smear), and
    // they thicken only once they've drifted off the skis, so the skier still shows
    float a = smoothstep(0.5, 0.1, d) * vLife * 0.85 * vNear * mix(1.0, (0.45 + 0.35 * vRand) * smoothstep(1.0, 0.75, vLife), vPuff);
    vec3 L = normalize(uSunDir);
    // the ball's normal, from the view into the world
    vec3 nv = vec3(c.x * 2.0, -c.y * 2.0, 0.0);
    nv.z = sqrt(max(0.0, 1.0 - dot(nv.xy, nv.xy)));
    vec3 nw = normalize((vec4(nv, 0.0) * viewMatrix).xyz);
    float lit = smoothstep(-0.3, 0.45, dot(nw, L));
    vec3 col = mix(mix(uShade, uMid, 0.5), uLit, lit) * (0.96 + 0.08 * vRand);
    vec3 view = normalize(vWorld - cameraPosition);
    float back = pow(max(0.0, dot(view, L)), 6.0) * uGlint;
    col += uSunCol * back * 1.6;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

export class Spray {
  constructor() {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX); // 1 -> 0
    this.decay = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.grav = new Float32Array(MAX).fill(6); // powder dust hangs in the air
    this.next = 0;
    this.carry = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uScale: { value: 300 }, uSunDir: LIGHT.uSunDir, uSunCol: LIGHT.uSunCol, uLit: LIGHT.uSnowLit, uMid: LIGHT.uSnowMid, uShade: LIGHT.uSnowShadow, uGlint: LIGHT.uGlint },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
      })
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  // a third of the drawing-buffer height, in device pixels
  setScale(px) {
    this.points.material.uniforms.uScale.value = px;
  }

  emitOne(p, v, size, life, grav = 6) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos.set(p, i * 3);
    this.vel.set(v, i * 3);
    this.life[i] = 1;
    this.decay[i] = 1 / life;
    this.size[i] = size;
    this.grav[i] = grav;
  }

  // Spray from a moving skier: how hard the edges bite (skier.latAcc), how much they skid
  // (skier.skid), the snow under them (skier.powder)
  fromSkier(skier, dt) {
    if (!skier.grounded || skier.status !== 'running') return;
    const sp = skier.speed;
    if (sp < 3) return;
    const v = skier.vel;
    const n = skier.n;
    const h = skier.heading;
    // skis' right-hand direction (heading x normal)
    const rx = h[1] * n[2] - h[2] * n[1];
    const ry = h[2] * n[0] - h[0] * n[2];
    const rz = h[0] * n[1] - h[1] * n[0];
    const skid = skier.skid || 0;
    const bite = Math.min(1, Math.abs(skier.latAcc || 0) / 18);
    const carve = bite * 0.6 + skid * 1.6;
    // deep powder: much more of it, and it hangs in the air as a cloud
    const pw = skier.powder || 0;
    const rate = (sp * 1.2 + carve * sp * 6) * (1 + 4 * pw);
    this.carry += rate * dt;
    // spray goes to the outside of the turn (away from the side the body leans to)
    const t = skier.tilt || n;
    const lean = t[0] * rx + t[1] * ry + t[2] * rz;
    const side = Math.abs(lean) > 0.04 ? -Math.sign(lean) : 0;
    const vl = Math.max(1, sp);
    while (this.carry >= 1) {
      this.carry -= 1;
      const back = 0.1 + Math.random() * 0.2;
      const lat = (side * (1.5 + Math.random() * 4) + (Math.random() - 0.5) * 1.5) * (0.3 + carve * 0.7);
      const up = 1 + Math.random() * (1.5 + carve * 2.5);
      // from the tails of the skis, behind the boots
      const tail = 0.5 + Math.random() * 0.4;
      const p = [
        skier.pos[0] - (v[0] / vl) * tail + rx * side * 0.2 + (Math.random() - 0.5) * 0.3,
        skier.pos[1] + 0.08,
        skier.pos[2] - (v[2] / vl) * tail + rz * side * 0.2 + (Math.random() - 0.5) * 0.3,
      ];
      // in powder: more of it hangs as big puffs that keep up with the skis a while (a
      // cloud billowing off the tails), and it's thrown higher (a rooster tail)
      const puff = pw > 0.3 && Math.random() < 0.6 * pw;
      const lift = 1 + pw * 0.9;
      const carry = puff ? 0.35 + Math.random() * 0.3 : back;
      this.emitOne(
        p,
        [v[0] * carry + rx * lat + n[0] * up * lift, v[1] * carry + ry * lat + n[1] * up * lift, v[2] * carry + rz * lat + n[2] * up * lift],
        (0.35 + Math.random() * 0.45 + carve * 0.3) * (puff ? 4 + Math.random() * 2.5 : 1 + 0.3 * pw),
        (0.35 + Math.random() * 0.4) * (puff ? 2.4 : 1 + 0.6 * pw),
        puff ? 0.9 : 6 - 3 * pw
      );
    }
  }

  burst(skier, strength = 1) {
    const v = skier.vel;
    const pw = skier.powder || 0;
    const n = 45 * strength * (1 + pw);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 4;
      const puff = pw > 0.3 && k % 3 === 0;
      this.emitOne(
        [skier.pos[0], skier.pos[1] + 0.1, skier.pos[2]],
        [v[0] * 0.3 + Math.cos(a) * r, 1.5 + Math.random() * (3 + 2 * pw), v[2] * 0.3 + Math.sin(a) * r],
        (0.35 + Math.random() * 0.45) * (puff ? 3 : 1),
        (0.5 + Math.random() * 0.4) * (puff ? 2.6 : 1 + pw),
        puff ? 0.8 : 6 - 3 * pw
      );
    }
  }

  update(dt) {
    const { pos, vel, life, decay } = this;
    const drag = Math.exp(-dt * 2.2);
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) continue;
      life[i] = Math.max(0, life[i] - decay[i] * dt);
      const k = i * 3;
      vel[k] *= drag;
      vel[k + 1] = vel[k + 1] * drag - this.grav[i] * dt;
      vel[k + 2] *= drag;
      pos[k] += vel[k] * dt;
      pos[k + 1] += vel[k + 1] * dt;
      pos[k + 2] += vel[k + 2] * dt;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aLife.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
  }
}
