// The slope editor: the first thing you do. Stack sections down the fall line, each with
// its pitch and its length, pick how wide the mountain is, and build it. Then shape it
// with the tiles. Opened again from the menu (Edit the slope) it starts from the slope you
// have, and can keep what you built on it.
//
//   - a side view of the whole slope, true to scale, coloured by steepness like piste
//     markers; the section you're on is picked out
//   - templates to start from, the width, then one row per section: press and hold the
//     − / + buttons to run through the values
//   - Build (Enter) builds it; Cancel (Esc) leaves things as they were

import {
  LIMITS,
  MAX_SECTIONS,
  MAX_LENGTH,
  WIDTHS,
  TEMPLATES,
  templateDesign,
  cloneDesign,
  sameDesign,
  normalizeDesign,
  designLength,
  designStats,
  sectionStarts,
  profile,
  difficulty,
} from './core/slopes.js';
import { t, num, onLang } from './i18n.js';

export const DIFF_COLORS = { green: '#22a35a', blue: '#2f6fd6', red: '#e0412f', black: '#3b2a55', up: '#8a6fd8' };
export const fmtLen = (m) => (m >= 1000 ? `${num(Math.round(m / 10) / 100)} km` : `${Math.round(m)} m`);
const fmtSlope = (v) => (v < 0 ? `↑ ${-v}°` : `${v}°`);

