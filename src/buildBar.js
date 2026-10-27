// The build bar: two tabs, Terrain and Nature. Pick a piece and paint it on the snow's
// hexagon tiles with a brush of 1, 7 or 19 tiles; Erase clears tiles. Look (move the camera only) and
// Start (put the start gate anywhere: tap or drag on the snow) are always at hand.

import { KINDS, BRUSH_TILES } from './core/terrain.js';
import { PIECE_ICONS, BAR_ICONS, CATEGORY_COLORS } from './pieceIcons.js';

const TABS = [
  { id: 'terrain', label: 'Terrain' },
  { id: 'nature', label: 'Nature' },
];

const svg = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

export function createBuildBar({ onTool, onPiece, onSize }) {
  const root = document.getElementById('buildbar');
  const tabs = root.querySelector('.bb-tabs');
  const list = root.querySelector('.bb-pieces');
  const sizes = root.querySelector('.bb-size');
  let tab = 'terrain';
  let current = { tool: 'view', piece: 'bump' };
  let size = 2;

  const btn = (attrs, icon, label, title, c) =>
    `<button type="button" class="bb-piece" ${attrs} style="--c:${c}" title="${title}">${svg(icon)}<span>${label}</span></button>`;

  const render = () => {
    tabs.innerHTML = TABS.map(
      (t) => `<button type="button" role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}" style="--c:${CATEGORY_COLORS[t.id]}">${t.label}</button>`
    ).join('');
    const c = CATEGORY_COLORS[tab];
    let html = btn('data-tool="erase"', BAR_ICONS.erase, 'Erase', 'Erase pieces (X)', 'var(--bad)');
    html += Object.entries(KINDS)
      .filter(([, k]) => k.cat === tab)
      .map(([id, k]) => btn(`data-piece="${id}"`, PIECE_ICONS[id], k.label, k.hint, c))
      .join('');
    list.innerHTML = html;
    list.scrollLeft = 0;
    sync();
  };

  const sync = () => {
    root.querySelectorAll('[data-piece]').forEach((b) => b.setAttribute('aria-pressed', String(current.tool === 'paint' && current.piece === b.dataset.piece)));
    root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(current.tool === b.dataset.tool)));
    sizes.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.size === size)));
    sizes.hidden = !(current.tool === 'paint' || current.tool === 'erase');
  };

  root.querySelector('.bb-fixed-look').innerHTML = `${svg(BAR_ICONS.look)}<span>Look</span>`;
  root.querySelector('.bb-fixed-start').innerHTML = `${svg(BAR_ICONS.start)}<span>Start</span>`;
  sizes.innerHTML = [1, 2, 3].map((n) => `<button type="button" data-size="${n}" title="Brush: ${BRUSH_TILES[n - 1]} tile${n > 1 ? 's' : ''}">${['S', 'M', 'L'][n - 1]}</button>`).join('');

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
      // a tab opens on its first piece (or the one picked before)
      const first = Object.entries(KINDS).find(([, k]) => k.cat === tab)[0];
      onPiece(KINDS[current.piece]?.cat === tab ? current.piece : first);
      return;
    }
    const p = hit('[data-piece]');
    if (p) return onPiece(p.dataset.piece);
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
    // tool: 'view' | 'paint' | 'erase' | 'start'
    set(tool, piece) {
      current = { tool, piece };
      const want = tool === 'paint' ? KINDS[piece]?.cat : null;
      if (want && want !== tab) {
        tab = want;
        render();
      } else sync();
    },
    setSize(n) {
      size = n;
      sync();
    },
  };
}
