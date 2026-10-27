// The build bar: like a building game's hotbar. Category tabs on top, the pieces of the
// open category below, with Look (move the camera, build nothing) and Erase always at
// hand. Pick a piece, then drag on the snow: it snaps to the grid and joins its neighbours.

import { PIECES, CATEGORIES } from './core/pieces.js';
import { PIECE_ICONS, BAR_ICONS, CATEGORY_COLORS } from './pieceIcons.js';

const SCULPT = [
  { id: 'raise', label: 'Raise' },
  { id: 'lower', label: 'Lower' },
  { id: 'smooth', label: 'Smooth' },
  { id: 'flatten', label: 'Flatten' },
];

const svg = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

export function createBuildBar({ onPiece, onTool, onRotate }) {
  const root = document.getElementById('buildbar');
  const tabs = root.querySelector('.bb-tabs');
  const list = root.querySelector('.bb-pieces');
  const rot = root.querySelector('#bb-rotate');
  let cat = 'jumps';
  let advanced = false;
  let current = { tool: 'view', piece: null };

  const renderTabs = () => {
    const cats = advanced ? [...CATEGORIES, { id: 'sculpt', label: 'Sculpt' }] : CATEGORIES;
    tabs.innerHTML = cats
      .map((c) => `<button type="button" role="tab" data-cat="${c.id}" aria-selected="${c.id === cat}" style="--c:${CATEGORY_COLORS[c.id]}">${c.label}</button>`)
      .join('');
  };
  const renderPieces = () => {
    const items =
      cat === 'sculpt'
        ? SCULPT.map((t) => ({ id: t.id, label: t.label, icon: BAR_ICONS[t.id], tool: true }))
        : Object.entries(PIECES)
            .filter(([, p]) => p.cat === cat)
            .map(([id, p]) => ({ id, label: p.label, icon: PIECE_ICONS[id] }));
    list.innerHTML = items
      .map(
        (it) =>
          `<button type="button" class="bb-piece" ${it.tool ? `data-tool="${it.id}"` : `data-piece="${it.id}"`} style="--c:${CATEGORY_COLORS[cat]}" title="${
            it.tool ? it.label : PIECES[it.id].hint
          }">${svg(it.icon)}<span>${it.label}</span></button>`
      )
      .join('');
    list.scrollLeft = 0;
    sync();
  };
  const sync = () => {
    root.querySelectorAll('[data-piece]').forEach((b) => b.setAttribute('aria-pressed', String(current.tool === 'piece' && current.piece === b.dataset.piece)));
    root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(current.tool === b.dataset.tool)));
    rot.hidden = !(current.tool === 'piece' && PIECES[current.piece]?.rotates);
  };

  root.querySelector('.bb-fixed-look').innerHTML = `${svg(BAR_ICONS.look)}<span>Look</span>`;
  root.querySelector('.bb-fixed-erase').innerHTML = `${svg(BAR_ICONS.erase)}<span>Erase</span>`;
  rot.innerHTML = `${svg(BAR_ICONS.rotate)}<span>Rotate</span>`;

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-cat]');
    if (t) {
      cat = t.dataset.cat;
      renderTabs();
      renderPieces();
      return;
    }
    const p = e.target.closest('[data-piece]');
    if (p) return onPiece(p.dataset.piece);
    const tl = e.target.closest('[data-tool]');
    if (tl) return onTool(tl.dataset.tool);
    if (e.target.closest('#bb-rotate')) onRotate();
  });

  renderTabs();
  renderPieces();

  return {
    // tool: 'view' | 'piece' | 'erase' | 'start' | a sculpting brush
    set(tool, piece) {
      current = { tool, piece };
      if (tool === 'piece' && PIECES[piece] && PIECES[piece].cat !== cat) {
        cat = PIECES[piece].cat;
        renderTabs();
        renderPieces();
      }
      sync();
    },
    setAdvanced(on) {
      advanced = on;
      if (!on && cat === 'sculpt') cat = 'terrain';
      renderTabs();
      renderPieces();
    },
    setRotation(r) {
      rot.classList.toggle('turned', r === 1);
    },
  };
}