export function createSlopeEditor({ onBuild }) {
  const $ = (id) => document.getElementById(id);
  const root = $('slope');
  const canvas = $('sl-canvas');
  const list = $('sl-list');
  const tpl = $('sl-templates');
  const widthSeg = $('sl-width');
  const addBtn = $('sl-add');
  const msg = $('sl-msg');
  const goBtn = $('sl-go');
  const cancelBtn = $('sl-cancel');
  const keepRow = $('sl-keep-row');
  const keepBox = $('sl-keep');
  const read = { len: $('sl-len'), drop: $('sl-drop'), avg: $('sl-avg'), max: $('sl-max') };

  let design = templateDesign();
  let original = null; // the slope as it was when the editor opened (null: a first slope)
  let sel = 0;
  let hold = null;
  let canCancel = false;
  let layout = { ox: 0, k: 1 }; // the side view's scale, for taps on it
  let keepTiles = 0;
  let isNew = true;
  // the words that aren't plain page text
  const labels = () => {
    $('sl-keep-text').textContent = t('sl.keep', { n: keepTiles });
    $('sl-eyebrow').textContent = isNew ? t('sl.new') : t('sl.yours');
  };
  onLang(() => {
    labels();
    if (root.hidden) return;
    renderWidth();
    renderList();
    refresh();
  });

  // ---------- drawing ----------

  function draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(200, canvas.clientWidth);
    const H = Math.max(90, canvas.clientHeight);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const p = profile(design);
    const L = p.L;
    let lo = 0;
    let hi = 0;
    for (const v of p.e) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    // true to scale, fitted in the box with a margin, centred
    const pad = 10;
    const k = Math.min((W - 2 * pad) / L, (H - 2 * pad) / Math.max(1, hi - lo));
    const ox = (W - L * k) / 2;
    const oy = (H - (hi - lo) * k) / 2;
    const X = (u) => ox + u * k;
    const Y = (e) => oy + (hi - e) * k;
    layout = { ox, k };
    // snow under the line
    g.beginPath();
    g.moveTo(X(0), H);
    for (let u = 0; u <= L; u += 2) g.lineTo(X(u), Y(p.e[u]));
    g.lineTo(X(L), Y(p.e[L]));
    g.lineTo(X(L), H);
    g.closePath();
    g.fillStyle = '#e6e9ff';
    g.fill();
    // the line, section by section, in its colour
    const starts = sectionStarts(design);
    design.sections.forEach((s, i) => {
      const a = starts[i];
      const b = Math.min(L, a + s.length);
      g.beginPath();
      for (let u = a; u <= b; u += 1) (u === a ? g.moveTo : g.lineTo).call(g, X(u), Y(p.e[Math.round(u)]));
      g.strokeStyle = DIFF_COLORS[difficulty(s.slope)];
      g.lineWidth = i === sel ? 6 : 3.5;
      g.lineCap = 'round';
      g.stroke();
      // the joint
      if (i > 0) {
        g.beginPath();
        g.arc(X(a), Y(p.e[Math.round(a)]), 2.5, 0, Math.PI * 2);
        g.fillStyle = '#3b2a55';
        g.fill();
      }
    });
    // the selected section's number
    if (sel >= 0 && sel < design.sections.length) {
      const a = starts[sel];
      const m = Math.min(L, a + design.sections[sel].length / 2);
      const x = X(m);
      const y = Y(p.e[Math.round(m)]);
      g.font = '700 12px Fredoka, sans-serif';
      g.textAlign = 'center';
      g.fillStyle = '#3b2a55';
      g.fillText(String(sel + 1), x, Math.max(12, y - 10));
    }
  }

  // ---------- rendering ----------

  function renderTemplates() {
    tpl.innerHTML =
      `<span class="ctl-l">${t('sl.startFrom')}</span>` +
      TEMPLATES.map((x) => {
        const on = sameDesign({ ...templateDesign(x.id, design.width) }, design);
        const blurb = t(`tpl.${x.id}.blurb`);
        return `<button type="button" class="sl-tpl" data-tpl="${x.id}" aria-pressed="${on}" title="${blurb}"><b>${t(`tpl.${x.id}`)}</b><small>${blurb}</small></button>`;
      }).join('');
  }

  function renderWidth() {
    widthSeg.innerHTML = WIDTHS.map((w) => `<button type="button" data-width="${w.id}" aria-pressed="${w.id === design.width}">${t(`width.${w.id}`)}<small>${w.W} m</small></button>`).join('');
  }

  const stepper = (i, key, v) => {
    const lim = LIMITS[key];
    const label = (key === 'slope' ? t('sl.slope') : t('sl.length')).toLowerCase();
    const tooLong = key === 'length' && designLength(design) + lim.step > MAX_LENGTH;
    return `<div class="sl-ctl" data-key="${key}">
      <button type="button" class="step" data-step="-1" aria-label="${t('sl.less', { i: i + 1, what: label })}" ${v <= lim.min ? 'disabled' : ''}>−</button>
      <output>${key === 'slope' ? fmtSlope(v) : `${v} m`}</output>
      <button type="button" class="step" data-step="1" aria-label="${t('sl.more', { i: i + 1, what: label })}" ${v >= lim.max || tooLong ? 'disabled' : ''}>+</button>
    </div>`;
  };

  function rowHTML(i) {
    const s = design.sections[i];
    const d = difficulty(s.slope);
    return `<span class="sl-num" style="--d:${DIFF_COLORS[d]}" title="${t(`diff.${d}`)}">${i + 1}</span>
      ${stepper(i, 'slope', s.slope)}
      ${stepper(i, 'length', s.length)}
      <button type="button" class="sl-del" data-act="del" aria-label="${t('sl.remove', { i: i + 1 })}" title="${t('sl.removeTitle')}" ${design.sections.length <= 1 ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>`;
  }

  function renderList() {
    list.innerHTML = design.sections.map((_, i) => `<li class="sl-row${i === sel ? ' on' : ''}" data-i="${i}">${rowHTML(i)}</li>`).join('');
  }

  // one section changed: update its row in place (keeps a held button alive)
  function changed(i) {
    const li = list.querySelector(`[data-i="${i}"]`);
    if (li) li.innerHTML = rowHTML(i);
    refresh();
  }

  function refresh() {
    const st = designStats(design);
    read.len.textContent = fmtLen(st.length);
    read.drop.textContent = `${Math.round(st.drop)} m`;
    read.avg.textContent = `${Math.round(st.avgDeg)}°`;
    read.max.innerHTML = `<i class="diff" data-d="${difficulty(st.maxDeg)}"></i>${Math.round(st.maxDeg)}°`;
    goBtn.disabled = !st.ok;
    msg.textContent = st.ok ? t('sl.count', { n: design.sections.length }) : t(st.why[0], st.why[1]);
    msg.dataset.bad = st.ok ? '' : '1';
    addBtn.disabled = design.sections.length >= MAX_SECTIONS || designLength(design) + LIMITS.length.min > MAX_LENGTH;
    // the other rows' + length buttons depend on the total
    list.querySelectorAll('[data-key="length"] [data-step="1"]').forEach((b) => {
      const i = +b.closest('[data-i]').dataset.i;
      b.disabled = design.sections[i].length >= LIMITS.length.max || designLength(design) + LIMITS.length.step > MAX_LENGTH;
    });
    list.querySelectorAll('.sl-row').forEach((li) => li.classList.toggle('on', +li.dataset.i === sel));
    renderTemplates();
    draw();
  }

  // ---------- editing ----------

  function stepValue(i, key, dir) {
    const s = design.sections[i];
    const lim = LIMITS[key];
    if (key === 'length' && dir > 0 && designLength(design) + lim.step > MAX_LENGTH) return false;
    const v = Math.max(lim.min, Math.min(lim.max, s[key] + dir * lim.step));
    if (v === s[key]) return false;
    s[key] = v;
    sel = i;
    changed(i);
    return true;
  }

  // press and hold: one step now, then repeating faster and faster
  function startHold(i, key, dir) {
    stopHold();
    let n = 0;
    const tick = () => {
      if (!stepValue(i, key, dir)) return stopHold();
      n++;
      hold.timer = setTimeout(tick, n < 2 ? 380 : n < 8 ? 110 : 55);
    };
    hold = { timer: 0 };
    tick();
  }
  function stopHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold = null;
  }

  list.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b || b.disabled) return;
    e.preventDefault();
    const i = +b.closest('[data-i]').dataset.i;
    startHold(i, b.closest('[data-key]').dataset.key, +b.dataset.step);
  });
  // keyboard (Enter / Space on a focused button) steps once
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (b && e.detail === 0 && !b.disabled) {
      const i = +b.closest('[data-i]').dataset.i;
      stepValue(i, b.closest('[data-key]').dataset.key, +b.dataset.step);
      return;
    }
    const li = e.target.closest('[data-i]');
    if (!li) return;
    const i = +li.dataset.i;
    if (e.target.closest('[data-act="del"]')) {
      if (design.sections.length <= 1) return;
      design.sections.splice(i, 1);
      sel = Math.min(i, design.sections.length - 1);
      renderList();
      refresh();
      return;
    }
    if (sel !== i) {
      sel = i;
      refresh();
    }
  });
  const stop = () => stopHold();
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
  window.addEventListener('blur', stop);

  tpl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]');
    if (!b) return;
    design = templateDesign(b.dataset.tpl, design.width);
    sel = 0;
    renderList();
    refresh();
  });
  widthSeg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-width]');
    if (!b || b.dataset.width === design.width) return;
    design.width = b.dataset.width;
    renderWidth();
    refresh();
  });
  addBtn.addEventListener('click', () => {
    if (addBtn.disabled) return;
    const last = design.sections[design.sections.length - 1];
    const room = MAX_LENGTH - designLength(design);
    design.sections.push({ slope: last ? last.slope : 18, length: Math.max(LIMITS.length.min, Math.min(100, room - (room % LIMITS.length.step))) });
    sel = design.sections.length - 1;
    renderList();
    refresh();
    list.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  // tap the side view: pick the section there
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const u = (e.clientX - r.left - layout.ox) / layout.k;
    const starts = sectionStarts(design);
    let i = 0;
    while (i < starts.length - 1 && u >= starts[i + 1]) i++;
    sel = i;
    refresh();
    list.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  function build() {
    if (goBtn.disabled) return;
    const keep = !keepRow.hidden && keepBox.checked;
    close();
    onBuild(cloneDesign(design), { keep, changed: !original || !sameDesign(original, design) });
  }
  goBtn.addEventListener('click', build);
  cancelBtn.addEventListener('click', () => canCancel && close());
  root.addEventListener('click', (e) => {
    if (e.target === root && canCancel) close();
  });
  window.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape' && canCancel) {
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      build();
    }
  });
  window.addEventListener('resize', () => !root.hidden && draw());

  function close() {
    stopHold();
    root.hidden = true;
  }

  return {
    // current: the slope you have (null for a first one); tiles: how many you've built on it
    open(current, { cancel = true, tiles = 0 } = {}) {
      original = current ? cloneDesign(current) : null;
      design = current ? normalizeDesign(cloneDesign(current)) : templateDesign();
      sel = 0;
      canCancel = cancel;
      cancelBtn.hidden = !cancel;
      keepRow.hidden = !(current && tiles > 0);
      keepBox.checked = true;
      keepTiles = tiles;
      isNew = !current;
      labels();
      renderWidth();
      renderList();
      root.hidden = false;
      refresh();
      requestAnimationFrame(draw);
      goBtn.focus({ preventScroll: true });
    },
    get isOpen() {
      return !root.hidden;
    },
  };
}
