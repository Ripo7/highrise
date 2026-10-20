// Touch-friendly slider. Native <input type="range"> on phones only moves when you grab
// the exact thumb; anywhere else the browser treats the drag as a page scroll. This one
// jumps to wherever you touch and follows the finger, and never lets the page move.
//
// It mimics the bits of the input API the UI uses: .value, .min, .max and 'input' events.
// data-scale="log" spreads the range logarithmically (fine control at small values).

export function makeSlider(el) {
  const min = +el.dataset.min;
  const max = +el.dataset.max;
  const step = +el.dataset.step || 1;
  const log = el.dataset.scale === 'log';
  let value = min;
  // position along the track (0..1) <-> value
  const toT = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromT = (t) => (log ? min * Math.pow(max / min, t) : min + t * (max - min));
  // log sliders snap to a step that grows with the value
  const stepFor = (v) => (log ? (v < 20 ? 1 : v < 60 ? 2 : 5) : step);

  el.innerHTML = '<span class="range-track"><span class="range-fill"></span><span class="range-thumb"></span></span>';
  const track = el.querySelector('.range-track');
  el.setAttribute('role', 'slider');
  el.tabIndex = 0;
  el.setAttribute('aria-valuemin', min);
  el.setAttribute('aria-valuemax', max);

  const render = () => {
    const t = toT(value);
    el.style.setProperty('--t', t.toFixed(4));
    el.setAttribute('aria-valuenow', value);
  };

  const set = (v, emit) => {
    const st = stepFor(v);
    const snapped = Math.round(v / st) * st;
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
    set(fromT(Math.min(1, Math.max(0, t))), true);
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
    const moves = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 };
    if (e.key in moves) {
      e.preventDefault();
      e.stopPropagation();
      // move along the track so log sliders step evenly
      const t = Math.min(1, Math.max(0, toT(value) + moves[e.key] * 0.02));
      const next = fromT(t);
      set(Math.abs(next - value) < stepFor(value) ? value + Math.sign(moves[e.key]) * stepFor(value) : next, true);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      set(e.key === 'Home' ? min : max, true);
    }
  });

  render();
  return el;
}
