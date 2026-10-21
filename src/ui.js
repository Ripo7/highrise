// DOM overlay: tools, brush settings, run HUD, trick pop-ups, results, dialogs, toasts.
import { makeSlider } from './slider.js';

const ICONS = {
  raise: '<path d="M3 19h18M5 19c2-6 4-9 7-9s5 3 7 9"/><path d="M12 3v5M9.5 5.5 12 3l2.5 2.5"/>',
  lower: '<path d="M3 9h18M5 9c2 6 4 9 7 9s5-3 7-9"/><path d="M12 2v5M9.5 4.5 12 7l2.5-2.5"/>',
  smooth: '<path d="M3 9c3-3 5 3 9 0s6 3 9 0"/><path d="M3 15c3-1.5 5 1.5 9 0s6 1.5 9 0"/>',
  flatten: '<path d="M3 15h18"/><path d="M6 11h12"/><path d="M8 7l4-3 4 3"/>',
  build: '<path d="M2 19h20"/><path d="M4 19c6 0 10-3 13-9l1 9"/><path d="M17 10h3"/>',
  start: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 3.5L17 11H6"/>',
  view: '<circle cx="12" cy="12" r="3"/><path d="M21 12c0 2.2-4 4-9 4s-9-1.8-9-4 4-4 9-4"/><path d="m18.5 6.5 2.5 1.5-1.5 2.5"/>',
};

const KIND_ICONS = {
  kicker: '<path d="M2 18h20"/><path d="M4 18c7 0 11-2 14-8v8"/>',
  table: '<path d="M2 18h20"/><path d="M3 18 8 11h7l6 7"/>',
  berm: '<path d="M2 18h20"/><path d="M5 18c2-9 12-9 14 0"/>',
  rollers: '<path d="M2 18h20"/><path d="M2 18c2-5 4-5 6 0s4-5 6 0 4-5 6 0"/>',
};

const STATUS_LABEL = {
  idle: 'Ready',
  running: 'On the slope',
  finished: 'Finished',
  stuck: 'Stopped',
  timeout: 'Too slow',
  aborted: 'Ready',
};

