// The build bar. Three tools on the left: Look (move the camera only), Select (tap or drag
// on the snow to pick hexagon tiles, with a brush of 1, 7 or 19 tiles) and Start (put the
// start gate anywhere). Then the actions for the selected tiles, in four tabs: Shape,
// Features, Nature, Tools. Each shows what the selection holds (how high, how steep, how
// many trees...), and they wait greyed out until something is selected.

import { ACTIONS, TABS } from './core/tiles.js';
import { BRUSH_TILES } from './core/terrain.js';
import { ACTION_ICONS, BAR_ICONS, CATEGORY_COLORS } from './pieceIcons.js';

const svg = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

// a small readout on a button for what the selection holds
const BADGES = {
  raise: (d) => (d.lift > 0 ? `+${d.lift}` : ''),
  lower: (d) => (d.lift < 0 ? `${d.lift}` : ''),
  smooth: (d) => (d.smooth ? `${d.smooth}/3` : ''),
  steepen: (d) => (d.pitch > 0 ? `${d.pitch}/3` : ''),
  ease: (d) => (d.pitch < 0 ? `${-d.pitch}/3` : ''),
  trees: (d) => (d.trees ? `${d.trees}/3` : ''),
};
// actions that are on or off for the whole selection
const TOGGLES = ['flatten', 'jump', 'drop', 'rocks', 'clear', 'powder', 'ice'];
const flagOf = { flatten: 'flat' };

export function createBuildBar({ onTool, onAction, onDeselect, onSize }) {
  const root = document.getElementById('buildbar');
  const tabs = root.querySelector('.bb-tabs');
  const list = root.querySelector('.bb-pieces');
  const sizes = root.querySelector('.bb-size');
  const chip = root.querySelector('.bb-chip');
  let tab = 'shape';
  let tool = 'select';
  let size = 2;
  let info = { n: 0 };
  let hasClip = false;

  const render = () => {
    tabs.innerHTML = TABS.map(
      (t) => `<button type="button" role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}" style="--c:${CATEGORY_COLORS[t.id]}">${t.label}</button>`
    ).join('');
    const c = CATEGORY_COLORS[tab];
    list.innerHTML = Object.entries(ACTIONS)
      .filter(([, a]) => a.tab === tab)
      .map(
        ([id, a]) =>
          `<button type="button" class="bb-piece" data-action="${id}" style="--c:${c}" title="${a.label}: ${a.hint}">${svg(ACTION_ICONS[id])}<span>${a.label}</span><em class="bb-badge" hidden></em></button>`
      )
      .join('');
    list.scrollLeft = 0;
    sync();
  };

  const sync = () => {
    root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(tool === b.dataset.tool)));
    sizes.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.size === size)));
    sizes.hidden = tool !== 'select';
    const none = !info.n;
    list.querySelectorAll('[data-action]').forEach((b) => {
      const id = b.dataset.action;
      // with nothing selected only Paste (once something is copied) can do anything
      const off = id === 'paste' ? !hasClip : id === 'rotate' ? none && tool !== 'paste' : none;
      b.classList.toggle('is-off', off);
      b.setAttribute('aria-disabled', String(off));
      const pressed = id === 'paste' ? tool === 'paste' : TOGGLES.includes(id) && !none && !!info[flagOf[id] || id];
      b.setAttribute('aria-pressed', String(pressed));
      const badge = b.querySelector('.bb-badge');
      const text = !none && BADGES[id] ? BADGES[id](info) : '';
      badge.textContent = text;
      badge.hidden = !text;
    });
    chip.hidden = none;
    chip.innerHTML = `${info.n} tile${info.n === 1 ? '' : 's'}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
    chip.title = 'Deselect (Esc)';
  };

  root.querySelector('.bb-fixed-look').innerHTML = `${svg(BAR_ICONS.look)}<span>Look</span>`;
  root.querySelector('.bb-fixed-select').innerHTML = `${svg(BAR_ICONS.select)}<span>Select</span>`;
  root.querySelector('.bb-fixed-start').innerHTML = `${svg(BAR_ICONS.start)}<span>Start</span>`;
  sizes.innerHTML = [1, 2, 3]
    .map((n) => `<button type="button" data-size="${n}" title="Select ${BRUSH_TILES[n - 1]} tile${n > 1 ? 's' : ''} at a time">${['S', 'M', 'L'][n - 1]}</button>`)
    .join('');

  root.addEventListener('click', (e) => {
    // only this bar's own buttons (the page body carries a data-tool too)
    const hit = (sel) => {
      const el = e.target.closest(sel);
      return el && root.contains(el) ? el : null;
    };
    if (hit('.bb-chip')) return onDeselect();
    const t = hit('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      return render();
    }
    const a = hit('[data-action]');
    if (a) return onAction(a.dataset.action);
    const tl = hit('[data-tool]');
    if (tl) return onTool(tl.dataset.tool);
    const s = hit('[data-size]');
    if (s) {
      size = +s.dataset.size;
      sync();
      onSize(size);
    }
  });

  render();

  return {
    // tool: 'view' | 'select' | 'start' | 'paste'
    set(t) {
      tool = t;
      sync();
    },
    setSize(n) {
      size = n;
      sync();
    },
    // what the selection holds (tiles.js describe), and whether there's a copy to paste
    setSelection(d, clip) {
      info = d;
      hasClip = clip;
      sync();
    },
    get tab() {
      return tab;
    },
  };
}
