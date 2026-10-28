// The view buttons, floating over the mountain: Rotate and Move the view, Top and Side.
// Rotate and Move work two ways: drag the button itself to turn or slide the view, or tap
// it and then drag the snow (tap it again, or Esc, to go back to selecting tiles). Top looks
// straight down, Side from the side of the slope. Touch gestures (pinch, two fingers) and
// the mouse (right drag, middle drag, wheel) still work as ever.
//
//   on: { mode(m) 'rotate' | 'pan' | null, drag(kind, dx, dy) pixels, top(), side() }

import { t, onLang } from './i18n.js';

const ICONS = {
  rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  pan: '<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  top: '<path d="M12 3v7"/><path d="m9 7 3 3 3-3"/><path d="M4 15l8-3 8 3-8 3z"/>',
  side: '<path d="M3 7l6 4 4-2 8 7"/><path d="M3 20h18"/><path d="M3 7v13"/>',
};
const ORDER = ['rotate', 'pan', 'top', 'side'];

export function createViewButtons(on) {
  const root = document.createElement('div');
  root.id = 'viewbtns';
  root.className = 'viewbtns';
  root.innerHTML = ORDER.map(
    (id) => `<button type="button" class="vb" data-view="${id}"${id === 'rotate' || id === 'pan' ? ' aria-pressed="false"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg><span></span></button>`
  ).join('');
  document.body.appendChild(root);
  let mode = null;
  let shown = null; // the mode a button shows (the slope editor turns by default)
  let drag = null;

  const label = () => {
    for (const id of ORDER) {
      const b = root.querySelector(`[data-view="${id}"]`);
      b.querySelector('span').textContent = t(`vb.${id}`);
      b.title = t(`vb.${id}.title`);
      b.setAttribute('aria-label', t(`vb.${id}.title`));
    }
  };
  label();
  onLang(label);

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
    if (d.moved || e.type !== 'pointerup') return;
    // a tap: a view, or a mode on or off
    if (d.id === 'top') on.top();
    else if (d.id === 'side') on.side();
    else on.mode(mode === d.id ? null : d.id);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  // keyboard: Enter / Space on a focused button
  root.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const b = e.target.closest('[data-view]');
    if (!b) return;
    const id = b.dataset.view;
    if (id === 'top') on.top();
    else if (id === 'side') on.side();
    else on.mode(mode === id ? null : id);
  });

  return {
    // the mode on (null: selecting), and the one to show pressed (it can differ: the slope
    // editor turns the view by default)
    set(m, show = m) {
      mode = m;
      shown = show;
      for (const id of ['rotate', 'pan']) root.querySelector(`[data-view="${id}"]`).setAttribute('aria-pressed', String(shown === id));
    },
    el: root,
  };
}
