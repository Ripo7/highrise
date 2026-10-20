import * as THREE from 'three';
import { SkierMesh } from './skierMesh.js';

// Replays a recorded run (positions sampled 30 times a second) as a see-through skier.

export class GhostRider {
  constructor(hf) {
    this.hf = hf;
    this.mesh = new SkierMesh({ ghost: true });
    this.mesh.visible = false;
    this.path = null; // flat [x, y, z, x, y, z, ...]
    this._up = new THREE.Vector3();
  }

  addTo(scene) {
    this.mesh.addTo(scene);
  }

  setPath(flat) {
    this.path = flat && flat.length >= 6 ? flat : null;
  }

  get duration() {
    return this.path ? (this.path.length / 3 - 1) / 30 : 0;
  }

  update(time, dt, show) {
    const p = this.path;
    if (!show || !p || time > this.duration) {
      this.mesh.visible = false;
      return;
    }
    const f = time * 30;
    const i = Math.min(Math.floor(f), p.length / 3 - 2);
    const t = f - i;
    const a = i * 3;
    const b = a + 3;
    const x = p[a] + (p[b] - p[a]) * t;
    const y = p[a + 1] + (p[b + 1] - p[a + 1]) * t;
    const z = p[a + 2] + (p[b + 2] - p[a + 2]) * t;
    const ground = this.hf.heightAt(x, z);
    if (y - ground < 0.3) {
      const n = this.hf.normalAt(x, z);
      this._up.set(n[0], n[1], n[2]);
    } else this._up.set(0, 1, 0);
    this.mesh.visible = true;
    this.mesh.place(x, y, z, p[b] - p[a], p[b + 2] - p[a + 2], this._up, dt);
  }
}

// Compact a skier path for saving (10 cm precision)
export function packPath(path) {
  const out = new Array(path.length * 3);
  for (let i = 0; i < path.length; i++) {
    out[i * 3] = Math.round(path[i][0] * 10) / 10;
    out[i * 3 + 1] = Math.round(path[i][1] * 10) / 10;
    out[i * 3 + 2] = Math.round(path[i][2] * 10) / 10;
  }
  return out;
}
