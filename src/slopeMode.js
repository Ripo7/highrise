// The slope editor, in the 3D view. The mountain is rebuilt as you change it; on the snow
// each section is tinted its piste colour with its label, and the dot at the bottom of each
// section drags (main.js: along the slope its length, up or down its pitch; the side view
// shows it best: the Side button over the view). This is the bar at the bottom: templates and saved projects to start
// from, the width, the section picked (− / + for its pitch and length, press and hold to run
// through them), add and remove, and Build it / Cancel.
//
// Keys: ← → pick a section, ↑ ↓ its pitch (Shift: its length), Ctrl+Z / Ctrl+Shift+Z,
// Enter builds it, Esc cancels.

import { LIMITS, MAX_SECTIONS, MAX_LENGTH, WIDTHS, TEMPLATES, templateDesign, cloneDesign, sameDesign, normalizeDesign, designLength, designStats, difficulty } from './core/slopes.js';
import { DIFF_COLORS } from './pieceIcons.js';
import { t, num, onLang } from './i18n.js';

export const fmtLen = (m) => (m >= 1000 ? `${num(Math.round(m / 10) / 100)} km` : `${Math.round(m)} m`);
const fmtSlope = (v) => (v < 0 ? `↑ ${-v}°` : `${v}°`);
const icon = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

/**
 * on: { change(design) the design changed (rebuild the snow), pick(i), done(design, keep),
 * cancel(), projects() open the projects }
 */
