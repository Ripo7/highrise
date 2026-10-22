import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { THEME } from './theme.js';
import { toonRamp, outlineMaterial } from './toon.js';

// The skier: a cartoon character modelled, rigged and posed in Blender
// (art/export_skier.py -> public/models/skier.glb), drawn ~2x life size so he reads from
// orbit distance. Six held poses (Stance, Crouch, Tuck, Air, Brake, Tumble) play at once and
// their weights follow what the rider is doing. Simple blocks stand in until the file loads.
// Also: a ground disc for judging landings and a fading speed trail.

const SCALE = 2.2;
const MODEL_SCALE = 2.0;
const CY = 1.0 * SCALE; // flip pivot height (around the hips)
const POSES = ['Stance', 'Crouch', 'Tuck', 'Air', 'Brake', 'Tumble'];
const PART_COLORS = () => ({
  jacket: THEME.jacket,
  pants: THEME.pants,
  hat: THEME.hat,
  skin: '#f6cfae',
  goggles: '#2a2140',
  snow: '#fffaf1',
  ski: THEME.flag,
  pole: '#4a4466',
});

let skierFile = null;
function loadSkier() {
  if (!skierFile) {
    skierFile = new Promise((resolve, reject) =>
      new GLTFLoader().load(`${import.meta.env.BASE_URL}models/skier.glb`, resolve, undefined, reject),
    );
  }
  return skierFile;
}

