import * as THREE from 'three';

// A chunky, readable little skier (drawn ~2.2x life size so it reads from orbit distance),
// plus a ground shadow disc and a fading speed trail.

const SCALE = 2.2;

export class SkierMesh {
  constructor() {
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);

    const jacket = new THREE.MeshLambertMaterial({ color: '#ff5a1f' });
    const pants = new THREE.MeshLambertMaterial({ color: '#1d2733' });
    const skin = new THREE.MeshLambertMaterial({ color: '#f1c9a5' });
    const ski = new THREE.MeshLambertMaterial({ color: '#2f6fd6' });

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
    this.body.scale.setScalar(SCALE);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.4, 24),
      new THREE.MeshBasicMaterial({ color: '#0e1620', transparent: true, opacity: 0.28, depthWrite: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;

    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._up = new THREE.Vector3();
    this._fwd = new THREE.Vector3(0, 0, 1);
    this._right = new THREE.Vector3();
    this.crashed = false;
  }

  addTo(scene) {
    scene.add(this.group, this.shadow);
  }

  set visible(v) {
    this.group.visible = v;
    this.shadow.visible = v;
  }

  // Place + orient from simulation state
  sync(skier, hf, dt) {
    const [x, y, z] = skier.pos;
    this.group.position.set(x, y, z);
    const n = skier.n;
    const up = this._up;
    if (skier.grounded) up.set(n[0], n[1], n[2]);
    else up.lerp(new THREE.Vector3(0, 1, 0), 0.05).normalize();
    const v = skier.vel;
    const sp = Math.hypot(v[0], v[1], v[2]);
    if (sp > 0.3) this._fwd.set(v[0], v[1], v[2]).normalize();
    // build an orthonormal basis: right = fwd x up, fwd' = up x right
    const right = this._right.crossVectors(up, this._fwd).normalize();
    const fwd = new THREE.Vector3().crossVectors(right, up).normalize();
    this._m.makeBasis(right, up, fwd);
    this._q.setFromRotationMatrix(this._m);
    this.group.quaternion.slerp(this._q, Math.min(1, dt * 12));

    if (skier.status === 'crashed' && !this.crashed) {
      this.crashed = true;
      this.body.rotation.z = Math.PI / 2.2;
      this.body.position.y = 0.4;
    }

    const gy = hf.heightAt(x, z);
    this.shadow.position.set(x, gy + 0.15, z);
    const air = Math.max(0, y - gy);
    const s = 1 + air * 0.04;
    this.shadow.scale.setScalar(s);
    this.shadow.material.opacity = 0.28 / (1 + air * 0.08);
  }

  reset() {
    this.crashed = false;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this._fwd.set(0, 0, 1);
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
