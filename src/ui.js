// DOM overlay: tools, brush settings, run HUD, toasts.
import { makeSlider } from './slider.js';
import { drawTemplateThumb } from './thumbs.js';

const ICONS = {
  raise: '<path d="M3 19h18M5 19c2-6 4-9 7-9s5 3 7 9"/><path d="M12 3v5M9.5 5.5 12 3l2.5 2.5"/>',
  lower: '<path d="M3 9h18M5 9c2 6 4 9 7 9s5-3 7-9"/><path d="M12 2v5M9.5 4.5 12 7l2.5-2.5"/>',
  smooth: '<path d="M3 9c3-3 5 3 9 0s6 3 9 0"/><path d="M3 15c3-1.5 5 1.5 9 0s6 1.5 9 0"/>',
  flatten: '<path d="M3 15h18"/><path d="M6 11h12"/><path d="M8 7l4-3 4 3"/>',
  start: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 3.5L17 11H6"/>',
  view: '<circle cx="12" cy="12" r="3"/><path d="M21 12c0 2.2-4 4-9 4s-9-1.8-9-4 4-4 9-4"/><path d="m18.5 6.5 2.5 1.5-1.5 2.5"/>',
};

const STATUS_LABEL = {
  idle: 'Ready',
  running: 'On the slope',
  finished: 'Finished',
  crashed: 'Crashed',
  stuck: 'Stopped',
  out: 'Off the edge',
  timeout: 'Too slow',
};

