import * as THREE from 'three';

// Snow spray kicked up by the skis: a pooled point cloud with soft round sprites.
// More spray the faster you go, a big rooster tail when carving or braking,
// and a burst on landing.

const MAX = 1600;

// Point size is in device pixels: scale it with the drawing-buffer height (a third of it,
// which keeps the look tuned on a 900 px screen) so spray looks the same at any resolution, cap it so a flake right
// by the lens can't fill the screen, and fade flakes that are about to hit the camera.
const vert = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  uniform float uScale;
  varying float vLife;
  varying float vNear;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float px = aSize * (uScale / -mv.z) * (0.6 + 0.4 * aLife);
    gl_PointSize = min(px, uScale * 0.12);
    vNear = smoothstep(0.8, 3.0, -mv.z);
  }
`;

const frag = /* glsl */ `
  varying float vLife;
  varying float vNear;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.1, d) * vLife * 0.85 * vNear;
    gl_FragColor = vec4(vec3(0.97, 0.98, 1.0), a);
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
        uniforms: { uScale: { value: 300 } },
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

  // Spray from a moving skier. `carve` 0..1 (steering/skid), `brake` boolean.
  fromSkier(skier, dt) {
    if (!skier.grounded || skier.status !== 'running') return;
    const sp = skier.speed;
    if (sp < 4) return;
    const v = skier.vel;
    const n = skier.n;
    const h = skier.heading;
    // skis' right-hand direction (heading x normal)
    const rx = h[1] * n[2] - h[2] * n[1];
    const ry = h[2] * n[0] - h[0] * n[2];
    const rz = h[0] * n[1] - h[1] * n[0];
    const steer = skier.input.steer;
    const brake = skier.input.brake || skier.input.pitch < -0.4;
    const carve = Math.abs(steer) + (brake ? 1.5 : 0);
    // deep powder: much more of it, bigger, and it hangs in the air as a cloud
    const pw = skier.powder || 0;
    const rate = (sp * 3 + carve * sp * 7) * (1 + 1.6 * pw);
    this.carry += rate * dt;
    // spray goes to the outside of the turn
    const side = steer !== 0 ? steer : brake ? (Math.random() < 0.5 ? -1 : 1) : 0;
    while (this.carry >= 1) {
      this.carry -= 1;
      const back = 0.15 + Math.random() * 0.25;
      const lat = (side * (3 + Math.random() * 6) + (Math.random() - 0.5) * 3) * (0.4 + carve * 0.6);
      const up = 2 + Math.random() * (3 + carve * 4);
      const p = [
        skier.pos[0] + (Math.random() - 0.5) * 0.8,
        skier.pos[1] + 0.2,
        skier.pos[2] + (Math.random() - 0.5) * 0.8,
      ];
      const puff = pw > 0.3 && Math.random() < 0.35 * pw;
      this.emitOne(
        p,
        [v[0] * back + rx * lat + n[0] * up * (1 + pw * 0.4), v[1] * back + ry * lat + n[1] * up * (1 + pw * 0.4), v[2] * back + rz * lat + n[2] * up * (1 + pw * 0.4)],
        (0.8 + Math.random() * 1.0 + carve * 0.6) * (puff ? 2.6 + Math.random() * 1.8 : 1 + 0.4 * pw),
        (0.45 + Math.random() * 0.45) * (puff ? 2.8 : 1 + 0.7 * pw),
        puff ? 0.9 : 6 - 3 * pw
      );
    }
  }

  burst(skier, strength = 1) {
    const v = skier.vel;
    const pw = skier.powder || 0;
    const n = 60 * strength * (1 + pw);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 6;
      const puff = pw > 0.3 && k % 3 === 0;
      this.emitOne(
        [skier.pos[0], skier.pos[1] + 0.2, skier.pos[2]],
        [v[0] * 0.3 + Math.cos(a) * r, 2 + Math.random() * (4 + 3 * pw), v[2] * 0.3 + Math.sin(a) * r],
        (0.7 + Math.random() * 0.8) * (puff ? 3.5 : 1),
        (0.6 + Math.random() * 0.5) * (puff ? 3 : 1 + pw),
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