export class SkierMesh {
  // ghost: a see-through, untextured copy used to replay the best run
  constructor({ ghost = false } = {}) {
    this.ghost = ghost;
    this.group = new THREE.Group();
    this.flipper = new THREE.Group(); // pivot for flips and tumbles
    this.flipper.position.y = CY;
    this.body = new THREE.Group();
    this.body.position.y = -CY;
    this.flipper.add(this.body);
    this.group.add(this.flipper);

    const mat = (color) =>
      ghost
        ? new THREE.MeshLambertMaterial({ color: '#9cc6f2', transparent: true, opacity: 0.38, depthWrite: false })
        : new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() });
    const jacket = mat(THEME.jacket);
    const pants = mat(THEME.pants);
    const skin = mat('#f6cfae');
    const ski = mat(THEME.hat);

    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.7, 0.32), pants);
    legs.position.y = 0.45;
    legs.rotation.x = -0.35;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.45, 4, 10), jacket);
    torso.position.set(0, 1.05, 0.12);
    torso.rotation.x = 0.45;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), skin);
    head.position.set(0, 1.45, 0.3);
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), jacket);
    hat.position.copy(head.position).add(new THREE.Vector3(0, 0.03, 0));
    const skiL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 1.7), ski);
    skiL.position.set(-0.13, 0.04, 0.1);
    const skiR = skiL.clone();
    skiR.position.x = 0.13;
    this.body.add(legs, torso, head, hat, skiL, skiR);
    this.person = [legs, torso, head, hat];
    this.blocks = [legs, torso, head, hat, skiL, skiR];
    if (!ghost) {
      // cartoon ink outline around every part, and the rider casts a sun shadow
      const ink = outlineMaterial({ width: 2.2, fade: 3000 });
      this.ink = ink;
      for (const m of [legs, torso, head, hat, skiL, skiR]) {
        m.castShadow = true;
        const o = new THREE.Mesh(m.geometry, ink);
        m.add(o);
      }
    }
    this.body.scale.setScalar(SCALE);
    if (ghost) this.group.traverse((o) => (o.renderOrder = 5));

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.4, 24),
      new THREE.MeshBasicMaterial({ color: THEME.ink, transparent: true, opacity: 0.22, depthWrite: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
    if (ghost) this.shadow.visible = false;

    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._up = new THREE.Vector3(0, 1, 0);
    this._fwd = new THREE.Vector3(0, 0, 1);
    this._right = new THREE.Vector3();
    this._fwd2 = new THREE.Vector3();
    this._worldUp = new THREE.Vector3(0, 1, 0);
    this.crouch = 0;
    this.lean = 0;
    this._prevFwd = new THREE.Vector3(0, 0, 1);
    this.mixer = null;
    this.weights = Object.fromEntries(POSES.map((p) => [p, p === 'Stance' ? 1 : 0]));
    loadSkier()
      .then((gltf) => this.useModel(gltf))
      .catch((err) => console.warn('skier.glb failed to load, keeping the stand-in', err));
  }

  // swap the stand-in blocks for the Blender character
  useModel(gltf) {
    const model = SkeletonUtils.clone(gltf.scene);
    model.scale.setScalar(MODEL_SCALE);
    const colors = PART_COLORS();
    const ink = this.ghost ? null : outlineMaterial({ skinned: true, width: 2.0, fade: 3000 });
    this.parts = [];
    const meshes = [];
    model.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    for (const o of meshes) {
      const name = o.material?.name || 'jacket';
      o.material = this.ghost
        ? new THREE.MeshLambertMaterial({ color: '#9cc6f2', transparent: true, opacity: 0.38, depthWrite: false })
        : new THREE.MeshToonMaterial({ color: colors[name] || THEME.jacket, gradientMap: toonRamp() });
      o.frustumCulled = false;
      o.castShadow = !this.ghost;
      if (this.ghost) o.renderOrder = 5;
      this.parts.push({ mesh: o, name });
      if (ink && o.isSkinnedMesh) {
        const line = new THREE.SkinnedMesh(o.geometry, ink);
        line.bind(o.skeleton, o.bindMatrix);
        line.frustumCulled = false;
        o.parent.add(line);
        this.parts.push({ mesh: line, name, ink: true });
      }
    }
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      a.setEffectiveWeight(this.weights[clip.name] ?? 0);
      a.play();
      this.actions[clip.name] = a;
    }
    this.mixer.update(0);
    for (const b of this.blocks) this.body.remove(b);
    // the model's feet sit at its origin: undo the stand-in's per-axis scale
    this.body.scale.setScalar(1);
    this.body.add(model);
    this.model = model;
    if (this.firstPerson) this.setFirstPerson(true);
  }

  // blend the held poses towards what the rider is doing
  pose(skier, dt) {
    const want = Object.fromEntries(POSES.map((p) => [p, 0]));
    if (skier.wipeout > 0) want.Tumble = 1;
    else if (!skier.grounded) {
      if (skier.crouching) want.Crouch = 1; // absorbing a landing
      else want.Air = 1;
    } else if (skier.crouching) want.Crouch = 1;
    else if (skier.input.pitch > 0.4) want.Tuck = 1;
    else if (skier.input.pitch < -0.4) want.Brake = 1;
    else want.Stance = 1;
    const k = Math.min(1, dt * 12);
    let sum = 0;
    for (const p of POSES) {
      this.weights[p] += (want[p] - this.weights[p]) * k;
      sum += this.weights[p];
    }
    for (const p of POSES) this.actions[p]?.setEffectiveWeight(this.weights[p] / Math.max(1e-4, sum));
    this.mixer.update(dt);
  }

  addTo(scene) {
    scene.add(this.group);
    if (!this.ghost) scene.add(this.shadow);
  }

  set visible(v) {
    this.group.visible = v;
    this.shadow.visible = v && !this.ghost;
  }

  get visible() {
    return this.group.visible;
  }

  orient(up, fwd, dt) {
    const right = this._right.crossVectors(up, fwd).normalize();
    const f = this._fwd2.crossVectors(right, up).normalize();
    this._m.makeBasis(right, up, f);
    this._q.setFromRotationMatrix(this._m);
    this.group.quaternion.slerp(this._q, Math.min(1, dt * 14));
  }

  // Place + pose from simulation state
  sync(skier, hf, dt) {
    // between the last two physics steps, so motion is smooth at any refresh rate
    const [x, y, z] = skier.drawPos ? skier.drawPos(this._dp || (this._dp = [0, 0, 0])) : skier.pos;
    this.group.position.set(x, y, z);
    const n = skier.n;
    const up = this._up;
    if (skier.grounded) up.set(n[0], n[1], n[2]);
    else up.lerp(this._worldUp, Math.min(1, dt * 4)).normalize();
    // face where the skis point (the steering heading), not just the direction of travel
    const h = skier.heading;
    this._fwd.set(h[0], h[1], h[2]).normalize();
    this.orient(up, this._fwd, dt);

    // crouch (loading a jump, tucking, absorbing a landing)
    const wantCrouch = skier.crouching ? 1 : skier.grounded && skier.input.pitch > 0.4 ? 0.6 : 0;
    this.crouch += (wantCrouch - this.crouch) * Math.min(1, dt * 14);
    if (this.mixer) this.pose(skier, dt);
    else this.body.scale.set(SCALE, SCALE * (1 - 0.24 * this.crouch), SCALE);

    // lean into carves: banked by the turn's sideways pull (turn rate x speed)
    const cy = this._prevFwd.z * this._fwd.x - this._prevFwd.x * this._fwd.z;
    this._prevFwd.copy(this._fwd);
    const yawRate = dt > 0 ? Math.asin(Math.max(-1, Math.min(1, cy))) / dt : 0;
    const wantLean = skier.grounded && skier.wipeout <= 0 ? Math.atan((yawRate * skier.speed) / 9.81) : 0;
    this.lean += (Math.max(-0.7, Math.min(0.7, wantLean)) - this.lean) * Math.min(1, dt * 8);

    if (skier.wipeout > 0) {
      // tumble: a couple of rolls, then lying in the snow
      const t = 1 - skier.wipeout / skier.P.wipeoutTime;
      const roll = Math.min(1, t / 0.45);
      this.flipper.rotation.set(-roll * Math.PI * 3, 0, 1.35 * Math.min(1, t * 3));
      this.flipper.position.y = CY * (1 - 0.6 * Math.min(1, t * 3));
    } else {
      // flips: the body pitches around the hips (+pitch = backflip, nose up and over)
      this.flipper.rotation.set(-skier.pitch, 0, -this.lean);
      this.flipper.position.y = CY;
    }

    const gy = hf.heightAt(x, z);
    this.shadow.position.set(x, gy + 0.15, z);
    // the sun casts the real shadow; this disc right under him only helps judge landings
    const air = Math.max(0, y - gy);
    const s = 1 + air * 0.04;
    this.shadow.scale.setScalar(s);
    this.shadow.material.opacity = (0.26 * Math.min(1, Math.max(0, air - 0.8) / 2)) / (1 + air * 0.08);
  }

  // Ghost replay: position and facing from a recorded path
  place(x, y, z, fx, fz, up, dt) {
    this.group.position.set(x, y, z);
    if (Math.hypot(fx, fz) > 1e-4) this._fwd.set(fx, 0, fz).normalize();
    this.orient(up, this._fwd, dt);
    if (this.mixer) this.mixer.update(dt);
  }

  // helmet cam: hide the body so only the skis (and poles) show below the camera
  setFirstPerson(on) {
    this.firstPerson = on;
    for (const m of this.person) m.visible = !on;
    for (const p of this.parts || []) p.mesh.visible = !on || p.name === 'ski' || (p.name === 'pole' && !p.ink);
  }

  reset() {
    this.flipper.rotation.set(0, 0, 0);
    this.flipper.position.y = CY;
    this.crouch = 0;
    this.lean = 0;
    this._fwd.set(0, 0, 1);
    this._prevFwd.set(0, 0, 1);
    for (const p of POSES) this.weights[p] = p === 'Stance' ? 1 : 0;
  }
}

// A polyline that follows the skier; `ghost` style is used for the previous run.
export class Trail {
  constructor({ color, opacity = 1, dashed = false, max = 6000 }) {
    this.max = max;
    this.positions = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 2, transparent: opacity < 1, opacity })
      : new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
    this.line = new THREE.Line(geo, mat);
    this.line.renderOrder = 3;
    this.dashed = dashed;
    this.count = 0;
  }

  setPath(path, lift = 0.35) {
    const n = Math.min(path.length, this.max);
    for (let i = 0; i < n; i++) {
      this.positions[i * 3] = path[i][0];
      this.positions[i * 3 + 1] = path[i][1] + lift;
      this.positions[i * 3 + 2] = path[i][2];
    }
    this.count = n;
    const g = this.line.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    if (this.dashed && n > 1) this.line.computeLineDistances();
  }

  clear() {
    this.count = 0;
    this.line.geometry.setDrawRange(0, 0);
  }
}
