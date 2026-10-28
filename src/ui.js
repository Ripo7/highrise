// DOM overlay: run HUD, trick pop-ups, results, dialogs, toasts, menu. (The slope editor
// is its own module: slopeEditor.js.)

const STATUS_LABEL = {
  idle: 'Ready',
  running: 'On the slope',
  finished: 'Finished',
  stuck: 'Stopped',
  timeout: 'Too slow',
  aborted: 'Ready',
  paused: 'Paused',
};

const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function createUI(opts) {
  const $ = (s) => document.querySelector(s);

  $('#send').addEventListener('click', opts.onSend);
  $('#restart').addEventListener('click', opts.onRestart);
  $('#undo').addEventListener('click', opts.onUndo);
  $('#redo').addEventListener('click', opts.onRedo);
  $('#reset-view').addEventListener('click', () => opts.onResetView());

  // menu
  $('#reset').addEventListener('click', () => {
    setMenu(false);
    opts.onEditSlope();
  });
  $('#fresh-snow').addEventListener('click', () => {
    setMenu(false);
    opts.onFreshSnow();
  });

  // the slope editor (slopeEditor.js) is a dialog too
  const slopeDlg = $('#slope');

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
  $('#ride-retry').addEventListener('click', () => opts.onRestart());

  // results card
  const results = $('#results');
  $('#res-retry').addEventListener('click', () => opts.onRestart());
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
      return !intro.hidden || !slopeDlg.hidden;
    },
    closeMenu: () => setMenu(false),
    get resultsOpen() {
      return !results.hidden;
    },
    setTool(id) {
      document.body.dataset.tool = id;
    },
    // a run is waiting while you build: Ride picks it up, From the start goes back to the gate
    setPaused(on) {
      $('#send-label').textContent = on ? 'Ride on' : 'Ride';
      $('#send').title = on ? 'Ride on from where you stopped (Space)' : 'Ride from the start gate (Space)';
      $('#restart').hidden = !on;
      document.body.classList.toggle('paused', on);
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
