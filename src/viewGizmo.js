// The view gizmo, Blender style: the three axes as seen from the camera, in a small disc in
// the corner. Click an axis to look along it (Z from above, -Y from the bottom of the slope
// looking up it, X from the side), drag the disc to turn the view.
//
// Axes the Blender way: Z up, Y up the slope (so -Y is "front": downhill, looking back up
// the fall line), X across it. In three.js terms X = +x, Y = -z, Z = +y.

import * as THREE from 'three';
import { t, onLang } from './i18n.js';

export const AXES = [
  { id: 'x', color: '#e8463a', dir: [1, 0, 0] },
  { id: 'y', color: '#5cb83a', dir: [0, 0, -1] },
  { id: 'z', color: '#3a7be8', dir: [0, 1, 0] },
];
const R = 31; // the bubbles' distance from the middle (the disc is 100 across)

/**
 * The six bubbles as the camera (quaternion q) sees them: [{ id: '+x' | '-x' ..., color,
 * dir (from the target towards where the camera goes), x, y (on the disc, y down), depth }]
 * nearest last, so drawing in order puts them on top.
 */
export function gizmoPoints(q) {
  const inv = new THREE.Quaternion(q.x, q.y, q.z, q.w).invert();
  const v = new THREE.Vector3();
  const out = [];
  for (const a of AXES) {
    for (const s of [1, -1]) {
      v.set(a.dir[0] * s, a.dir[1] * s, a.dir[2] * s).applyQuaternion(inv);
      out.push({ id: `${s > 0 ? '+' : '-'}${a.id}`, axis: a.id, sign: s, color: a.color, dir: a.dir.map((c) => c * s), x: v.x * R, y: -v.y * R, depth: v.z });
    }
  }
  return out.sort((a, b) => a.depth - b.depth);
}

// the camera's way from its target for a view along an axis bubble: from +z (above), the
// top of the screen is up the slope
export function viewDirection(id) {
  const a = AXES.find((x) => x.id === id[1]);
  const s = id[0] === '-' ? -1 : 1;
  const d = new THREE.Vector3(a.dir[0] * s, a.dir[1] * s, a.dir[2] * s);
  if (Math.abs(d.y) > 0.99) d.set(0, d.y, 0.002).normalize();
  return d;
}

export function createGizmo({ onView, onOrbit, onHome }) {
  const root = document.createElement('div');
  root.className = 'gizmo';
  root.innerHTML = `<svg viewBox="-50 -50 100 100" aria-hidden="false"><circle class="gz-bg" r="48"/><g class="gz-axes"></g></svg>
    <button type="button" class="gz-home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/></svg></button>`;
  document.body.appendChild(root);
  const g = root.querySelector('.gz-axes');
  const home = root.querySelector('.gz-home');
  const label = () => {
    root.querySelector('svg').setAttribute('aria-label', t('gz.label'));
    home.title = t('gz.home');
    home.setAttribute('aria-label', t('gz.home'));
  };
  label();
  onLang(() => {
    label();
    last = '';
  });
  let last = '';
  let drag = null;

  function draw(q) {
    const key = `${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)},${q.w.toFixed(3)}`;
    if (key === last) return;
    last = key;
    const pts = gizmoPoints(q);
    let html = '';
    // the lines to the positive bubbles, then the bubbles back to front
    for (const p of pts) if (p.sign > 0) html += `<line x1="0" y1="0" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="${p.color}" stroke-width="3" stroke-linecap="round" opacity="${(0.55 + 0.45 * Math.max(0, p.depth)).toFixed(2)}"/>`;
    for (const p of pts) {
      const tip = t(`gz.${p.id[0] === '+' ? 'p' : 'm'}${p.axis}`);
      if (p.sign > 0) {
        html += `<g class="gz-b" data-id="${p.id}"><title>${tip}</title><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="10.5" fill="${p.color}"/><text x="${p.x.toFixed(1)}" y="${(p.y + 4.2).toFixed(1)}">${p.axis.toUpperCase()}</text></g>`;
      } else {
        html += `<g class="gz-b gz-neg" data-id="${p.id}"><title>${tip}</title><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="8.5" fill="${p.color}" fill-opacity="0.28" stroke="${p.color}" stroke-width="2"/></g>`;
      }
    }
    g.innerHTML = html;
  }

  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.gz-home')) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { x: e.clientX, y: e.clientY, moved: false, id: e.target.closest('.gz-b')?.dataset.id || null, pointerId: e.pointerId };
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    onOrbit(dx, dy);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    if (!d.moved && d.id && e.type === 'pointerup') onView(d.id);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  home.addEventListener('click', () => onHome());

  return {
    update(camera) {
      draw(camera.quaternion);
    },
    el: root,
  };
}
