// The build bar: three tabs. Piste: trace it point by point (tap the snow from the top down,
// drag a point to move it), start a new piste or a branch, make the selected stretch
// narrower or wider, delete a point. Terrain and Nature: pick a piece and paint it on the
// snow, with a brush one, two or three tiles across. Look (move the camera only) is always
// at hand.

import { KINDS } from './core/terrain.js';
import { PIECE_ICONS, BAR_ICONS, CATEGORY_COLORS } from './pieceIcons.js';

const TABS = [
  { id: 'piste', label: 'Piste' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'nature', label: 'Nature' },
];

const PISTE_ITEMS = [
  { tool: 'trace', label: 'Trace', icon: 'trace', title: 'Tap the snow to add points down the mountain, drag a point to move it' },
  { action: 'newPiste', label: 'New piste', icon: 'newPiste', title: 'Start another piste: tap on a piste to branch from it, or anywhere else' },
  { action: 'narrower', label: 'Narrower', icon: 'narrower', title: 'Make the selected stretch narrower', needsSel: true },
  { action: 'wider', label: 'Wider', icon: 'wider', title: 'Make the selected stretch wider', needsSel: true },
  { action: 'delete', label: 'Delete', icon: 'delete', title: 'Delete the selected point (Delete)', needsSel: true },
];

const svg = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

export function createBuildBar({ onTool, onPiece, onAction, onSize }) {
  const root = document.getElementById('buildbar');
  const tabs = root.querySelector('.bb-tabs');
  const list = root.querySelector('.bb-pieces');
  const sizes = root.querySelector('.bb-size');
  let tab = 'piste';
  let current = { tool: 'trace', piece: 'bump' };
  let hasSel = false;
  let size = 2;

  const btn = (attrs, icon, label, title, c) =>
    `<button type="button" class="bb-piece" ${attrs} style="--c:${c}" title="${title}">${svg(icon)}<span>${label}</span></button>`;

  const render = () => {
    tabs.innerHTML = TABS.map(
      (t) => `<button type="button" role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}" style="--c:${CATEGORY_COLORS[t.id]}">${t.label}</button>`
    ).join('');
    const c = CATEGORY_COLORS[tab];
    let html = '';
    if (tab === 'piste') {
      html = PISTE_ITEMS.map((it) =>
        btn(
          it.tool ? `data-tool="${it.tool}"` : `data-action="${it.action}"${it.needsSel ? ' data-sel' : ''}`,
          BAR_ICONS[it.icon],
          it.label,
          it.title,
          c
        )
      ).join('');
    } else {
      html = btn('data-tool="erase" data-erase', BAR_ICONS.erase, 'Erase', 'Erase pieces (X)', 'var(--bad)');
      html += Object.entries(KINDS)
        .filter(([, k]) => k.cat === tab)
        .map(([id, k]) => btn(`data-piece="${id}"`, PIECE_ICONS[id], k.label, k.hint, c))
        .join('');
    }
    list.innerHTML = html;
    list.scrollLeft = 0;
    sizes.hidden = tab === 'piste';
    sync();
  };

  const sync = () => {
    root.querySelectorAll('[data-piece]').forEach((b) => b.setAttribute('aria-pressed', String(current.tool === 'paint' && current.piece === b.dataset.piece)));
    root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(current.tool === b.dataset.tool)));
    root.querySelectorAll('[data-sel]').forEach((b) => (b.disabled = !hasSel));
    sizes.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.size === size)));
  };

  root.querySelector('.bb-fixed-look').innerHTML = `${svg(BAR_ICONS.look)}<span>Look</span>`;
  sizes.innerHTML = [1, 2, 3].map((n) => `<button type="button" data-size="${n}" title="Brush: ${n * 10} m">${['S', 'M', 'L'][n - 1]}</button>`).join('');

  root.addEventListener('click', (e) => {
    // only this bar's own buttons (the page body carries a data-tool too)
    const hit = (sel) => {
      const el = e.target.closest(sel);
      return el && root.contains(el) ? el : null;
    };
    const t = hit('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      render();
      // a tab opens on its main tool: tracing, or the first piece
      if (tab === 'piste') onTool('trace');
      else {
        const first = Object.entries(KINDS).find(([, k]) => k.cat === tab)[0];
        onPiece(KINDS[current.piece]?.cat === tab ? current.piece : first);
      }
      return;
    }
    const p = hit('[data-piece]');
    if (p) return onPiece(p.dataset.piece);
    const tl = hit('[data-tool]');
    if (tl) return onTool(tl.dataset.tool);
    const a = hit('[data-action]');
    if (a && !a.disabled) return onAction(a.dataset.action);
    const s = hit('[data-size]');
    if (s) {
      size = +s.dataset.size;
      sync();
      onSize(size);
    }
  });

  render();

  return {
    // tool: 'view' | 'trace' | 'paint' | 'erase'
    set(tool, piece) {
      current = { tool, piece };
      const want = tool === 'trace' ? 'piste' : tool === 'paint' ? KINDS[piece]?.cat : null;
      if (want && want !== tab) {
        tab = want;
        render();
      } else sync();
    },
    setSelection(on) {
      hasSel = on;
      sync();
    },
    setSize(n) {
      size = n;
      sync();
    },
    get tab() {
      return tab;
    },
  };
}
