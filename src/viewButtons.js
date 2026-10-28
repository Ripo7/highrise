// The buttons floating over the mountain:
//   Select · Rotate · Move   what a drag on the snow does: select tiles (the default), turn
//                            the view or slide it. Rotate and Move also work by dragging the
//                            button itself. Esc goes back to Select.
//   Top · Side               look straight down, or from the side of the slope
//   Slope                    the slope editor (and, open, Build it)
// Touch gestures (pinch, two fingers) and the mouse (right drag, middle drag, wheel) still
// move the view whatever is on.
//
//   on: { mode(m) 'rotate' | 'pan' | null (select), drag(kind, dx, dy) pixels, top(), side(),
//         slope() }

import { t, onLang } from './i18n.js';

const ICONS = {
  select: '<path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z" stroke-dasharray="3.2 2.2"/><path d="m11 9 6.5 3.5-3 1 2 3.2-1.6 1-2-3.2-2 2z" fill="currentColor" stroke-width="1.2"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  pan: '<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  top: '<path d="M12 3v7"/><path d="m9 7 3 3 3-3"/><path d="M4 15l8-3 8 3-8 3z"/>',
  side: '<path d="M2 12h6"/><path d="m5.5 9 3 3-3 3"/><path d="M11 19 21 7v12z"/>',
  slope: '<path d="M3 5l6 6 5-2 7 9"/><path d="M3 21h18"/><circle cx="9" cy="11" r="1.9" fill="currentColor"/><circle cx="14" cy="9" r="1.9" fill="currentColor"/>',
};
const MODES = ['select', 'rotate', 'pan'];
const ORDER = [...MODES, 'top', 'side', 'slope'];

export function createViewButtons(on) {
  const root = document.createElement('div');
  root.id = 'viewbtns';
  root.className = 'viewbtns';
  root.innerHTML = ORDER.map(
    (id) => `<button type="button" class="vb" data-view="${id}"${MODES.includes(id) || id === 'slope' ? ' aria-pressed="false"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg><span></span></button>`
  ).join('');
  document.body.appendChild(root);
  let mode = null;
  let slopeOn = false;
  let drag = null;

  const label = () => {
    for (const id of ORDER) {
      const b = root.querySelector(`[data-view="${id}"]`);
      const key = id === 'slope' && slopeOn ? 'vb.slope.done' : `vb.${id}`;
      b.querySelector('span').textContent = t(id === 'slope' ? 'vb.slope' : `vb.${id}`);
      b.title = t(`${key}.title`);
      b.setAttribute('aria-label', t(`${key}.title`));
    }
  };
  label();
  onLang(label);

  const tap = (id) => {
    if (id === 'top') on.top();
    else if (id === 'side') on.side();
    else if (id === 'slope') on.slope();
    else if (id === 'select') on.mode(null);
    else on.mode(mode === id ? null : id);
  };

  root.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { id: b.dataset.view, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId };
    try {
      b.setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer */
    }
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId || (drag.id !== 'rotate' && drag.id !== 'pan')) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    root.classList.add('is-dragging');
    on.drag(drag.id, dx, dy);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    root.classList.remove('is-dragging');
    if (!d.moved && e.type === 'pointerup') tap(d.id);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  // keyboard: Enter / Space on a focused button
  root.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const b = e.target.closest('[data-view]');
    if (b) tap(b.dataset.view);
  });

  return {
    // the mode on (null: Select), and the one to show pressed (it can differ: the slope
    // editor turns the view by default)
    set(m, show = m) {
      mode = m;
      for (const id of MODES) root.querySelector(`[data-view="${id}"]`).setAttribute('aria-pressed', String((show || 'select') === id));
    },
    // the slope editor open (the Slope button then builds it)
    setSlope(isOn) {
      slopeOn = isOn;
      root.querySelector('[data-view="slope"]').setAttribute('aria-pressed', String(isOn));
      label();
    },
    el: root,
  };
}
