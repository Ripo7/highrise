import * as THREE from 'three';
import { simulateLine } from './previewSim.js';

// Live line preview for sculpting: simulates a hands-off run on the current terrain and
// draws it on the snow as a dashed ribbon (white on the snow, orange in the air), with a
// marker at every landing: green clean, amber sketchy, red wipeout.

const COLORS = {
  ground: new THREE.Color('#2f6fd6'),
  air: new THREE.Color('#ff8a3d'),
  clean: '#2fbf7a',
  sketchy: '#f2b233',
  wipeout: '#ff3d2e',
};

export class LinePreview {
  constructor(hf) {
    this.hf = hf;
    this.group = new THREE.Group();
    this.group.renderOrder = 3;
    this.ribbonMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
    });
    this.ribbon = new THREE.Mesh(new THREE.BufferGeometry(), this.ribbonMat);
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 3;
    this.group.add(this.ribbon);
    this.markers = [];
    this.markerGeo = new THREE.RingGeometry(2.6, 5, 32);
    this.markerMats = {};
    for (const k of ['clean', 'sketchy', 'wipeout']) {
      this.markerMats[k] = new THREE.MeshBasicMaterial({
        color: COLORS[k],
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
        side: THREE.DoubleSide,
      });
    }
    this.stats = null;
    this.busy = false;
    this.pending = null;
    this.seq = 0;
    this.worker = undefined;
    this._z = new THREE.Vector3(0, 0, 1);
    this._n = new THREE.Vector3();
  }

  // Ask for a fresh prediction. Runs in a worker when possible; onResult(stats) fires
  // when the drawing has been rebuilt. Requests made while one is running are coalesced.
  request(start, onResult) {
    this.onResult = onResult;
    this.pending = { start: { ...start } };
    if (!this.busy) this.dispatch();
  }

  dispatch() {
    const job = this.pending;
    this.pending = null;
    if (!job) return;
    this.busy = true;
    if (this.worker === undefined) {
      try {
        this.worker = new Worker(new URL('./previewWorker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => this.receive(e.data);
        this.worker.onerror = () => {
          this.worker = null; // fall back to the main thread
          this.busy = false;
          this.pending = this.pending || this.lastJob;
          this.dispatch();
        };
      } catch {
        this.worker = null;
      }
    }
    this.lastJob = job;
    if (this.worker) {
      const h = new Float32Array(this.hf.h); // copy, then hand the copy over
      this.worker.postMessage({ id: ++this.seq, h, start: job.start }, [h.buffer]);
    } else {
      // no worker: compute here on the next frame
      setTimeout(() => this.receive(simulateLine(this.hf, job.start)), 0);
    }
  }

  receive(result) {
    this.busy = false;
    this.buildRibbon(result.pts);
    this.buildMarkers(result.marks);
    this.stats = result.stats;
    this.onResult?.(this.stats);
    if (this.pending) this.dispatch();
  }

  buildRibbon(flat) {
    const hf = this.hf;
    const pos = [];
    const col = [];
    let dist = 0;
    const n = flat.length / 4;
    for (let i = 0; i < n - 1; i++) {
      const a = [flat[i * 4], flat[i * 4 + 1], flat[i * 4 + 2], flat[i * 4 + 3]];
      const b = [flat[i * 4 + 4], flat[i * 4 + 5], flat[i * 4 + 6], flat[i * 4 + 7]];
      const segLen = Math.hypot(b[0] - a[0], b[2] - a[2]);
      dist += segLen;
      // dashes: 5 m on, 3 m off (solid in the air so jump arcs read clearly)
      const air = a[3] || b[3];
      if (!air && dist % 8 > 5) continue;
      const dx = (b[0] - a[0]) / (segLen || 1);
      const dz = (b[2] - a[2]) / (segLen || 1);
      const w = air ? 1.3 : 1.8;
      const px = -dz * w;
      const pz = dx * w;
      const ya = a[3] ? a[1] + 0.6 : hf.heightAt(a[0], a[2]) + 0.45;
      const yb = b[3] ? b[1] + 0.6 : hf.heightAt(b[0], b[2]) + 0.45;
      const c = air ? COLORS.air : COLORS.ground;
      pos.push(a[0] - px, ya, a[2] - pz, a[0] + px, ya, a[2] + pz, b[0] + px, yb, b[2] + pz);
      pos.push(a[0] - px, ya, a[2] - pz, b[0] + px, yb, b[2] + pz, b[0] - px, yb, b[2] - pz);
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.ribbon.geometry.dispose();
    this.ribbon.geometry = g;
  }

  buildMarkers(marks) {
    for (const m of this.markers) this.group.remove(m);
    this.markers.length = 0;
    const hf = this.hf;
    for (const mk of marks) {
      const m = new THREE.Mesh(this.markerGeo, this.markerMats[mk.kind]);
      const n = hf.normalAt(mk.x, mk.z);
      m.position.set(mk.x, hf.heightAt(mk.x, mk.z) + 0.5, mk.z);
      m.quaternion.setFromUnitVectors(this._z, this._n.set(n[0], n[1], n[2]));
      if (mk.kind === 'wipeout') m.scale.setScalar(1.5);
      m.renderOrder = 4;
      this.group.add(m);
      this.markers.push(m);
    }
  }

  set visible(v) {
    this.group.visible = v;
  }
}
