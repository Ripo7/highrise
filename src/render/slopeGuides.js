import * as THREE from 'three';
import { profile, elevationAt, sectionStarts, designLength, difficulty, TOP } from '../core/slopes.js';
import { DIFF_COLORS } from '../pieceIcons.js';
import { num } from '../i18n.js';

// The slope editor in 3D: over the snow, each section's label (its number, pitch and
// length, in its piste colour), a handle at the bottom of each section to drag (along the
// slope: its length; up and down: its pitch), and the profile down the middle of the slope
// as it will be (it leads the snow while you drag). The tint of the sections on the snow
// itself is the terrain shader's (sectionTexture).

export const SECTION_TEXELS = 1024;
const LABEL_H = 0.034; // of the view's height
const HANDLE = 0.026;

function pill(text, color, picked) {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 72;
  const g = c.getContext('2d');
  g.font = '700 34px Fredoka, "Trebuchet MS", sans-serif';
  const w = Math.min(312, g.measureText(text).width + 40);
  const x = (320 - w) / 2;
  g.beginPath();
  if (g.roundRect) g.roundRect(x, 6, w, 60, 30);
  else g.rect(x, 6, w, 60);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = picked ? 7 : 4;
  g.strokeStyle = picked ? '#ffffff' : 'rgba(255,255,255,0.65)';
  g.stroke();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 160, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function dot(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(32, 32, 24, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = color;
  g.stroke();
  g.beginPath();
  g.arc(32, 32, 7, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// the sections on the snow, for the terrain shader: one texel per 1/SECTION_TEXELS of the
// length (see terrainMesh.js uSecTex)
export function sectionTexture(design, picked) {
  const d = new Uint8Array(SECTION_TEXELS * 4);
  const L = designLength(design);
  const starts = sectionStarts(design);
  let k = 0;
  for (let i = 0; i < SECTION_TEXELS; i++) {
    const u = ((i + 0.5) / SECTION_TEXELS) * L;
    while (k < starts.length - 1 && u >= starts[k + 1]) k++;
    // (a THREE.Color holds linear values, what the shader works in)
    const c = new THREE.Color(DIFF_COLORS[difficulty(design.sections[k].slope)]);
    d[i * 4] = Math.round(c.r * 255);
    d[i * 4 + 1] = Math.round(c.g * 255);
    d[i * 4 + 2] = Math.round(c.b * 255);
    d[i * 4 + 3] = 100 + (k % 2) * 40 + (k === picked ? 100 : 0);
  }
  return d;
}

export class SlopeGuides {
  constructor(hf) {
    this.hf = hf;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.labels = [];
    this.handles = [];
    this.line = null;
    this.dots = new Map();
  }

  get visible() {
    return this.group.visible;
  }
  set visible(v) {
    this.group.visible = v;
  }

  dot(color) {
    if (!this.dots.has(color)) this.dots.set(color, dot(color));
    return this.dots.get(color);
  }

  clear() {
    for (const s of this.labels) {
      s.material.map.dispose();
      s.material.dispose();
    }
    for (const s of this.handles) s.material.dispose();
    if (this.line) {
      this.line.geometry.dispose();
      this.line.material.dispose();
    }
    this.labels = [];
    this.handles = [];
    this.line = null;
    this.group.clear();
  }

  // where u metres down the slope is, on the design's profile (y: TOP + its height)
  at(u, design, p = profile(design)) {
    return new THREE.Vector3(0, TOP + elevationAt(p, u, design), this.hf.startZ + u);
  }

  /** The design as it is (maybe not built yet), section `picked` picked out. */
  set(design, picked) {
    this.clear();
    const p = profile(design);
    const starts = sectionStarts(design);
    design.sections.forEach((s, i) => {
      const color = DIFF_COLORS[difficulty(s.slope)];
      const mid = starts[i] + s.length / 2;
      const text = `${i + 1} · ${s.slope < 0 ? '↑ ' : ''}${num(Math.abs(s.slope))}° · ${num(s.length)} m`;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: pill(text, color, i === picked), sizeAttenuation: false, depthTest: false, transparent: true }));
      const k = i === picked ? 1.2 : 1;
      label.scale.set(LABEL_H * k * (320 / 72), LABEL_H * k, 1);
      label.position.copy(this.at(mid, design, p)).add(new THREE.Vector3(0, 9, 0));
      label.renderOrder = 10;
      label.userData.section = i;
      this.labels.push(label);
      this.group.add(label);
      // the handle at its bottom
      const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dot(color), sizeAttenuation: false, depthTest: false, transparent: true }));
      h.scale.setScalar(HANDLE * (i === picked ? 1.25 : 1));
      h.position.copy(this.at(starts[i] + s.length, design, p)).add(new THREE.Vector3(0, 1.2, 0));
      h.renderOrder = 11;
      h.userData.section = i;
      this.handles.push(h);
      this.group.add(h);
    });
    // the profile, in each section's colour
    const pts = [];
    const colors = [];
    const L = p.L;
    let k = 0;
    for (let u = 0; u <= L; u += Math.max(1, L / 600)) {
      while (k < starts.length - 1 && u >= starts[k + 1]) k++;
      const v = this.at(u, design, p);
      pts.push(v.x, v.y + 0.6, v.z);
      const c = new THREE.Color(DIFF_COLORS[difficulty(design.sections[k].slope)]);
      colors.push(c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
    this.line.renderOrder = 9;
    this.group.add(this.line);
  }

  // the handle (or else the label) nearest to screen point (x, y) in pixels, within reach:
  // { kind: 'handle' | 'label', section } or null
  pick(camera, x, y, w, h, reach = 26) {
    let best = null;
    const v = new THREE.Vector3();
    const test = (list, kind, r) => {
      for (const s of list) {
        v.copy(s.position).project(camera);
        if (v.z > 1) continue;
        const sx = ((v.x + 1) / 2) * w;
        const sy = ((1 - v.y) / 2) * h;
        const d = kind === 'label' ? Math.max(Math.abs(sx - x) - (s.scale.x * h) / 2, Math.abs(sy - y) - (s.scale.y * h) / 2) : Math.hypot(sx - x, sy - y);
        if (d < r && (!best || d < best.d)) best = { kind, section: s.userData.section, d };
      }
    };
    test(this.handles, 'handle', reach);
    if (!best) test(this.labels, 'label', 4);
    return best;
  }
}
