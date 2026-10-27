// The run editor: the descent as a stack of sections, top to bottom.
//
// - A side view of the whole run sits at the top, coloured like piste markers. Tap it to
//   pick a section.
// - Below, one card per section. The open card has steppers for the slope, length, piste
//   width and bend, ups and downs and the forest, and a grid of 20 m cells across the piste.
// - Tap a cell to put an element in it (jumps, nature, park, resort, piste), pick its size,
//   or remove it.
// - "Build this run" turns it into the 3D mountain.

import {
  CELL_M,
  GRID_COLS,
  LIMITS,
  WAVES,
  FOREST,
  MAX_SECTIONS,
  TEMPLATES,
  newSection,
  sectionRows,
  runLength,
  runStats,
  runGeometry,
  runProfile,
  sectionDifficulty,
  cloneRun,
  templateRun,
  normalizeSection,
} from './core/run.js';
import { MAX_LENGTH, PROFILE_STEP } from './core/profile.js';
import { ELEMENTS, CATEGORIES, sizeLabels } from './core/elements.js';
import { ELEMENT_ICONS, CATEGORY_COLORS } from './elementIcons.js';

const DIFF_COLORS = { green: '#22a35a', blue: '#2f6fd6', red: '#e0412f', black: '#3b2a55', up: '#8a6fd8' };
const DIFF_NAMES = { green: 'Green', blue: 'Blue', red: 'Red', black: 'Black', up: 'Climb' };
const icon = (k, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ELEMENT_ICONS[k] || ''}</svg>`;
const fmtLen = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const COL_NAMES = ['far left', 'left', 'left of centre', 'centre', 'right of centre', 'right', 'far right'];

const CONTROLS = [
  { key: 'slope', label: 'Slope', fmt: (v) => `${v}°` },
  { key: 'length', label: 'Length', fmt: (v) => `${v} m` },
  { key: 'width', label: 'Piste', fmt: (v) => `${v} m` },
  { key: 'bend', label: 'Bend', fmt: (v) => (v === 0 ? 'Straight' : `${v < 0 ? '←' : '→'} ${Math.abs(v)} m`) },
];

export class RunEditor {
  constructor({ onBuild, onCancel }) {
    this.onBuild = onBuild;
    this.onCancel = onCancel;
    const $ = (s) => document.getElementById(s);
    this.root = $('runed');
    this.canvas = $('re-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.list = $('re-list');
    this.scroll = $('re-scroll');
    this.tplRow = $('re-templates');
    this.sheet = $('re-sheet');
    this.read = { len: $('re-len'), drop: $('re-drop'), avg: $('re-avg'), max: $('re-max') };
    this.msg = $('re-msg');
    this.buildBtn = $('re-build');
    this.cancelBtn = $('re-cancel');
    this.undoBtn = $('re-undo');
    this.redoBtn = $('re-redo');
    this.addBtn = $('re-add');
    this.run = templateRun('starter');
    this.sel = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.isOpen = false;
    this.sheetAt = null; // { si, r, c }
    this.sheetCat = 'jumps';
    this.sheetSize = 1;
    this.hold = null;
    this.attach();
  }

  // ---------- lifecycle ----------

  // run: the current run, or null for a new one. focus: { si, r, c } opens that cell.
  open(run, { canCancel = true, focus = null } = {}) {
    const fresh = !run;
    this.run = fresh ? templateRun('starter') : cloneRun(run);
    this.run.sections.forEach(normalizeSection);
    this.sel = focus ? Math.min(focus.si, this.run.sections.length - 1) : 0;
    this.undoStack = [];
    this.redoStack = [];
    this.cancelBtn.hidden = !canCancel;
    this.tplRow.hidden = !fresh;
    this.root.hidden = false;
    document.body.classList.add('designing');
    this.isOpen = true;
    this.closeSheet();
    this.renderTemplates(fresh ? 'starter' : null);
    this.renderList();
    this.refresh();
    requestAnimationFrame(() => {
      this.resizeCanvas();
      this.draw();
      this.scrollToSel(false);
      if (focus && focus.r != null && focus.c != null && focus.r < sectionRows(this.run.sections[this.sel])) {
        this.openSheet(this.sel, focus.r, focus.c);
      }
    });
  }

  close() {
    this.isOpen = false;
    this.stopHold();
    this.closeSheet();
    this.root.hidden = true;
    document.body.classList.remove('designing');
  }

  build() {
    const st = runStats(this.run);
    if (!st.ok) return;
    this.onBuild?.(cloneRun(this.run));
  }

  // ---------- events ----------

  attach() {
    this.list.addEventListener('click', (e) => this.onListClick(e));
    this.list.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-step]');
      if (!b || b.disabled) return;
      e.preventDefault();
      const card = b.closest('[data-i]');
      this.startHold(+card.dataset.i, b.closest('[data-key]').dataset.key, +b.dataset.step);
    });
    const stop = () => this.stopHold();
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);

    this.canvas.addEventListener('pointerdown', (e) => {
      const u = this.uAtX(e.clientX);
      if (u == null) return;
      const si = this.sectionAtU(u);
      this.closeSheet();
      if (si !== this.sel) {
        this.sel = si;
        this.renderList();
        this.draw();
      }
      this.scrollToSel(true);
    });

    this.tplRow.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tpl]');
      if (!b) return;
      this.snapshot();
      this.run = templateRun(b.dataset.tpl);
      this.sel = 0;
      this.renderTemplates(b.dataset.tpl);
      this.renderList();
      this.refresh();
    });

    this.addBtn.addEventListener('click', () => this.addSection());
    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());
    this.cancelBtn.addEventListener('click', () => this.onCancel?.());
    this.buildBtn.addEventListener('click', () => this.build());

    // the element sheet
    this.sheet.addEventListener('click', (e) => {
      if (e.target === this.sheet) return this.closeSheet();
      const t = e.target.closest('[data-cat]');
      if (t) {
        this.sheetCat = t.dataset.cat;
        this.renderSheet();
        return;
      }
      const el = e.target.closest('[data-el]');
      if (el) return this.placeElement(el.dataset.el);
      const sz = e.target.closest('[data-size]');
      if (sz) return this.setSize(+sz.dataset.size);
      if (e.target.closest('#re-remove')) return this.removeElement();
      if (e.target.closest('#re-sheet-close')) return this.closeSheet();
    });

    window.addEventListener('resize', () => {
      if (!this.isOpen) return;
      this.resizeCanvas();
      this.draw();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? this.redo() : this.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (e.key === 'Escape') {
        if (this.sheetAt) this.closeSheet();
        else if (!this.cancelBtn.hidden) this.onCancel?.();
      } else if (e.key === 'Enter' && !this.sheetAt && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        this.build();
      }
    });
  }

  onListClick(e) {
    const card = e.target.closest('[data-i]');
    if (!card) return;
    const i = +card.dataset.i;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'select') {
      this.closeSheet();
      this.sel = this.sel === i ? -1 : i;
      this.renderList();
      this.draw();
      if (this.sel >= 0) this.scrollToSel(true);
      return;
    }
    const seg = e.target.closest('[data-seg]');
    if (seg) {
      const key = seg.closest('[data-key]').dataset.key;
      const v = +seg.dataset.seg;
      if (this.run.sections[i][key] === v) return;
      this.snapshot();
      this.run.sections[i][key] = v;
      this.changed(i);
      return;
    }
    const cell = e.target.closest('[data-r]');
    if (cell) {
      this.openSheet(i, +cell.dataset.r, +cell.dataset.c);
      return;
    }
    if (act === 'up' || act === 'down') this.moveSection(i, act === 'up' ? -1 : 1);
    else if (act === 'dup') this.duplicateSection(i);
    else if (act === 'del') this.deleteSection(i);
    else if (act === 'clear') {
      if (!this.run.sections[i].cells.length) return;
      this.snapshot();
      this.run.sections[i].cells = [];
      this.changed(i);
    }
  }

  // press-and-hold steppers: one step now, then repeating faster and faster
  startHold(i, key, dir) {
    this.stopHold();
    this.snapshot();
    let n = 0;
    const tick = () => {
      if (!this.stepValue(i, key, dir)) return this.stopHold();
      n++;
      this.hold.timer = setTimeout(tick, n < 2 ? 380 : n < 8 ? 110 : 55);
    };
    this.hold = { timer: 0 };
    tick();
  }

  stopHold() {
    if (!this.hold) return;
    clearTimeout(this.hold.timer);
    this.hold = null;
  }

  stepValue(i, key, dir) {
    const s = this.run.sections[i];
    const lim = LIMITS[key];
    let v = s[key] + dir * lim.step;
    if (key === 'length' && dir > 0 && runLength(this.run) + lim.step > MAX_LENGTH) return false;
    v = Math.max(lim.min, Math.min(lim.max, v));
    if (v === s[key]) return false;
    s[key] = v;
    this.changed(i);
    return true;
  }

  // ---------- sections ----------

  addSection() {
    if (this.run.sections.length >= MAX_SECTIONS) return;
    const room = MAX_LENGTH - runLength(this.run);
    if (room < LIMITS.length.min) return;
    this.snapshot();
    const last = this.run.sections[this.run.sections.length - 1];
    this.run.sections.push(
      newSection({ slope: last ? last.slope : 18, width: last ? last.width : 60, forest: last ? last.forest : 1, length: Math.min(80, room - (room % LIMITS.length.step)) })
    );
    this.sel = this.run.sections.length - 1;
    this.renderList();
    this.refresh();
    this.scrollToSel(true);
  }

  moveSection(i, d) {
    const j = i + d;
    if (j < 0 || j >= this.run.sections.length) return;
    this.snapshot();
    const a = this.run.sections;
    [a[i], a[j]] = [a[j], a[i]];
    this.sel = j;
    this.renderList();
    this.refresh();
    this.scrollToSel(true);
  }

  duplicateSection(i) {
    if (this.run.sections.length >= MAX_SECTIONS) return;
    const s = this.run.sections[i];
    if (runLength(this.run) + s.length > MAX_LENGTH) return;
    this.snapshot();
    const copy = newSection({ ...s, id: undefined, cells: s.cells.map((c) => ({ ...c })) });
    delete copy.id;
    this.run.sections.splice(i + 1, 0, normalizeSection(copy));
    this.sel = i + 1;
    this.renderList();
    this.refresh();
    this.scrollToSel(true);
  }

  deleteSection(i) {
    if (this.run.sections.length <= 1) return;
    this.snapshot();
    this.run.sections.splice(i, 1);
    this.sel = Math.min(i, this.run.sections.length - 1);
    this.closeSheet();
    this.renderList();
    this.refresh();
  }

  // ---------- undo ----------

  snapshot() {
    this.undoStack.push({ run: cloneRun(this.run), sel: this.sel });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
    this.refreshHistory();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push({ run: cloneRun(this.run), sel: this.sel });
    this.restore(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push({ run: cloneRun(this.run), sel: this.sel });
    this.restore(next);
  }

  restore(snap) {
    this.run = snap.run;
    this.sel = Math.min(snap.sel, this.run.sections.length - 1);
    this.closeSheet();
    this.renderList();
    this.refresh();
  }

  refreshHistory() {
    this.undoBtn.disabled = !this.undoStack.length;
    this.redoBtn.disabled = !this.redoStack.length;
  }

  // ---------- rendering ----------

  // one section changed: update its card in place (keeps held stepper buttons alive)
  changed(i) {
    const li = this.list.querySelector(`[data-i="${i}"]`);
    if (li) {
      li.querySelector('.sec-head').innerHTML = this.headHTML(i);
      const body = li.querySelector('.sec-body');
      if (body) {
        const s = this.run.sections[i];
        for (const c of CONTROLS) {
          const ctl = body.querySelector(`[data-key="${c.key}"]`);
          ctl.querySelector('output').textContent = c.fmt(s[c.key]);
          ctl.querySelector('[data-step="-1"]').disabled = s[c.key] <= LIMITS[c.key].min;
          ctl.querySelector('[data-step="1"]').disabled = s[c.key] >= LIMITS[c.key].max;
        }
        body.querySelectorAll('[data-key="waves"] [data-seg], [data-key="forest"] [data-seg]').forEach((b) => {
          const key = b.closest('[data-key]').dataset.key;
          b.setAttribute('aria-pressed', String(+b.dataset.seg === s[key]));
        });
        body.querySelector('.cells').outerHTML = this.gridHTML(i);
      }
    }
    if (this.sheetAt && this.sheetAt.si === i) this.renderSheet();
    this.refresh();
  }

  refresh() {
    const st = runStats(this.run);
    this.read.len.textContent = fmtLen(st.length);
    this.read.drop.textContent = `${Math.round(st.drop)} m`;
    this.read.avg.textContent = `${Math.round(st.avgDeg)}°`;
    this.read.max.innerHTML = `<i class="diff" data-d="${difficultyOf(st.maxDeg)}"></i>${Math.round(st.maxDeg)}°`;
    this.buildBtn.disabled = !st.ok;
    this.msg.textContent = st.ok ? `${this.run.sections.length} section${this.run.sections.length > 1 ? 's' : ''} · ${this.elementCount()} elements` : st.reason;
    this.msg.dataset.bad = st.ok ? '' : '1';
    this.addBtn.disabled = this.run.sections.length >= MAX_SECTIONS || runLength(this.run) + LIMITS.length.min > MAX_LENGTH;
    this.refreshHistory();
    this.geo = runGeometry(this.run);
    this.prof = runProfile(this.run, this.geo);
    this.draw();
  }

  elementCount() {
    let n = 0;
    for (const s of this.run.sections) n += s.cells.filter((c) => c.r < sectionRows(s)).length;
    return n;
  }

  renderTemplates(active) {
    this.tplRow.innerHTML =
      '<span class="tpl-label">Start from</span>' +
      TEMPLATES.map(
        (t) => `<button type="button" class="tpl" data-tpl="${t.id}" aria-pressed="${t.id === active}" title="${t.blurb}"><b>${t.name}</b><small>${t.blurb}</small></button>`
      ).join('');
  }

  renderList() {
    this.list.innerHTML = this.run.sections
      .map((s, i) => {
        const open = i === this.sel;
        return `<li class="sec${open ? ' open' : ''}" data-i="${i}" style="--diff:${DIFF_COLORS[sectionDifficulty(s)]}">
          <button class="sec-head" type="button" data-act="select" aria-expanded="${open}">${this.headHTML(i)}</button>
          ${open ? this.bodyHTML(i) : ''}
        </li>`;
      })
      .join('');
  }

  headHTML(i) {
    const s = this.run.sections[i];
    const d = sectionDifficulty(s);
    const rows = sectionRows(s);
    const els = s.cells.filter((c) => c.r < rows && ELEMENTS[c.k]);
    const kinds = [...new Set(els.map((c) => c.k))];
    const more = kinds.length > 4 ? `<span class="sec-more">+${kinds.length - 4}</span>` : '';
    return `<span class="sec-num">${i + 1}</span>
      <i class="diff" data-d="${d}" title="${DIFF_NAMES[d]}"></i>
      <span class="sec-sum"><b>${s.slope < 0 ? '↑' : ''}${Math.abs(s.slope)}°</b><span>${s.length} m</span><span class="sec-w">piste ${s.width} m</span></span>
      <span class="sec-els">${kinds
        .slice(0, 4)
        .map((k) => `<span class="mini" style="--c:${CATEGORY_COLORS[ELEMENTS[k].cat]}">${icon(k)}</span>`)
        .join('')}${more}</span>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
  }

  bodyHTML(i) {
    const s = this.run.sections[i];
    const n = this.run.sections.length;
    const ctl = CONTROLS.map(
      (c) => `<div class="ctl" data-key="${c.key}">
        <span class="ctl-l">${c.label}</span>
        <button type="button" class="step" data-step="-1" aria-label="Less ${c.label.toLowerCase()}" ${s[c.key] <= LIMITS[c.key].min ? 'disabled' : ''}>−</button>
        <output>${c.fmt(s[c.key])}</output>
        <button type="button" class="step" data-step="1" aria-label="More ${c.label.toLowerCase()}" ${s[c.key] >= LIMITS[c.key].max ? 'disabled' : ''}>+</button>
      </div>`
    ).join('');
    const seg = (key, label, opts) => `<div class="seg-row" data-key="${key}"><span class="ctl-l">${label}</span><div class="seg" role="group" aria-label="${label}">${opts
      .map((o, k) => `<button type="button" data-seg="${k}" aria-pressed="${s[key] === k}">${o.label}</button>`)
      .join('')}</div></div>`;
    return `<div class="sec-body">
      <div class="ctl-grid">${ctl}</div>
      ${seg('waves', 'Ups &amp; downs', WAVES)}
      ${seg('forest', 'Forest', FOREST)}
      <div class="grid-wrap">
        <div class="grid-top"><span>Left</span><span class="grid-tip">Tap a cell to add an element</span><span>Right</span></div>
        ${this.gridHTML(i)}
        <div class="grid-legend"><span><i class="lg lg-piste"></i>Groomed piste</span><span><i class="lg lg-powder"></i>Powder</span><span>↓ Downhill · 20 m cells</span></div>
      </div>
      <div class="sec-actions">
        <button type="button" class="btn btn-small" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move section up">↑</button>
        <button type="button" class="btn btn-small" data-act="down" ${i === n - 1 ? 'disabled' : ''} aria-label="Move section down">↓</button>
        <button type="button" class="btn btn-small" data-act="dup">Duplicate</button>
        <button type="button" class="btn btn-small" data-act="clear">Clear cells</button>
        <button type="button" class="btn btn-small btn-danger" data-act="del" ${n <= 1 ? 'disabled' : ''}>Delete</button>
      </div>
    </div>`;
  }

  gridHTML(i) {
    const s = this.run.sections[i];
    const rows = sectionRows(s);
    // which cell each element covers: its own, plus the rows below it
    const anchor = new Map();
    const cover = new Map();
    for (const c of s.cells) {
      if (c.r >= rows || !ELEMENTS[c.k]) continue;
      anchor.set(`${c.r},${c.c}`, c);
      const span = ELEMENTS[c.k].rows[c.s] || 1;
      for (let r = c.r + 1; r < Math.min(rows, c.r + span); r++) {
        if (!cover.has(`${r},${c.c}`)) cover.set(`${r},${c.c}`, { el: c, last: r === Math.min(rows, c.r + span) - 1 });
      }
    }
    const forest = (FOREST[s.forest] || FOREST[1]).d;
    let html = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const off = Math.abs((c - (GRID_COLS - 1) / 2) * CELL_M);
        const g = Math.max(0, Math.min(1, (s.width / 2 - (off - CELL_M / 2)) / CELL_M));
        const a = anchor.get(`${r},${c}`);
        const cv = cover.get(`${r},${c}`);
        const style = [`--g:${g.toFixed(2)}`, `--f:${(g < 1 ? forest * (1 - g) : 0).toFixed(2)}`];
        let cls = 'cell';
        let inner = '';
        let label = `Row ${r + 1}, ${COL_NAMES[c]}`;
        if (a) {
          const el = ELEMENTS[a.k];
          cls += ' has';
          style.push(`--c:${CATEGORY_COLORS[el.cat]}`);
          inner = `${icon(a.k)}<span class="cell-size">${'SML'[a.s]}</span>`;
          label += `: ${el.label}, ${sizeLabels(a.k)[a.s].toLowerCase()}`;
        } else if (cv) {
          cls += ` covered${cv.last ? ' last' : ''}`;
          style.push(`--c:${CATEGORY_COLORS[ELEMENTS[cv.el.k].cat]}`);
          label += `: part of the ${ELEMENTS[cv.el.k].label.toLowerCase()} above`;
        } else label += ': empty';
        if (this.sheetAt && this.sheetAt.si === i && this.sheetAt.r === r && this.sheetAt.c === c) cls += ' picked';
        html += `<button type="button" class="${cls}" data-r="${r}" data-c="${c}" style="${style.join(';')}" aria-label="${label}">${inner}</button>`;
      }
    }
    return `<div class="cells" style="--rows:${rows}">${html}</div>`;
  }

  scrollToSel(smooth) {
    const li = this.list.querySelector('.sec.open');
    if (!li) return;
    const box = this.scroll.getBoundingClientRect();
    const r = li.getBoundingClientRect();
    if (r.top < box.top || r.top > box.bottom - 80) {
      this.scroll.scrollTo({ top: this.scroll.scrollTop + r.top - box.top - 6, behavior: smooth ? 'smooth' : 'auto' });
    }
  }

  // ---------- the element sheet ----------

  cellAt(si, r, c) {
    return this.run.sections[si]?.cells.find((x) => x.r === r && x.c === c && ELEMENTS[x.k]);
  }

  openSheet(si, r, c) {
    this.sheetAt = { si, r, c };
    const cur = this.cellAt(si, r, c);
    if (cur) {
      this.sheetCat = ELEMENTS[cur.k].cat;
      this.sheetSize = cur.s;
    }
    this.sheet.hidden = false;
    this.root.classList.add('sheet-open');
    this.renderSheet();
    const li = this.list.querySelector(`[data-i="${si}"] .cells`);
    if (li) li.outerHTML = this.gridHTML(si);
    // keep the picked cell visible above the sheet
    requestAnimationFrame(() => {
      const cell = this.list.querySelector(`[data-i="${si}"] .cell.picked`);
      const card = this.sheet.querySelector('.sheet-card');
      if (!cell || !card) return;
      const cr = cell.getBoundingClientRect();
      const top = card.getBoundingClientRect().top;
      if (cr.bottom > top - 8) this.scroll.scrollBy({ top: cr.bottom - top + 24, behavior: 'smooth' });
    });
  }

  closeSheet() {
    if (!this.sheetAt) return;
    const si = this.sheetAt.si;
    this.sheetAt = null;
    this.sheet.hidden = true;
    this.root.classList.remove('sheet-open');
    const g = this.list.querySelector(`[data-i="${si}"] .cells`);
    if (g) g.outerHTML = this.gridHTML(si);
  }

  renderSheet() {
    const at = this.sheetAt;
    if (!at) return;
    const cur = this.cellAt(at.si, at.r, at.c);
    const size = cur ? cur.s : this.sheetSize;
    const sel = cur?.k;
    const els = Object.entries(ELEMENTS).filter(([, e]) => e.cat === this.sheetCat);
    const shown = sel || null;
    const sizes = sizeLabels(shown || els[0][0]);
    const hint = shown ? ELEMENTS[shown].hint : 'Pick an element for this cell.';
    this.sheet.innerHTML = `<div class="sheet-card panel" role="dialog" aria-label="Element for this cell">
      <div class="sheet-head">
        <div><p class="intro-eyebrow">Section ${at.si + 1} · row ${at.r + 1} · ${COL_NAMES[at.c]}</p>
        <h2>${shown ? ELEMENTS[shown].label : 'Add an element'}</h2></div>
        <button type="button" id="re-sheet-close" class="icon-btn" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="sheet-tabs" role="tablist">${CATEGORIES.map(
        (c) => `<button type="button" role="tab" data-cat="${c.id}" aria-selected="${c.id === this.sheetCat}" style="--c:${CATEGORY_COLORS[c.id]}">${c.label}</button>`
      ).join('')}</div>
      <div class="sheet-els">${els
        .map(
          ([k, e]) => `<button type="button" class="el" data-el="${k}" aria-pressed="${k === sel}" style="--c:${CATEGORY_COLORS[e.cat]}">${icon(k)}<span>${e.label}</span></button>`
        )
        .join('')}</div>
      <p class="sheet-hint">${hint}</p>
      <div class="sheet-foot">
        <div class="seg sheet-size" role="group" aria-label="Size">${sizes
          .map((l, k) => `<button type="button" data-size="${k}" aria-pressed="${k === size}">${l}</button>`)
          .join('')}</div>
        ${cur ? '<button type="button" id="re-remove" class="btn btn-small btn-danger">Remove</button>' : ''}
      </div>
    </div>`;
  }

  placeElement(k) {
    const at = this.sheetAt;
    if (!at) return;
    const s = this.run.sections[at.si];
    const cur = this.cellAt(at.si, at.r, at.c);
    if (cur && cur.k === k) return this.closeSheet();
    this.snapshot();
    s.cells = s.cells.filter((x) => !(x.r === at.r && x.c === at.c));
    s.cells.push({ r: at.r, c: at.c, k, s: this.sheetSize });
    this.sheetCat = ELEMENTS[k].cat;
    this.closeSheet();
    this.changed(at.si);
  }

  setSize(v) {
    this.sheetSize = v;
    const at = this.sheetAt;
    const cur = at && this.cellAt(at.si, at.r, at.c);
    if (cur && cur.s !== v) {
      this.snapshot();
      cur.s = v;
      this.changed(at.si);
      this.list.querySelector(`[data-i="${at.si}"] .cells`).outerHTML = this.gridHTML(at.si);
    } else this.renderSheet();
  }

  removeElement() {
    const at = this.sheetAt;
    if (!at) return;
    this.snapshot();
    const s = this.run.sections[at.si];
    s.cells = s.cells.filter((x) => !(x.r === at.r && x.c === at.c));
    this.closeSheet();
    this.changed(at.si);
  }

  // ---------- the side view ----------

  resizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
    this.cw = r.width;
    this.ch = r.height;
  }

  // the view: true angles (1:1), the whole run fitted in
  frame() {
    const prof = this.prof;
    const L = (prof.length - 1) * PROFILE_STEP;
    let lo = 0;
    let hi = 0;
    for (const v of prof) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const padL = 18;
    const padR = 22;
    const padT = 26;
    const padB = 16;
    const s = Math.min((this.cw - padL - padR) / Math.max(L, 1), (this.ch - padT - padB) / Math.max(hi - lo, 1), 4);
    const usedH = (hi - lo) * s;
    const top = padT + (this.ch - padT - padB - usedH) / 2;
    return { s, L, x: (u) => padL + u * s, y: (e) => top + (hi - e) * s, u: (x) => (x - padL) / s };
  }

  uAtX(clientX) {
    if (!this.prof) return null;
    const r = this.canvas.getBoundingClientRect();
    const f = this.frame();
    return Math.max(0, Math.min(f.L - 0.01, f.u(clientX - r.left)));
  }

  sectionAtU(u) {
    let acc = 0;
    for (let i = 0; i < this.run.sections.length; i++) {
      acc += this.run.sections[i].length;
      if (u < acc) return i;
    }
    return this.run.sections.length - 1;
  }

  draw() {
    if (!this.isOpen || !this.prof || !this.cw) return;
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    const f = this.frame();
    const prof = this.prof;
    const pt = (i) => [f.x(i * PROFILE_STEP), f.y(prof[i])];
    const starts = this.geo.starts;

    // selected section: a soft band
    if (this.sel >= 0 && this.sel < starts.length) {
      const u0 = starts[this.sel];
      const u1 = u0 + this.run.sections[this.sel].length;
      ctx.fillStyle = 'rgba(79, 123, 232, 0.12)';
      ctx.fillRect(f.x(u0), 0, (u1 - u0) * f.s, this.ch);
    }

    // the snow under the line
    const grad = ctx.createLinearGradient(0, 0, 0, this.ch);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#dfe3fb');
    ctx.beginPath();
    ctx.moveTo(f.x(0), this.ch);
    for (let i = 0; i < prof.length; i++) ctx.lineTo(...pt(i));
    ctx.lineTo(f.x(f.L), this.ch);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // the line, coloured by each stretch's angle
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const w = 4;
    for (let i = 1; i < prof.length; i++) {
      const [x0, y0] = pt(i - 1);
      const [x1, y1] = pt(i);
      // coloured by the section's slope (its waves don't change its colour)
      const si = this.geo.secOf[i];
      ctx.strokeStyle = DIFF_COLORS[sectionDifficulty(this.run.sections[si])];
      ctx.lineWidth = si === this.sel ? w + 2 : w;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // section joints and numbers
    ctx.font = '700 11px Fredoka, "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    starts.forEach((u0, i) => {
      const s = this.run.sections[i];
      const um = u0 + s.length / 2;
      const x = f.x(um);
      const y = f.y(sampleProf(prof, um));
      if (i > 0) {
        const xj = f.x(u0);
        ctx.strokeStyle = 'rgba(59, 42, 85, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(xj, 4);
        ctx.lineTo(xj, this.ch - 4);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // element markers along the line
      const rows = sectionRows(s);
      for (const c of s.cells) {
        if (c.r >= rows || !ELEMENTS[c.k]) continue;
        const u = u0 + (c.r + 0.5) * CELL_M;
        const ex = f.x(u);
        const ey = f.y(sampleProf(prof, u)) - 9 - (c.c % 2) * 4;
        ctx.fillStyle = CATEGORY_COLORS[ELEMENTS[c.k].cat];
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // number badge above the middle of the section
      if (s.length * f.s > 14) {
        const by = Math.max(10, y - 22);
        ctx.fillStyle = i === this.sel ? '#3b2a55' : '#fff8ef';
        ctx.strokeStyle = '#3b2a55';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, by, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = i === this.sel ? '#fff' : '#3b2a55';
        ctx.fillText(String(i + 1), x, by + 0.5);
      }
    });

    // start flag and finish
    const [sx, sy] = pt(0);
    ctx.strokeStyle = '#3b2a55';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy - 18);
    ctx.stroke();
    ctx.fillStyle = '#4f7be8';
    ctx.beginPath();
    ctx.moveTo(sx, sy - 18);
    ctx.lineTo(sx + 10, sy - 14);
    ctx.lineTo(sx, sy - 10);
    ctx.fill();
    const [fx, fy] = pt(prof.length - 1);
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = k % 2 ? '#3b2a55' : '#fff';
      ctx.fillRect(fx - 4, fy - 18 + k * 4, 4, 4);
      ctx.fillStyle = k % 2 ? '#fff' : '#3b2a55';
      ctx.fillRect(fx, fy - 18 + k * 4, 4, 4);
    }
    ctx.strokeStyle = '#3b2a55';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(fx - 4, fy - 18, 8, 16);
  }
}

function sampleProf(prof, u) {
  const f = u / PROFILE_STEP;
  const i = Math.max(0, Math.min(prof.length - 2, Math.floor(f)));
  const t = Math.max(0, Math.min(1, f - i));
  return prof[i] + (prof[i + 1] - prof[i]) * t;
}

function difficultyOf(deg) {
  if (deg < -1) return 'up';
  if (deg < 12) return 'green';
  if (deg < 22) return 'blue';
  if (deg < 32) return 'red';
  return 'black';
}
