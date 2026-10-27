// DOM overlay: run HUD, trick pop-ups, results, dialogs, toasts, menu, mountain chooser.
import { SIZES, STEEPNESS, newWild } from './core/wild.js';
import { drawPreview } from './mountainPreview.js';
import { THEME } from './render/theme.js';

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

  $('#send').addEventListener('click', opts.onSend);
  $('#undo').addEventListener('click', opts.onUndo);
  $('#redo').addEventListener('click', opts.onRedo);
  $('#reset-view').addEventListener('click', () => opts.onResetView());

  // menu
  $('#reset').addEventListener('click', () => {
    setMenu(false);
    opts.onNewMountain();
  });
  $('#fresh-snow').addEventListener('click', () => {
    setMenu(false);
    opts.onFreshSnow();
  });
  $('#suggest').addEventListener('click', () => {
    setMenu(false);
    opts.onSuggest();
  });

  // the new-mountain card: how steep, how big, and which one (a preview from above)
  const mt = $('#mountain');
  let mtPick = newWild('medium', 'medium');
  const profileSvg = (deg) => {
    const t = Math.tan((deg * Math.PI) / 180);
    const y = Math.min(36, 6 + 38 * t);
    const path = `M4 6 C 20 ${(6 + (y - 6) * 0.3).toFixed(1)}, 36 ${(6 + (y - 6) * 0.8).toFixed(1)}, 56 ${y.toFixed(1)}`;
    return `<svg viewBox="0 0 60 40" aria-hidden="true"><path class="fill" d="${path} L56 40 L4 40 Z"/><path d="${path}"/></svg>`;
  };
  const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.0', '')} km` : `${m} m`);
  let previewTimer = 0;
  const renderMt = () => {
    $('#mt-slopes').innerHTML = STEEPNESS.map(
      (sl) => `<button type="button" role="radio" class="mt-slope" data-slope="${sl.id}" aria-checked="${sl.id === mtPick.steep}" data-d="${sl.deg < 18 ? 'blue' : sl.deg < 25 ? 'red' : 'black'}">
        ${profileSvg(sl.deg)}<b>${sl.label}</b><small>about ${sl.deg}°</small><em>${sl.blurb}</em></button>`
    ).join('');
    $('#mt-length').innerHTML = SIZES.map(
      (l) => `<button type="button" data-len="${l.id}" aria-pressed="${l.id === mtPick.size}">${l.label}<small>${km(l.L)}</small></button>`
    ).join('');
    // draw the preview just after the card shows, so opening it stays instant
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => drawPreview($('#mt-canvas'), mtPick, THEME), 0);
  };
  const closeMt = () => {
    mt.hidden = true;
  };
  mt.addEventListener('click', (e) => {
    const sl = e.target.closest('[data-slope]');
    const ln = e.target.closest('[data-len]');
    if (sl) mtPick = { ...mtPick, steep: sl.dataset.slope };
    if (ln) mtPick = { ...mtPick, size: ln.dataset.len };
    if (sl || ln) renderMt();
    if (e.target === mt && !$('#mt-cancel').hidden) closeMt();
  });
  $('#mt-another').addEventListener('click', () => {
    mtPick = newWild(mtPick.size, mtPick.steep);
    renderMt();
  });
  $('#mt-cancel').addEventListener('click', closeMt);
  $('#mt-go').addEventListener('click', () => {
    closeMt();
    opts.onMountain({ ...mtPick }, $('#mt-starter').checked);
  });

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
      else if (!mt.hidden && !$('#mt-cancel').hidden) closeMt();
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
      return !intro.hidden || !mt.hidden;
    },
    openMountain(current, canCancel = true) {
      setMenu(false);
      // the same settings as now, a different mountain
      if (current && current.size) mtPick = newWild(current.size, current.steep);
      $('#mt-cancel').hidden = !canCancel;
      renderMt();
      mt.hidden = false;
      $('#mt-go').focus({ preventScroll: true });
    },
    get resultsOpen() {
      return !results.hidden;
    },
    setTool(id) {
      document.body.dataset.tool = id;
    },
    // the line under the title (desktop)
    setHint(text) {
      $('#hint-text').textContent = text;
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
