// The run designer: draw the descent seen from the side, then build it in 3D.
//
// - The line always starts at the flag. Press anywhere: the line is cut at that point
//   along the run and continues towards your finger, never steeper than the drawable range.
// - Hold near the right (or bottom) edge and the view zooms out, so the run keeps
//   growing for as long as you hold, up to 4 km.
// - Move back to erase. Undo restores the previous stroke.
// - Angles are true (1:1 scale) and coloured like piste markers.

import {
  resample,
  smooth,
  clampSlopes,
  profileStats,
  difficulty,
  PROFILE_STEP,
  MAX_LENGTH,
  MAX_DOWN_DEG,
  MAX_UP_DEG,
  MIN_LENGTH,
  MIN_DROP,
} from './core/profile.js';

const COLORS = { green: '#22a35a', blue: '#2f6fd6', red: '#e0412f', black: '#14202b', up: '#8a6fd8' };
const DOWN = Math.tan((MAX_DOWN_DEG * Math.PI) / 180);
const UP = Math.tan((MAX_UP_DEG * Math.PI) / 180);
const deg = (rad) => (rad * 180) / Math.PI;

export class ProfileEditor {
  constructor({ onBuild, onCancel }) {
    this.onBuild = onBuild;
    this.onCancel = onCancel;
    this.root = document.getElementById('profile');
    this.canvas = document.getElementById('profile-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.head = this.root.querySelector('.profile-head');
    this.foot = this.root.querySelector('.profile-foot');
    this.read = {
      len: document.getElementById('pr-len'),
      drop: document.getElementById('pr-drop'),
      avg: document.getElementById('pr-avg'),
      max: document.getElementById('pr-max'),
    };
    this.buildBtn = document.getElementById('pr-build');
    this.cancelBtn = document.getElementById('pr-cancel');
    this.undoBtn = document.getElementById('pr-undo');
    this.hintEl = document.getElementById('profile-hint');
    this.points = [[0, 0]];
    this.undoStack = [];
    this.view = { s: 1, eTop: 10, targetS: 1, targetTop: 10 };
    this.drawing = null; // { id, x, y, startU }
    this.isOpen = false;
    this._raf = 0;
    this._last = 0;
    this.attach();
  }

  attach() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (this.drawing) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      this.startStroke(e.pointerId, e.clientX, e.clientY);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.drawing || e.pointerId !== this.drawing.id) return;
      this.drawing.x = e.clientX;
      this.drawing.y = e.clientY;
      this.addPen();
    });
    const end = (e) => {
      if (!this.drawing || e.pointerId !== this.drawing.id) return;
      this.endStroke();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('lostpointercapture', end);
    this.undoBtn.addEventListener('click', () => this.undo());
    document.getElementById('pr-clear').addEventListener('click', () => {
      if (this.points.length < 2) return;
      this.undoStack.push(this.points.map((p) => [...p]));
      this.points = [[0, 0]];
      this.changed(true);
    });
    this.cancelBtn.addEventListener('click', () => this.onCancel?.());
    this.buildBtn.addEventListener('click', () => this.build());
    window.addEventListener('resize', () => this.isOpen && this.resize(true));
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undo();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.build();
      } else if (e.key === 'Escape' && !this.cancelBtn.hidden) {
        this.onCancel?.();
      }
    });
  }

  // e: existing profile (elevations every PROFILE_STEP m) or null for a blank page
  open(e, { canCancel = true } = {}) {
    this.points = e && e.length > 1 ? e.map((v, i) => [i * PROFILE_STEP, v]) : [[0, 0]];
    this.undoStack = [];
    this.cancelBtn.hidden = !canCancel;
    this.root.hidden = false;
    document.body.classList.add('designing');
    this.isOpen = true;
    this.resize(true);
    this.changed(true);
    this._last = performance.now();
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame((t) => this.tick(t));
  }

  close() {
    this.isOpen = false;
    this.drawing = null;
    this.root.hidden = true;
    document.body.classList.remove('designing');
    cancelAnimationFrame(this._raf);
  }

  get profile() {
    return resample(this.points);
  }

  build() {
    const e = this.profile;
    if (!profileStats(e).ok) return;
    this.onBuild?.(e);
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.points = prev;
    this.changed(true);
  }

  // ---------- geometry ----------
  get pads() {
    const r = this.canvas.getBoundingClientRect();
    const head = this.head.getBoundingClientRect();
    const foot = this.foot.getBoundingClientRect();
    const narrow = r.width < 600;
    return {
      W: r.width,
      H: r.height,
      left: r.left,
      top: r.top,
      padL: narrow ? 44 : 72,
      padR: narrow ? 26 : 56,
      padT: Math.max(head.bottom - r.top + (narrow ? 50 : 64), 80),
      padB: Math.max(r.bottom - foot.top + 34, 60),
    };
  }

  toScreen(u, e) {
    const p = this._pads;
    return [p.padL + u * this.view.s, p.padT + (this.view.eTop - e) * this.view.s];
  }

  toWorld(cx, cy) {
    const p = this._pads;
    const x = cx - p.left;
    const y = cy - p.top;
    return [(x - p.padL) / this.view.s, this.view.eTop - (y - p.padT) / this.view.s];
  }

  // the view that frames the whole line (with room to keep drawing)
  fitTarget() {
    const p = this._pads;
    let minE = 0;
    let maxE = 0;
    for (const [, e] of this.points) {
      minE = Math.min(minE, e);
      maxE = Math.max(maxE, e);
    }
    const L = Math.max(450, this.points[this.points.length - 1][0] * 1.12);
    const top = maxE + 12;
    const depth = Math.max(220, (top - minE) * 1.12);
    const s = Math.min((p.W - p.padL - p.padR) / L, (p.H - p.padT - p.padB) / depth, 3);
    return { s, top };
  }

  resize(snap) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.dpr = dpr;
    this._pads = this.pads;
    const t = this.fitTarget();
    this.view.targetS = t.s;
    this.view.targetTop = t.top;
    if (snap) {
      this.view.s = t.s;
      this.view.eTop = t.top;
    }
  }

  // ---------- drawing ----------
  startStroke(id, x, y) {
    this._pads = this.pads;
    this.undoStack.push(this.points.map((p) => [...p]));
    if (this.undoStack.length > 40) this.undoStack.shift();
    const [u] = this.toWorld(x, y);
    const end = this.points[this.points.length - 1][0];
    const u0 = Math.max(0, Math.min(end, u));
    this.cutAt(u0);
    this.drawing = { id, x, y, startU: u0 };
    this.addPen();
  }

  // keep the line up to distance u (interpolating the cut point)
  cutAt(u) {
    const pts = this.points;
    if (u >= pts[pts.length - 1][0]) return;
    let k = 0;
    while (k < pts.length - 1 && pts[k + 1][0] <= u) k++;
    const keep = pts.slice(0, k + 1);
    if (k < pts.length - 1 && u > pts[k][0]) {
      const [u0, e0] = pts[k];
      const [u1, e1] = pts[k + 1];
      keep.push([u, e0 + ((e1 - e0) * (u - u0)) / (u1 - u0)]);
    }
    this.points = keep;
  }

  addPen() {
    const d = this.drawing;
    if (!d) return;
    const [u, e] = this.toWorld(d.x, d.y);
    const pts = this.points;
    let [lu, le] = pts[pts.length - 1];
    // moving back erases (but never past the start)
    if (u < lu - 6) {
      this.cutAt(Math.max(0, u));
      this.changed(false);
      return;
    }
    const target = Math.min(u, MAX_LENGTH);
    if (target < lu + 2) return;
    // walk towards the finger in ≤ 4 m steps, never steeper than the drawable range
    while (lu < target - 0.01) {
      const du = Math.min(4, target - lu);
      const want = le + ((e - le) * du) / Math.max(du, target - lu);
      const ne = Math.max(le - DOWN * du, Math.min(le + UP * du, want));
      lu += du;
      le = ne;
      pts.push([lu, le]);
    }
    this.changed(false);
  }

  endStroke() {
    const d = this.drawing;
    this.drawing = null;
    if (!d) return;
    // tidy: resample to the profile grid, keep angles in range, soften the new part only
    const from = Math.max(1, Math.floor(d.startU / PROFILE_STEP) - 2);
    const e = smooth(clampSlopes(resample(this.points)), 2, from);
    this.points = e.map((v, i) => [i * PROFILE_STEP, v]);
    this.changed(true);
  }

  changed(refit) {
    if (refit && this._pads) {
      const t = this.fitTarget();
      this.view.targetS = t.s;
      this.view.targetTop = t.top;
    }
    const e = this.points.length > 1 ? resample(this.points) : [0];
    const st = profileStats(e);
    this.stats = st;
    const fmt = (n) => Math.round(n).toLocaleString('en-US');
    this.read.len.textContent = `${fmt(st.length)} m`;
    this.read.drop.textContent = `${fmt(Math.max(0, st.drop))} m`;
    this.read.avg.textContent = `${Math.max(0, st.avgDeg).toFixed(0)}°`;
    const dmax = difficulty(st.maxDeg);
    this.read.max.innerHTML = `<i class="diff" data-d="${dmax}"></i>${st.maxDeg.toFixed(0)}°`;
    this.buildBtn.disabled = !st.ok;
    this.undoBtn.disabled = !this.undoStack.length;
    if (this.points.length < 2) this.hintEl.textContent = 'Start at the flag and drag down to the right. The steeper you draw, the steeper the slope.';
    else if (!st.ok) this.hintEl.textContent = `Keep going: a run needs at least ${MIN_LENGTH} m and ${MIN_DROP} m of drop.`;
    else if (st.length >= MAX_LENGTH - 4) this.hintEl.textContent = 'That’s the 4 km maximum. Build it, or reshape it.';
    else this.hintEl.textContent = 'Hold near the right edge to keep going. Press on the line to redraw from there, move back to erase.';
    this.dirty = true;
  }

  // ---------- frame ----------
  tick(t) {
    if (!this.isOpen) return;
    const dt = Math.min(0.05, (t - this._last) / 1000);
    this._last = t;
    const v = this.view;
    const d = this.drawing;
    if (d) {
      // pen near the right or bottom edge: zoom out so the run keeps growing
      const p = this._pads;
      const x = d.x - p.left;
      const y = d.y - p.top;
      const edgeR = x > p.W - p.padR - 18;
      const edgeB = y > p.H - p.padB - 6;
      if ((edgeR || edgeB) && this.points[this.points.length - 1][0] < MAX_LENGTH) {
        v.s *= Math.exp(-0.75 * dt);
        v.targetS = v.s;
        this.addPen();
        this.dirty = true;
      }
    } else if (Math.abs(v.s - v.targetS) > 1e-4 || Math.abs(v.eTop - v.targetTop) > 0.05) {
      const k = 1 - Math.exp(-dt * 9);
      v.s += (v.targetS - v.s) * k;
      v.eTop += (v.targetTop - v.eTop) * k;
      this.dirty = true;
    }
    if (this.dirty) this.draw();
    this._raf = requestAnimationFrame((tt) => this.tick(tt));
  }

  draw() {
    this.dirty = false;
    const ctx = this.ctx;
    const p = this._pads;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, p.W, p.H);
    const s = this.view.s;

    // grid: distance down the run and elevation, in a "nice" step
    const steps = [10, 25, 50, 100, 200, 250, 500, 1000];
    const step = steps.find((g) => g * s >= 64) ?? 1000;
    const [uMax] = this.toWorld(p.left + p.W, 0);
    const [, eMin] = this.toWorld(0, p.top + p.H);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(20, 32, 43, 0.07)';
    for (let u = 0; u <= uMax; u += step) {
      const [x] = this.toScreen(u, 0);
      ctx.beginPath();
      ctx.moveTo(x, p.padT - 20);
      ctx.lineTo(x, p.H - p.padB + 14);
      ctx.stroke();
    }
    for (let e = 0; e >= eMin; e -= step) {
      const [, y] = this.toScreen(0, e);
      if (y < p.padT - 20) continue;
      ctx.beginPath();
      ctx.moveTo(p.padL - 8, y);
      ctx.lineTo(p.W - p.padR + 20, y);
      ctx.stroke();
    }

    const pts = this.points;
    if (pts.length < 2) this.drawEmptyHint();
    else {
      // the mountain under the line
      const g = ctx.createLinearGradient(0, p.padT, 0, p.H);
      g.addColorStop(0, '#fbfcfd');
      g.addColorStop(1, '#d5e0ea');
      ctx.fillStyle = g;
      ctx.beginPath();
      const [x0, y0] = this.toScreen(0, pts[0][1]);
      ctx.moveTo(x0 - 6, y0);
      for (const [u, e] of pts) ctx.lineTo(...this.toScreen(u, e));
      const [xl, yl] = this.toScreen(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.lineTo(xl + 30, yl + 4);
      ctx.lineTo(xl + 30, p.H);
      ctx.lineTo(x0 - 6, p.H);
      ctx.closePath();
      ctx.fill();

      // the line, coloured by steepness over ~12 m
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 9;
      ctx.beginPath();
      pts.forEach(([u, e], i) => (i ? ctx.lineTo(...this.toScreen(u, e)) : ctx.moveTo(...this.toScreen(u, e))));
      ctx.stroke();
      ctx.lineWidth = 5;
      const w = Math.max(1, Math.round(12 / 4));
      for (let i = 1; i < pts.length; i++) {
        const a = pts[Math.max(0, i - w)];
        const b = pts[Math.min(pts.length - 1, i + w - 1)];
        const angle = deg(Math.atan2(a[1] - b[1], b[0] - a[0]));
        ctx.strokeStyle = COLORS[difficulty(angle)];
        ctx.beginPath();
        ctx.moveTo(...this.toScreen(...pts[i - 1]));
        ctx.lineTo(...this.toScreen(...pts[i]));
        ctx.stroke();
      }
      if (pts[pts.length - 1][0] > 40) this.drawFlag(...this.toScreen(...pts[pts.length - 1]), 'finish');
    }
    this.drawFlag(...this.toScreen(0, 0), 'start');

    // scale labels on top of everything: distance along the bottom, elevation on the left
    ctx.font = '600 11px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.fillStyle = 'rgba(20, 32, 43, 0.55)';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (let u = step; u <= uMax; u += step) {
      const [x] = this.toScreen(u, 0);
      ctx.fillText(`${u} m`, x + 3, p.H - p.padB + 4);
    }
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let e = -step; e >= eMin; e -= step) {
      const [, y] = this.toScreen(0, e);
      if (y < p.padT || y > p.H - p.padB) continue;
      ctx.fillText(`${e}`, p.padL - 10, y);
    }
    ctx.textAlign = 'left';

    // live angle at the pen
    if (this.drawing && pts.length > 3) {
      const n = pts.length;
      const a = pts[Math.max(0, n - 6)];
      const b = pts[n - 1];
      const angle = deg(Math.atan2(a[1] - b[1], b[0] - a[0]));
      const [x, y] = this.toScreen(b[0], b[1]);
      const label = `${Math.abs(angle).toFixed(0)}°${angle < -1 ? ' up' : ''}  ·  ${Math.round(b[0])} m`;
      ctx.font = '700 15px "Barlow Condensed", "Arial Narrow", sans-serif';
      const tw = ctx.measureText(label).width;
      const bx = Math.min(x + 16, p.W - tw - 30);
      const by = Math.max(y - 44, p.padT - 30);
      ctx.fillStyle = 'rgba(20, 32, 43, 0.88)';
      roundRect(ctx, bx, by, tw + 28, 28, 6);
      ctx.fill();
      ctx.fillStyle = COLORS[difficulty(angle)];
      ctx.beginPath();
      ctx.arc(bx + 12, by + 14, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eef3f6';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + 22, by + 14.5);
    }
  }

  drawEmptyHint() {
    const ctx = this.ctx;
    const [x0, y0] = this.toScreen(0, 0);
    const s = this.view.s;
    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = 'rgba(47, 111, 214, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    const L = 420;
    for (let u = 0; u <= L; u += 10) {
      const e = -Math.tan((20 * Math.PI) / 180) * u - 18 * Math.sin(u / 60);
      ctx.lineTo(x0 + u * s, y0 - e * s);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(20, 32, 43, 0.75)';
    ctx.font = '700 18px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('Drag from the flag →', x0 + 22, y0 - 30);
    ctx.restore();
  }

  drawFlag(x, y, kind) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#14202b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 30);
    ctx.stroke();
    if (kind === 'start') {
      ctx.fillStyle = '#2f6fd6';
      ctx.fillRect(x, y - 30, 22, 13);
    } else {
      // chequered finish flag
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#14202b' : '#ffffff';
          ctx.fillRect(x + i * 5, y - 30 + j * 6, 5, 6);
        }
      }
      ctx.strokeStyle = '#14202b';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y - 30, 20, 12);
    }
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#14202b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
