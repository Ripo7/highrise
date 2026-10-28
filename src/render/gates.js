import * as THREE from 'three';
import { toonRamp } from './toon.js';

// The gates of the course (core/course.js): two poles with a numbered panel each, red and
// blue in turn like a slalom, and a line on the snow between them. While you build, each
// has its number floating above it, the same size at any distance. During a run a gate
// you've been through fades, a missed one goes grey. Nothing here collides.

const POLE_H = 3.4;
const PANEL_W = 1.6;
const PANEL_H = 1.2;
const LABEL_SIZE = 0.042; // of the view's height (at a 40° field of view: about 5%)
export const GATE_COLORS = ['#e8463a', '#2f6fd6'];
const BEHIND = '#9a90a8';

// a round badge with the number, for the label
function badgeTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(48, 48, 42, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = '#fff';
  g.stroke();
  g.fillStyle = '#fff';
  g.font = `700 ${text.length > 1 ? 44 : 52}px Fredoka, "Trebuchet MS", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 48, 51);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function numberTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 100;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 100);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(0, 0, 128, 7);
  g.fillStyle = '#fff';
  g.font = '700 66px Fredoka, "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 56);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class GateMeshes {
  constructor(hf) {
    this.hf = hf;
    this.group = new THREE.Group();
    this.poleGeo = new THREE.CylinderGeometry(0.07, 0.08, POLE_H, 6);
    this.poleGeo.translate(0, POLE_H / 2, 0);
    this.panelGeo = new THREE.PlaneGeometry(PANEL_W, PANEL_H);
    this.poleMat = new THREE.MeshToonMaterial({ color: '#f4f0f7', gradientMap: toonRamp() });
    this.items = []; // per gate: { gate, mats: [panel materials], line }
    this.textures = new Map(); // made once per number and colour
    this.labels = new THREE.Group(); // the numbers over the gates, while building
    this.group.add(this.labels);
  }

  texture(kind, text, color) {
    const k = `${kind}:${text}:${color}`;
    if (!this.textures.has(k)) this.textures.set(k, kind === 'badge' ? badgeTexture(text, color) : numberTexture(text, color));
    return this.textures.get(k);
  }

  // the labels show while building, not on the ride
  set building(on) {
    this.labels.visible = on;
  }

  clear() {
    for (const it of this.items) {
      for (const m of it.mats) m.dispose();
      it.line.geometry.dispose();
      it.line.material.dispose();
      it.label.material.dispose();
    }
    this.items = [];
    for (const o of [...this.group.children]) if (o !== this.labels) this.group.remove(o);
    this.labels.clear();
  }

  // the gates as they are now (after an edit, or a new mountain)
  set(gates) {
    this.clear();
    const hf = this.hf;
    for (const g of gates) {
      const color = g.behind ? BEHIND : GATE_COLORS[(g.n - 1) % 2];
      const root = new THREE.Group();
      const mats = [];
      for (const side of [-1, 1]) {
        const x = g.x + g.across[0] * g.half * side;
        const z = g.z + g.across[1] * g.half * side;
        const y = hf.heightAt(x, z) - 0.1;
        const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
        pole.position.set(x, y, z);
        pole.castShadow = true;
        root.add(pole);
        // the panel hangs off the outside of its pole, facing up the slope
        const mat = new THREE.MeshBasicMaterial({ map: this.texture('panel', g.behind ? '–' : String(g.n), color), side: THREE.DoubleSide, transparent: true });
        mats.push(mat);
        const panel = new THREE.Mesh(this.panelGeo, mat);
        const off = (PANEL_W / 2 + 0.07) * side;
        panel.position.set(x + g.across[0] * off, y + POLE_H - PANEL_H / 2 - 0.05, z + g.across[1] * off);
        panel.rotation.y = Math.atan2(-g.dir[0], -g.dir[1]); // its front up the slope
        root.add(panel);
      }
      // the line on the snow, pole to pole
      const steps = Math.max(2, Math.ceil((2 * g.half) / 0.6));
      const pos = new Float32Array((steps + 1) * 2 * 3);
      const w = 0.16;
      for (let k = 0; k <= steps; k++) {
        const a = -g.half + (2 * g.half * k) / steps;
        for (const [m, s] of [
          [0, -1],
          [1, 1],
        ]) {
          const x = g.x + g.across[0] * a + g.dir[0] * w * s;
          const z = g.z + g.across[1] * a + g.dir[1] * w * s;
          const o = (k * 2 + m) * 3;
          pos[o] = x;
          pos[o + 1] = hf.heightAt(x, z) + 0.05;
          pos[o + 2] = z;
        }
      }
      const idx = [];
      for (let k = 0; k < steps; k++) {
        const a = k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx);
      const line = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: g.behind ? 0.4 : 0.85, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }));
      root.add(line);
      this.group.add(root);
      // the number over it
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture('badge', g.behind ? '–' : String(g.n), color), sizeAttenuation: false, depthWrite: false, transparent: true, opacity: g.behind ? 0.6 : 1 }));
      label.scale.setScalar(LABEL_SIZE);
      label.position.set(g.x, hf.heightAt(g.x, g.z) + POLE_H + 2.5, g.z);
      label.renderOrder = 5;
      this.labels.add(label);
      this.items.push({ gate: g, mats, line, label, root, state: null });
    }
  }

  // during a run: 'passed' | 'missed' | null for each gate that counts (course order)
  show(states) {
    let k = 0;
    for (const it of this.items) {
      if (it.gate.behind) continue;
      const st = states ? states[k] : null;
      k++;
      if (st === it.state) continue;
      it.state = st;
      for (const m of it.mats) {
        m.opacity = st === 'passed' ? 0.35 : 1;
        m.color.set(st === 'missed' ? '#555060' : '#ffffff');
      }
      it.line.material.opacity = st === 'passed' ? 0.25 : 0.85;
    }
  }
}