const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function createUI(opts) {
  const $ = (s) => document.querySelector(s);
  const toolList = [
    ...Object.entries(opts.tools).map(([id, t]) => ({ id, label: t.label, key: t.key })),
    { id: 'build', label: 'Build', key: 'B' },
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

  // Build tool: what to build
  const kinds = $('#build-kinds');
  kinds.innerHTML = Object.entries(opts.stamps)
    .map(
      ([id, k]) => `
      <button class="kind" type="button" role="radio" data-kind="${id}" aria-checked="false" title="${k.hint}">
        <svg viewBox="0 0 24 24" aria-hidden="true">${KIND_ICONS[id]}</svg><span>${k.label}</span>
      </button>`
    )
    .join('');
  kinds.addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (b) opts.onKind(b.dataset.kind);
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

  // run designer
  $('#reset').addEventListener('click', () => {
    setMenu(false);
    opts.onNewRun();
  });
  $('#edit-run').addEventListener('click', () => opts.onEditRun());

  const toggle = (sel, initial, cb) => {
    const btn = $(sel);
    btn.setAttribute('aria-pressed', String(!!initial));
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      cb(on);
    });
    return btn;
  };
  const reliefBtn = toggle('#relief', opts.initial.relief, opts.onRelief);
  const muteBtn = $('#mute');
  const showMute = (m) => {
    muteBtn.textContent = m ? 'Sound off' : 'Sound on';
    muteBtn.setAttribute('aria-pressed', String(m));
  };
  showMute(opts.initial.muted);
  muteBtn.addEventListener('click', () => {
    const m = muteBtn.getAttribute('aria-pressed') !== 'true';
    showMute(m);
    opts.onMute(m);
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

  const contours = $('#contours');
  contours.checked = opts.initial.contours;
  contours.addEventListener('change', () => opts.onContours(contours.checked));

  $('#ride-exit').addEventListener('click', () => opts.onRideExit());
  $('#ride-cam').addEventListener('click', () => opts.onRideCam());
  $('#ride-retry').addEventListener('click', () => opts.onSend());

  // results card
  const results = $('#results');
  $('#res-retry').addEventListener('click', () => opts.onSend());
  $('#res-sculpt').addEventListener('click', () => opts.onRideExit());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!intro.hidden) closeIntro();
      setMenu(false);
    }
  });

  const statusEl = $('#status');
  const stat = {
    score: $('#s-score'),
    time: $('#s-time'),
    speed: $('#s-speed'),
    air: $('#s-air'),
  };
  const comboEl = $('#combo');
  const comboPts = $('#combo-pts');
  const comboMult = $('#combo-mult');
  const comboTimer = $('#combo-timer');
  const streakEl = $('#streak');
  const streakPts = $('#streak-pts');
  const streakRate = $('#streak-rate');
  const bestEl = $('#s-best');
  const rush = $('#rush');
  let lastRush = -1;
  const progressFill = $('#progress-fill');
  const tricksEl = $('#tricks');
  const toastEl = $('#toast');
  let toastTimer = 0;
  let lastScoreText = '';

  return {
    openIntro,
    get blocking() {
      return !intro.hidden;
    },
    get resultsOpen() {
      return !results.hidden;
    },
    setTool(id) {
      nav.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === id)));
      document.body.dataset.tool = id;
      kinds.hidden = id !== 'build';
      // in Build mode the sliders size the feature
      $('#radius-name').textContent = id === 'build' ? 'Width' : 'Size';
      $('#strength-name').textContent = id === 'build' ? 'Height' : 'Strength';
    },
    setKind(kind) {
      kinds.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === kind)));
    },
    setHistory(canUndo, canRedo) {
      $('#undo').disabled = !canUndo;
      $('#redo').disabled = !canRedo;
    },
    setStatus(s) {
      statusEl.textContent = STATUS_LABEL[s] || s;
      statusEl.dataset.status = s;
    },
    setStats(sk, progress, score) {
      progressFill.style.transform = `scaleX(${Math.min(1, Math.max(0, progress)).toFixed(3)})`;
      stat.time.textContent = sk.time.toFixed(1);
      stat.speed.textContent = Math.round(sk.speed * 3.6);
      stat.air.textContent = (sk.airTime + (sk.grounded ? 0 : sk.curAir)).toFixed(1);
      const txt = fmt(score.total);
      if (txt !== lastScoreText) {
        lastScoreText = txt;
        stat.score.textContent = txt;
        stat.score.classList.remove('bump');
        void stat.score.offsetWidth;
        stat.score.classList.add('bump');
      }
      if (score.combo) {
        comboEl.hidden = false;
        comboPts.textContent = fmt(score.combo.points);
        comboMult.textContent = `×${score.multiplier}`;
        comboTimer.style.transform = `scaleX(${Math.max(0, score.combo.timer / score.window).toFixed(3)})`;
      } else comboEl.hidden = true;
      const kmh = sk.speed * 3.6;
      stat.speed.classList.toggle('fast', kmh >= opts.speedBonusKmh);
      if (score.streak) {
        streakEl.hidden = false;
        streakPts.textContent = fmt(score.streak.points);
        streakRate.textContent = `+${Math.round(opts.speedRate(kmh))}/s`;
        streakEl.classList.toggle('fading', score.streak.below > 0);
      } else streakEl.hidden = true;
    },
    clearStats() {
      lastScoreText = '';
      stat.score.textContent = '0';
      stat.time.textContent = '0.0';
      stat.speed.textContent = '0';
      stat.air.textContent = '0.0';
      comboEl.hidden = true;
      streakEl.hidden = true;
      stat.speed.classList.remove('fast');
      progressFill.style.transform = 'scaleX(0)';
    },
    setBest(best) {
      bestEl.textContent = best ? fmt(best.score) : '—';
    },
    // big trick call-outs in the middle of the screen
    trick(item) {
      const el = document.createElement('div');
      el.className = `trick trick-${item.kind}`;
      el.innerHTML = `<b>${item.text}</b>${item.points ? `<em>+${fmt(item.points)}</em>` : ''}${
        item.sub ? `<small>${item.sub}</small>` : ''
      }`;
      tricksEl.prepend(el);
      while (tricksEl.children.length > 3) tricksEl.lastChild.remove();
      setTimeout(() => el.classList.add('out'), 1500);
      setTimeout(() => el.remove(), 1900);
    },
    clearTricks() {
      tricksEl.innerHTML = '';
    },
    showResults(r) {
      $('#res-eyebrow').textContent = r.eyebrow;
      $('#res-score').textContent = fmt(r.score);
      $('#res-best').hidden = !r.isBest;
      $('#res-time').textContent = `${r.time.toFixed(1)} s`;
      $('#res-top').textContent = `${Math.round(r.top)} km/h`;
      $('#res-tricks').textContent = r.tricks;
      $('#res-wipeouts').textContent = r.wipeouts;
      $('#res-trick').textContent = r.bestTrick ? `${r.bestTrick.name} · ${fmt(r.bestTrick.points)}` : '—';
      $('#res-combo').textContent = r.bestCombo ? fmt(r.bestCombo) : '—';
      $('#res-speed').textContent = r.speedPoints ? fmt(r.speedPoints) : '—';
      results.hidden = false;
      $('#res-retry').focus({ preventScroll: true });
    },
    hideResults() {
      results.hidden = true;
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
      $('#ride').hidden = !on;
      document.body.classList.toggle('riding', on);
      if (on) setMenu(false);
      if (!on) results.hidden = true;
    },
    setRideCam(mode) {
      $('#ride-cam-label').textContent = mode === 'helmet' ? 'Helmet cam' : 'Chase cam';
    },
    toggleRelief() {
      reliefBtn.click();
    },
    toggleMute() {
      muteBtn.click();
    },
    toggleContours() {
      contours.checked = !contours.checked;
      contours.dispatchEvent(new Event('change'));
    },
  };
}
