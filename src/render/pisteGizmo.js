import * as THREE from 'three';
import { THEME } from './theme.js';

// The piste editor's handles: a pin on every waypoint (always the same size on screen and
// never hidden by the snow, so they're easy to grab with a finger), the start and the
// finish marked, a dashed line along each piste, and a preview of the next stretch under
// the mouse.

const PIN_PX = 30; // on-screen size of a pin

function pinTexture(kind) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const c = S / 2;
  const ink = THEME.ink;
  const ring = (r, fill, stroke, lw) => {
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    if (stroke) {
      g.lineWidth = lw;
      g.strokeStyle = stroke;
      g.stroke();
    }
  };
  // a soft shadow so pins read on bright snow
  ring(56, 'rgba(40,30,70,0.18)');
  if (kind === 'sel') ring(54, '#ff7a45', ink, 6);
  const face = kind === 'start' ? '#3ac47d' : kind === 'end' ? '#ffffff' : kind === 'join' ? ink : '#ffffff';
  ring(kind === 'join' ? 26 : 42, face, ink, 7);
  if (kind === 'end') {
    // chequered finish
    g.save();
    g.beginPath();
    g.arc(c, c, 38, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = ink;
    const q = 19;
    for (let y = -2; y < 3; y++) for (let x = -2; x < 3; x++) if ((x + y) & 1) g.fillRect(c + x * q - q / 2, c + y * q - q / 2, q, q);
    g.restore();
    ring(42, null, ink, 7);
  } else if (kind === 'start') {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(c - 12, c - 18);
    g.lineTo(c + 20, c);
    g.lineTo(c - 12, c + 18);
    g.closePath();
    g.fill();
  } else if (kind === 'point' || kind === 'sel') {
    ring(13, '#4f7be8');
  } else if (kind === 'ghost') {
    g.clearRect(0, 0, S, S);
    ring(42, 'rgba(255,255,255,0.55)', ink, 5);
    ring(12, 'rgba(79,123,232,0.8)');
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class PisteGizmo {
  constructor(hf) {
    this.hf = hf;
    this.group = new THREE.Group();
    this.group.renderOrder = 10;
    this.tex = {};
    for (const k of ['point', 'sel', 'start', 'end', 'join', 'ghost']) this.tex[k] = pinTexture(k);
    this.mats = {};
    for (const k of Object.keys(this.tex)) {
      this.mats[k] = new THREE.SpriteMaterial({ map: this.tex[k], depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true });
    }
    this.pins = []; // { sprite, id, idx, x, z, kind }
    this.lines = [];
    this.lineMat = new THREE.LineDashedMaterial({ color: THEME.ink, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.55, depthWrite: false });
    this.previewMat = new THREE.LineDashedMaterial({ color: '#4f7be8', dashSize: 3, gapSize: 2.5, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    this.preview = new THREE.Line(new THREE.BufferGeometry(), this.previewMat);
    this.preview.visible = false;
    this.preview.renderOrder = 11;
    this.ghost = new THREE.Sprite(this.mats.ghost);
    this.ghost.visible = false;
    this.ghost.renderOrder = 12;
    this.group.add(this.preview, this.ghost);
    this.px = 1;
  }

  // pistes: the model; curves: from pisteCurves; sel: { id, idx } or null
  set(pistes, curves, sel) {
    for (const p of this.pins) this.group.remove(p.sprite);
    for (const l of this.lines) {
      this.group.remove(l);
      l.geometry.dispose();
    }
    this.pins = [];
    this.lines = [];
    const hf = this.hf;
    let first = true;
    for (const p of pistes) {
      const c = curves.get(p.id);
      p.pts.forEach((q, idx) => {
        let kind = 'point';
        if (first && !p.from && idx === 0) kind = 'start';
        else if (!p.to && idx === p.pts.length - 1 && p.pts.length > 1) kind = 'end';
        else if (!p.to && idx === p.pts.length - 1 && p.from) kind = 'end';
        if (sel && sel.id === p.id && sel.idx === idx) kind = 'sel';
        this.addPin(q.x, q.z, kind, p.id, idx);
      });
      if (c && c.from) this.addPin(c.xs[0], c.zs[0], 'join', p.id, -1);
      if (c && c.to) this.addPin(c.xs[c.n - 1], c.zs[c.n - 1], 'join', p.id, -2);
      if (!p.from) first = false;
      if (c) {
        const pos = new Float32Array(c.n * 3);
        for (let k = 0; k < c.n; k++) {
          pos[k * 3] = c.xs[k];
          pos[k * 3 + 1] = hf.heightAt(c.xs[k], c.zs[k]) + 0.6;
          pos[k * 3 + 2] = c.zs[k];
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const line = new THREE.Line(g, this.lineMat);
        line.computeLineDistances();
        line.renderOrder = 9;
        this.lines.push(line);
        this.group.add(line);
      }
    }
  }

  addPin(x, z, kind, id, idx) {
    const s = new THREE.Sprite(this.mats[kind]);
    s.position.set(x, this.hf.heightAt(x, z) + 1.2, z);
    s.renderOrder = kind === 'join' ? 10 : 11;
    this.pins.push({ sprite: s, id, idx, x, z, kind });
    this.group.add(s);
  }

  // the next stretch of piste, from (ax, az) to under the mouse; or a lone pin to start one
  setPreview(a, b) {
    if (!b) {
      this.preview.visible = false;
      this.ghost.visible = false;
      return;
    }
    const hf = this.hf;
    this.ghost.visible = true;
    this.ghost.position.set(b.x, hf.heightAt(b.x, b.z) + 1.2, b.z);
    if (!a) {
      this.preview.visible = false;
      return;
    }
    const n = 24;
    const pos = new Float32Array((n + 1) * 3);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      pos[i * 3] = x;
      pos[i * 3 + 1] = hf.heightAt(x, z) + 0.8;
      pos[i * 3 + 2] = z;
    }
    this.preview.geometry.dispose();
    this.preview.geometry = new THREE.BufferGeometry();
    this.preview.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.preview.computeLineDistances();
    this.preview.visible = true;
  }

  // keep the pins the same size on screen
  update(camera, heightPx) {
    const k = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, heightPx);
    for (const p of this.pins) {
      const s = (p.kind === 'join' ? 0.75 : p.kind === 'sel' ? 1.15 : 1) * PIN_PX * k;
      p.sprite.scale.set(s, s, 1);
    }
    this.ghost.scale.set(PIN_PX * k, PIN_PX * k, 1);
  }

  // the waypoint pin under a screen point (within `radius` px), or null
  pick(camera, rect, cx, cy, radius = 26) {
    const v = new THREE.Vector3();
    let best = null;
    for (const p of this.pins) {
      if (p.idx < 0) continue;
      v.copy(p.sprite.position).project(camera);
      if (v.z > 1) continue;
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(sx - cx, sy - cy);
      if (d < radius && (!best || d < best.d)) best = { d, id: p.id, idx: p.idx };
    }
    return best;
  }

  set visible(v) {
    this.group.visible = v;
  }

  get visible() {
    return this.group.visible;
  }
}
