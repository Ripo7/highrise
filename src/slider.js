// Touch-friendly slider. Native <input type="range"> on phones only moves when you grab
// the exact thumb; anywhere else the browser treats the drag as a page scroll. This one
// jumps to wherever you touch and follows the finger, and never lets the page move.
//
// It mimics the bits of the input API the UI uses: .value, .min, .max and 'input' events.

export function makeSlider(el) {
  const min = +el.dataset.min;
  const max = +el.dataset.max;
  const step = +el.dataset.step || 1;
  let value = min;

  el.innerHTML = '<span class="range-track"><span class="range-fill"></span><span class="range-thumb"></span></span>';
  const track = el.querySelector('.range-track');
  el.setAttribute('role', 'slider');
  el.tabIndex = 0;
  el.setAttribute('aria-valuemin', min);
  el.setAttribute('aria-valuemax', max);

  const render = () => {
    const t = (value - min) / (max - min);
    el.style.setProperty('--t', t.toFixed(4));
    el.setAttribute('aria-valuenow', value);
  };

  const set = (v, emit) => {
    const snapped = Math.round(v / step) * step;
    const next = Math.min(max, Math.max(min, +snapped.toFixed(4)));
    if (next === value) return;
    value = next;
    render();
    if (emit) el.dispatchEvent(new Event('input'));
  };

  Object.defineProperty(el, 'value', {
    get: () => value,
    set: (v) => set(+v, false),
  });
  Object.defineProperty(el, 'min', { get: () => min });
  Object.defineProperty(el, 'max', { get: () => max });

  const fromPointer = (e) => {
    const r = track.getBoundingClientRect();
    const t = (e.clientX - r.left) / r.width;
    set(min + Math.min(1, Math.max(0, t)) * (max - min), true);
  };

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    fromPointer(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (el.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  const end = (e) => {
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.classList.remove('dragging');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  el.addEventListener('keydown', (e) => {
    const big = (max - min) / 10;
    const moves = {
      ArrowLeft: -step,
      ArrowDown: -step,
      ArrowRight: step,
      ArrowUp: step,
      PageDown: -big,
      PageUp: big,
    };
    if (e.key in moves) {
      e.preventDefault();
      e.stopPropagation();
      set(value + moves[e.key], true);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      set(e.key === 'Home' ? min : max, true);
    }
  });

  render();
  return el;
}