export function createUI(opts) {
  const $ = (s) => document.querySelector(s);
  const toolList = [
    ...Object.entries(opts.tools).map(([id, t]) => ({ id, label: t.label, key: t.key })),
    { id: 'start', label: 'Start', key: '5' },
    { id: 'view', label: 'Orbit', key: 'V' },
  ];

  const nav = $('#tools');
  nav.innerHTML = toolList
    .map(
      (t) => `
      <button class="tool" type="button" data-tool="${t.id}" aria-pressed="false" title="${t.label} (${t.key})">
        <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[t.id]}</svg>
        <span class="tool-label">${t.label}</span>
        <kbd>${t.key}</kbd>
      </button>`
    )
    .join('');
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (b) opts.onTool(b.dataset.tool);
  });

  const radius = makeSlider($('#radius'));
  const strength = makeSlider($('#strength'));
  const radiusOut = $('#radius-out');
  const strengthOut = $('#strength-out');
  radius.value = opts.initial.radius;
  strength.value = Math.round(opts.initial.strength * 100);
  const showRadius = () => (radiusOut.textContent = `${radius.value} m`);
  const showStrength = () => (strengthOut.textContent = `${strength.value}%`);
  showRadius();
  showStrength();
  radius.addEventListener('input', () => {
    showRadius();
    opts.onRadius(+radius.value);
  });
  strength.addEventListener('input', () => {
    showStrength();
    opts.onStrength(+strength.value / 100);
  });

  $('#send').addEventListener('click', opts.onSend);
  $('#undo').addEventListener('click', opts.onUndo);
  $('#redo').addEventListener('click', opts.onRedo);
  $('#reset-view').addEventListener('click', () => opts.onResetView());

  // mountain picker: blank slope or a ready-made template, each with a relief preview
  const picker = $('#picker');
  const pickerList = $('#picker-list');
  pickerList.innerHTML = opts.templates
    .map(
      (t) => `
      <button class="tpl" type="button" data-id="${t.id}">
        <canvas class="tpl-thumb" width="480" height="84" aria-hidden="true"></canvas>
        <span class="tpl-meta"><b>${t.name}</b><span class="tpl-level" data-level="${t.id}">${t.level}</span></span>
        <span class="tpl-blurb">${t.blurb}</span>
      </button>`
    )
    .join('');
  let thumbsDrawn = false;
  const openPicker = () => {
    setMenu(false);
    picker.hidden = false;
    if (!thumbsDrawn) {
      thumbsDrawn = true;
      // draw one preview per frame so the dialog appears immediately
      const items = [...pickerList.querySelectorAll('.tpl')];
      const next = () => {
        const b = items.shift();
        if (!b) return;
        drawTemplateThumb(b.querySelector('canvas'), b.dataset.id);
        requestAnimationFrame(next);
      };
      requestAnimationFrame(next);
    }
  };
  const closePicker = () => (picker.hidden = true);
  pickerList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    closePicker();
    opts.onPickTemplate(b.dataset.id);
  });
  $('#picker-close').addEventListener('click', closePicker);
  picker.addEventListener('click', (e) => {
    if (e.target === picker) closePicker();
  });
  $('#reset').addEventListener('click', openPicker);

  const reliefBtn = $('#relief');
  reliefBtn.setAttribute('aria-pressed', String(!!opts.initial.relief));
  reliefBtn.addEventListener('click', () => {
    const on = reliefBtn.getAttribute('aria-pressed') !== 'true';
    reliefBtn.setAttribute('aria-pressed', String(on));
    opts.onRelief(on);
  });

  // compact screens: secondary options open from the "more" button
  const moreBtn = $('#more');
  const setMenu = (open) => {
    document.body.classList.toggle('menu-open', open);
    moreBtn.setAttribute('aria-expanded', String(open));
  };
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMenu(!document.body.classList.contains('menu-open'));
  });
  document.addEventListener('pointerdown', (e) => {
    if (!document.body.classList.contains('menu-open')) return;
    if (e.target.closest('#extras') || e.target.closest('#more')) return;
    setMenu(false);
  });
  $('#reset-view').addEventListener('click', () => setMenu(false));

  // how-to-play card
  const intro = $('#intro');
  const openIntro = () => {
    setMenu(false);
    intro.hidden = false;
    $('#intro-go').focus();
  };
  const closeIntro = () => {
    intro.hidden = true;
    opts.onIntroClosed?.();
  };
  $('#help').addEventListener('click', openIntro);
  $('#intro-go').addEventListener('click', closeIntro);
  intro.addEventListener('click', (e) => {
    if (e.target === intro) closeIntro();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!intro.hidden) closeIntro();
      else if (!picker.hidden) closePicker();
      setMenu(false);
    }
  });

  const contours = $('#contours');
  contours.checked = opts.initial.contours;
  // ride controls: hold-to-act pads, several at once (steer + tuck)
  const ride = $('#ride');
  ride.querySelectorAll('[data-ctl]').forEach((pad) => {
    const name = pad.dataset.ctl;
    const press = (on) => {
      pad.classList.toggle('held', on);
      opts.onControl(name, on);
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      press(true);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      pad.addEventListener(ev, () => pad.classList.contains('held') && press(false));
    }
    pad.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  $('#ride-exit').addEventListener('click', () => opts.onRideExit());
  $('#ride-cam').addEventListener('click', () => opts.onRideCam());
  contours.addEventListener('change', () => opts.onContours(contours.checked));

  const statusEl = $('#status');
  const stat = {
    time: $('#s-time'),
    speed: $('#s-speed'),
    top: $('#s-top'),
    air: $('#s-air'),
    jumps: $('#s-jumps'),
  };
  const bestEl = $('#s-best');
  const rush = $('#rush');
  let lastRush = -1;
  const progressFill = $('#progress-fill');
  const toastEl = $('#toast');
  let toastTimer = 0;

  return {
    openIntro,
    openPicker,
    get blocking() {
      return !intro.hidden || !picker.hidden;
    },
    setTool(id) {
      nav.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === id)));
      document.body.dataset.tool = id;
    },
    setHistory(canUndo, canRedo) {
      $('#undo').disabled = !canUndo;
      $('#redo').disabled = !canRedo;
    },
    setStatus(s) {
      statusEl.textContent = STATUS_LABEL[s] || s;
      statusEl.dataset.status = s;
    },
    setStats(sk, progress = 0) {
      progressFill.style.transform = `scaleX(${Math.min(1, Math.max(0, progress)).toFixed(3)})`;
      stat.time.textContent = sk.time.toFixed(2);
      stat.speed.textContent = Math.round(sk.speed * 3.6);
      stat.top.textContent = Math.round(sk.maxSpeed * 3.6);
      stat.air.textContent = (sk.airTime + (sk.grounded ? 0 : sk.curAir)).toFixed(1);
      stat.jumps.textContent = sk.jumps;
    },
    setBest(best) {
      bestEl.textContent = best ? `${best.time.toFixed(2)} s` : '—';
    },
    toast(msg, kind = '') {
      toastEl.textContent = msg;
      toastEl.dataset.kind = kind;
      toastEl.hidden = false;
      toastEl.classList.remove('show');
      void toastEl.offsetWidth;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3600);
    },
    nudgeRadius(d) {
      // [ and ] scale the brush by ~15 % per press (at least 1 m)
      const cur = +radius.value;
      let next = Math.round(cur * (d > 0 ? 1.15 : 1 / 1.15));
      if (next === cur) next = cur + Math.sign(d);
      radius.value = Math.max(+radius.min, Math.min(+radius.max, next));
      radius.dispatchEvent(new Event('input'));
    },
    // speed vignette: 0 = none, 1 = full rush
    setRush(k) {
      const v = Math.min(1, Math.max(0, k));
      if (Math.abs(v - lastRush) < 0.01) return;
      lastRush = v;
      rush.style.opacity = v.toFixed(2);
    },
    setRiding(on) {
      ride.hidden = !on;
      document.body.classList.toggle('riding', on);
      if (on) setMenu(false);
      if (!on) ride.querySelectorAll('.held').forEach((p) => p.classList.remove('held'));
    },
    setRideCam(mode) {
      $('#ride-cam-label').textContent = mode === 'helmet' ? 'Helmet cam' : 'Chase cam';
    },
    showControl(name, on) {
      const pad = ride.querySelector(`[data-ctl="${name}"]`);
      if (pad) pad.classList.toggle('held', on);
    },
    toggleRelief() {
      reliefBtn.click();
    },
    toggleContours() {
      contours.checked = !contours.checked;
      contours.dispatchEvent(new Event('change'));
    },
  };
}
