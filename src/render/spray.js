import * as THREE from 'three';

// Snow spray kicked up by the skis: a pooled point cloud with soft round sprites.
// A little dust off the tails as you go, a fan of snow thrown out of the turn when the
// edges bite or the skis skid (a wall of it in a hockey stop), clouds in powder, and a
// burst on landing. Thrown from behind the boots, so it never hides the skier.

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
    const rate = (sp * 1.2 + carve * sp * 6) * (1 + 1.4 * pw);
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
      const puff = pw > 0.3 && Math.random() < 0.3 * pw;
      this.emitOne(
        p,
        [v[0] * back + rx * lat + n[0] * up * (1 + pw * 0.4), v[1] * back + ry * lat + n[1] * up * (1 + pw * 0.4), v[2] * back + rz * lat + n[2] * up * (1 + pw * 0.4)],
        (0.35 + Math.random() * 0.45 + carve * 0.3) * (puff ? 2.2 + Math.random() * 1.2 : 1 + 0.3 * pw),
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
