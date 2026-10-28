// The build bar. Three tools on the left: Look (move the camera only), Select (tap or drag
// on the snow to pick hexagon tiles, with a brush of 1, 7 or 19 tiles) and Start (put the
// start gate anywhere). Then the actions for the selected tiles, in four tabs: Shape,
// Features, Nature, Tools. Each shows what the selection holds (how high, how steep, how
// many trees...), and they wait greyed out until something is selected.

import { ACTIONS, TABS } from './core/tiles.js';
import { BRUSH_TILES } from './core/terrain.js';
import { ACTION_ICONS, BAR_ICONS, CATEGORY_COLORS } from './pieceIcons.js';
import { t, num, onLang } from './i18n.js';

const svg = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

// a small readout on a button for what the selection holds
const BADGES = {
  raise: (d) => (d.lift > 0 ? `+${num(d.lift)}` : ''),
  lower: (d) => (d.lift < 0 ? `${num(d.lift)}` : ''),
  smooth: (d) => (d.smooth ? `${d.smooth}/3` : ''),
  steepen: (d) => (d.pitch > 0 ? `${d.pitch}/3` : ''),
  ease: (d) => (d.pitch < 0 ? `${-d.pitch}/3` : ''),
  trees: (d) => (d.trees ? `${d.trees}/3` : ''),
};
// keys besides 1-9 (the actions of the tab on show, in order)
const KEYS = { raise: '+', lower: '−', flatten: 'F', rotate: 'Q', erase: 'X', copy: 'Ctrl+C', paste: 'Ctrl+V' };
// actions that are on or off for the whole selection
const TOGGLES = ['flatten', 'jump', 'drop', 'rocks', 'gate', 'clear', 'powder', 'ice'];
const flagOf = { flatten: 'flat' };

const actionsOf = (tab) =>
  Object.entries(ACTIONS)
    .filter(([, a]) => a.tab === tab)
    .map(([id]) => id);

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
  let hintAction = null; // the tutorial's: this button pulses

  const render = () => {
    tabs.innerHTML = TABS.map(
      (x) => `<button type="button" role="tab" data-tab="${x.id}" aria-selected="${x.id === tab}" style="--c:${CATEGORY_COLORS[x.id]}">${t(`tab.${x.id}`)}</button>`
    ).join('');
    const c = CATEGORY_COLORS[tab];
    list.innerHTML = actionsOf(tab)
      .map((id, k) => {
        const keys = [String(k + 1), KEYS[id]].filter(Boolean).join(' · ');
        return `<button type="button" class="bb-piece" data-action="${id}" style="--c:${c}" title="${t('bar.actTitle', { a: t(`act.${id}`), h: t(`act.${id}.hint`) })} (${keys})">${svg(ACTION_ICONS[id])}<span>${t(`act.${id}`)}</span><kbd class="bb-key">${k + 1}</kbd><em class="bb-badge" hidden></em></button>`;
      })
      .join('');
    list.scrollLeft = 0;
    sync();
  };

  const sync = () => {
    root.querySelectorAll('[data-tool]').forEach((b) => {
      b.setAttribute('aria-pressed', String(tool === b.dataset.tool));
      b.classList.toggle('bb-pulse', hintAction === b.dataset.tool);
    });
    sizes.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.size === size)));
    sizes.classList.toggle('bb-pulse', hintAction === 'size');
    chip.classList.toggle('bb-pulse', hintAction === 'chip');
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
      b.classList.toggle('bb-pulse', id === hintAction);
      const badge = b.querySelector('.bb-badge');
      const text = !none && BADGES[id] ? BADGES[id](info) : '';
      badge.textContent = text;
      badge.hidden = !text;
    });
    chip.hidden = none;
    chip.innerHTML = `${t('bar.chip', { n: info.n || 0 })}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
    chip.title = t('bar.deselect');
  };

  const renderFixed = () => {
    root.querySelector('.bb-fixed-look').innerHTML = `${svg(BAR_ICONS.look)}<span>${t('tool.view')}</span>`;
    root.querySelector('.bb-fixed-select').innerHTML = `${svg(BAR_ICONS.select)}<span>${t('tool.select')}</span>`;
    root.querySelector('.bb-fixed-start').innerHTML = `${svg(BAR_ICONS.start)}<span>${t('tool.start')}</span>`;
    sizes.innerHTML = [1, 2, 3].map((n) => `<button type="button" data-size="${n}" title="${t('bar.sizeTitle', { n: BRUSH_TILES[n - 1] })}">${['S', 'M', 'L'][n - 1]}</button>`).join('');
  };
  renderFixed();
  onLang(() => {
    renderFixed();
    render();
  });

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
    // the actions of the tab on show, in order (keys 1-9)
    get actions() {
      return actionsOf(tab);
    },
    // show a tab (the tutorial points at an action), and mark what to press: an action, a
    // tool ('select', 'start'), the brush sizes ('size') or the selection chip ('chip')
    showTab(id) {
      if (id === tab) return;
      tab = id;
      render();
    },
    setHint(action) {
      hintAction = action;
      sync();
      // bring it into view if the strip is scrolled (a phone shows a few actions at a time)
      const b = action && list.querySelector(`[data-action="${action}"]`);
      if (b) {
        const l = b.offsetLeft - list.offsetLeft;
        if (l < list.scrollLeft) list.scrollLeft = l - 8;
        else if (l + b.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = l + b.offsetWidth - list.clientWidth + 8;
      }
    },
  };
}