export function createSlopeMode(on) {
  const $ = (id) => document.getElementById(id);
  const root = $('slopebar');
  const tpl = $('sb-templates');
  const widthSeg = $('sb-width');
  const sec = $('sb-section');
  const msg = $('sb-msg');
  const goBtn = $('sb-go');
  const cancelBtn = $('sb-cancel');
  const keepRow = $('sb-keep-row');
  const keepBox = $('sb-keep');
  const read = { len: $('sb-len'), drop: $('sb-drop'), avg: $('sb-avg'), max: $('sb-max') };

  let design = templateDesign();
  let original = null;
  let picked = 0;
  let canCancel = false;
  let keepTiles = 0;
  let hold = null;
  let past = [];
  let future = [];
  let open = false;

  const labels = () => {
    $('sb-keep-text').textContent = t('sl.keep', { n: keepTiles });
    $('sb-eyebrow').textContent = original ? t('sl.yours') : t('sl.new');
  };

  // ---------- rendering ----------

  function renderTemplates() {
    tpl.innerHTML =
      TEMPLATES.map((x) => {
        const isOn = sameDesign(templateDesign(x.id, design.width), design);
        return `<button type="button" class="sb-chip" data-tpl="${x.id}" aria-pressed="${isOn}" title="${t(`tpl.${x.id}.blurb`)}">${t(`tpl.${x.id}`)}</button>`;
      }).join('') + `<button type="button" class="sb-chip sb-proj" data-act="projects" title="${t('pj.openTitle')}">${icon('<path d="M3 7h6l2 2h10v10H3z"/>')}<span>${t('pj.mine')}</span></button>`;
  }

  function renderWidth() {
    widthSeg.innerHTML = WIDTHS.map((w) => `<button type="button" data-width="${w.id}" aria-pressed="${w.id === design.width}">${t(`width.${w.id}`)}<small>${w.W} m</small></button>`).join('');
  }

  const stepper = (key, v) => {
    const lim = LIMITS[key];
    const tooLong = key === 'length' && designLength(design) + lim.step > MAX_LENGTH;
    const what = (key === 'slope' ? t('sl.slope') : t('sl.length')).toLowerCase();
    return `<div class="sb-ctl" data-key="${key}"><span class="ctl-l">${key === 'slope' ? t('sl.slope') : t('sl.length')}</span>
      <button type="button" class="step" data-step="-1" aria-label="${t('sl.less', { i: picked + 1, what })}" ${v <= lim.min ? 'disabled' : ''}>−</button>
      <output>${key === 'slope' ? fmtSlope(v) : `${v} m`}</output>
      <button type="button" class="step" data-step="1" aria-label="${t('sl.more', { i: picked + 1, what })}" ${v >= lim.max || tooLong ? 'disabled' : ''}>+</button>
    </div>`;
  };

  function renderSection() {
    const s = design.sections[picked];
    const d = difficulty(s.slope);
    const n = design.sections.length;
    const full = n >= MAX_SECTIONS || designLength(design) + LIMITS.length.min > MAX_LENGTH;
    sec.innerHTML = `<div class="sb-pick">
        <button type="button" class="sb-arrow" data-act="prev" aria-label="${t('sb.prev')}" ${picked <= 0 ? 'disabled' : ''}>${icon('<path d="m15 6-6 6 6 6"/>')}</button>
        <span class="sb-num" style="--d:${DIFF_COLORS[d]}" title="${t(`diff.${d}`)}">${t('sb.section', { i: picked + 1, n })}</span>
        <button type="button" class="sb-arrow" data-act="next" aria-label="${t('sb.next')}" ${picked >= n - 1 ? 'disabled' : ''}>${icon('<path d="m9 6 6 6-6 6"/>')}</button>
      </div>
      ${stepper('slope', s.slope)}
      ${stepper('length', s.length)}
      <div class="sb-edit">
        <button type="button" class="btn sb-add" data-act="add" title="${t('sb.addTitle')}" ${full ? 'disabled' : ''}>${icon('<path d="M12 5v14M5 12h14"/>')}<span>${t('sb.add')}</span></button>
        <button type="button" class="btn sb-del" data-act="del" aria-label="${t('sl.remove', { i: picked + 1 })}" title="${t('sl.removeTitle')}" ${n <= 1 ? 'disabled' : ''}>${icon('<path d="M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3"/>')}</button>
      </div>`;
  }

  function refresh() {
    const st = designStats(design);
    read.len.textContent = fmtLen(st.length);
    read.drop.textContent = `${Math.round(st.drop)} m`;
    read.avg.textContent = `${Math.round(st.avgDeg)}°`;
    read.max.innerHTML = `<i class="diff" data-d="${difficulty(st.maxDeg)}"></i>${Math.round(st.maxDeg)}°`;
    goBtn.disabled = !st.ok;
    msg.textContent = st.ok ? t('sb.hint') : t(st.why[0], st.why[1]);
    msg.dataset.bad = st.ok ? '' : '1';
    renderTemplates();
    renderSection();
  }

  function render() {
    labels();
    renderWidth();
    refresh();
  }
  onLang(() => open && render());

  // ---------- editing ----------

  // remember the design before a change, for undo
  const remember = () => {
    past.push(cloneDesign(design));
    if (past.length > 60) past.shift();
    future = [];
  };
  const changed = () => {
    refresh();
    on.change(cloneDesign(design), picked);
  };

  function stepValue(key, dir) {
    const s = design.sections[picked];
    const lim = LIMITS[key];
    if (key === 'length' && dir > 0 && designLength(design) + lim.step > MAX_LENGTH) return false;
    const v = Math.max(lim.min, Math.min(lim.max, s[key] + dir * lim.step));
    if (v === s[key]) return false;
    s[key] = v;
    changed();
    return true;
  }

  // press and hold: one step now, then faster and faster
  function startHold(key, dir) {
    stopHold();
    remember();
    let n = 0;
    const tick = () => {
      if (!stepValue(key, dir)) return stopHold();
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

  const pickSection = (i) => {
    const k = Math.max(0, Math.min(design.sections.length - 1, i));
    if (k === picked) return;
    picked = k;
    refresh();
    on.pick(picked);
  };

  sec.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b || b.disabled) return;
    e.preventDefault();
    startHold(b.closest('[data-key]').dataset.key, +b.dataset.step);
  });
  sec.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    // keyboard (Enter / Space on a focused − / +) steps once
    if (b.dataset.step && e.detail === 0) {
      remember();
      stepValue(b.closest('[data-key]').dataset.key, +b.dataset.step);
      return;
    }
    const act = b.dataset.act;
    if (act === 'prev') pickSection(picked - 1);
    else if (act === 'next') pickSection(picked + 1);
    else if (act === 'add') {
      remember();
      const cur = design.sections[picked];
      const room = MAX_LENGTH - designLength(design);
      design.sections.splice(picked + 1, 0, { slope: cur.slope, length: Math.max(LIMITS.length.min, Math.min(100, room - (room % LIMITS.length.step))) });
      picked++;
      changed();
    } else if (act === 'del') {
      if (design.sections.length <= 1) return;
      remember();
      design.sections.splice(picked, 1);
      picked = Math.min(picked, design.sections.length - 1);
      changed();
    }
  });
  const stop = () => stopHold();
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
  window.addEventListener('blur', stop);

  tpl.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="projects"]')) return on.projects();
    const b = e.target.closest('[data-tpl]');
    if (!b) return;
    remember();
    design = templateDesign(b.dataset.tpl, design.width);
    picked = 0;
    changed();
  });
  widthSeg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-width]');
    if (!b || b.dataset.width === design.width) return;
    remember();
    design.width = b.dataset.width;
    renderWidth();
    changed();
  });

  function done() {
    if (goBtn.disabled) return;
    const keep = !keepRow.hidden && keepBox.checked;
    close();
    on.done(cloneDesign(design), { keep, changed: !original || !sameDesign(original, design) });
  }
  goBtn.addEventListener('click', done);
  cancelBtn.addEventListener('click', () => {
    if (!canCancel) return;
    close();
    on.cancel();
  });

  function close() {
    stopHold();
    open = false;
    root.hidden = true;
  }

  const api = {
    get open() {
      return open;
    },
    get design() {
      return design;
    },
    get picked() {
      return picked;
    },
    // current: the slope you have (null: a first one); tiles: how many you built on it
    open(current, { cancel = true, tiles = 0 } = {}) {
      original = current ? cloneDesign(current) : null;
      design = normalizeDesign(cloneDesign(current || templateDesign()));
      picked = 0;
      past = [];
      future = [];
      canCancel = cancel;
      cancelBtn.hidden = !cancel;
      keepRow.hidden = !(current && tiles > 0);
      keepBox.checked = true;
      keepTiles = tiles;
      open = true;
      root.hidden = false;
      render();
      goBtn.focus({ preventScroll: true });
    },
    close,
    // Build it (the Slope button over the view does it too)
    build: () => done(),
    pick: pickSection,
    // a joint dragged in the 3D view: begin (for undo), then the design as it goes
    beginDrag() {
      remember();
    },
    drag(next, i) {
      design = normalizeDesign(next);
      picked = i;
      changed();
    },
    undo() {
      if (!past.length) return false;
      future.push(cloneDesign(design));
      design = past.pop();
      picked = Math.min(picked, design.sections.length - 1);
      renderWidth();
      changed();
      return true;
    },
    redo() {
      if (!future.length) return false;
      past.push(cloneDesign(design));
      design = future.pop();
      picked = Math.min(picked, design.sections.length - 1);
      renderWidth();
      changed();
      return true;
    },
    // keys while it's open; true when used
    key(e) {
      if (!open) return false;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') return e.shiftKey ? api.redo() || true : api.undo() || true;
      if (mod && e.key.toLowerCase() === 'y') return api.redo() || true;
      if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') return false;
      if (e.key === 'Escape') {
        if (canCancel) {
          close();
          on.cancel();
        }
        return true;
      }
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        done();
        return true;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        pickSection(picked + (e.key === 'ArrowRight' ? 1 : -1));
        return true;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!e.repeat) remember();
        stepValue(e.shiftKey ? 'length' : 'slope', e.key === 'ArrowUp' ? 1 : -1);
        return true;
      }
      return false;
    },
  };
  return api;
}
