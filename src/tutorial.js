// The tutorial: a card with the level's steps, the goal tiles marked on the snow, the button
// to press pulsing in the build bar. The levels and their checks are in core/tutorial.js;
// main.js hands over what the game holds (host) and puts your own slope back on the way out.
//
//   host: { hf, bar, game() => { tiles, sel, clip, start }, enter(), leave(), load(level),
//           frame(x, u) (look there now), focus(x, u) (glide there if it's out of view),
//           setGoal(tiles), setRidePulse(on), toast(msg), cheer(), ownSlope() => bool }

import { LEVELS, resolveGoal, checkContext, emptyRun, followRun } from './core/tutorial.js';
import { t, onLang } from './i18n.js';
import './tutorialText.js';

const PROGRESS_KEY = 'highrise.tutorial.v1';
const CHECK_EVERY = 0.1; // seconds between checks while building

function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
    return { done: new Set(Array.isArray(p.done) ? p.done : []), at: Number.isInteger(p.at) ? p.at : 0 };
  } catch {
    return { done: new Set(), at: 0 };
  }
}

// the middle of a goal (x, u)
const centreOf = (g) => (g.line ? { x: (g.line[0][0] + g.line[1][0]) / 2, u: (g.line[0][1] + g.line[1][1]) / 2 } : { x: g.x, u: g.u });

// where the camera looks when a level starts: its first goal
export function levelView(level) {
  const g = level.steps.find((s) => s.goal)?.goal;
  return g ? centreOf(g) : { x: 0, u: 80 };
}

export function createTutorial(host) {
  let on = false;
  let idx = 0;
  let step = 0;
  let goals = [];
  let run = emptyRun();
  let complete = false;
  let since = 0;
  const progress = loadProgress();

  const root = document.createElement('section');
  root.id = 'tut';
  root.className = 'tut panel';
  root.hidden = true;
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = `
    <div class="tut-head">
      <button type="button" class="tut-fold" aria-expanded="true">
        <span class="tut-eyebrow"></span>
        <b class="tut-title"></b>
        <svg class="tut-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <button type="button" class="tut-icon" data-tut="levels"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg></button>
      <button type="button" class="tut-icon" data-tut="exit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>
    <div class="tut-body">
      <p class="tut-lede"></p>
      <ol class="tut-steps"></ol>
      <p class="tut-done" hidden></p>
      <div class="tut-actions">
        <button type="button" class="btn tut-btn" data-tut="restart"></button>
        <button type="button" class="btn tut-btn" data-tut="skip"></button>
        <button type="button" class="send tut-next" data-tut="next" hidden></button>
      </div>
    </div>
    <div class="tut-list" hidden></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const fold = $('.tut-fold');
  const list = $('.tut-list');

  const save = () => {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify({ done: [...progress.done], at: idx }));
    } catch {
      /* no storage: progress lasts this visit */
    }
  };

  const level = () => LEVELS[idx];
  const last = () => idx === LEVELS.length - 1;

  function render() {
    root.hidden = !on;
    if (!on) return;
    const L = level();
    $('.tut-eyebrow').textContent = `${t('tut.title')} · ${t('tut.level', { n: idx + 1, total: LEVELS.length })}`;
    $('.tut-title').textContent = t(`tut.${L.id}`);
    $('.tut-lede').textContent = t(`tut.${L.id}.lede`);
    $('.tut-steps').innerHTML = L.steps
      .map((s, k) => {
        const done = complete || k < step;
        const cls = done ? 'is-done' : k === step ? 'is-now' : '';
        return `<li class="${cls}"><i aria-hidden="true">${done ? '✓' : k + 1}</i><span>${t(`tut.${L.id}.${s.id}`)}</span></li>`;
      })
      .join('');
    const doneEl = $('.tut-done');
    doneEl.hidden = !complete;
    doneEl.textContent = complete && last() ? t('tut.allDone') : t('tut.done');
    const next = $('[data-tut="next"]');
    next.hidden = !complete;
    next.textContent = last() ? t(host.ownSlope() ? 'tut.finish' : 'tut.designMine') : t('tut.next');
    const skip = $('[data-tut="skip"]');
    skip.hidden = complete || last();
    skip.textContent = t('tut.skip');
    skip.title = t('tut.skip.title');
    const restart = $('[data-tut="restart"]');
    restart.textContent = t('tut.restart');
    restart.title = t('tut.restart.title');
    $('[data-tut="levels"]').setAttribute('aria-label', t('tut.levels'));
    $('[data-tut="levels"]').title = t('tut.levels');
    $('[data-tut="exit"]').setAttribute('aria-label', t('tut.exit'));
    $('[data-tut="exit"]').title = t('tut.exit');
    fold.title = t('tut.fold');
    list.innerHTML = LEVELS.map(
      (x, k) =>
        `<button type="button" data-level="${k}" aria-current="${k === idx}" class="${progress.done.has(x.id) ? 'is-done' : ''}"><i aria-hidden="true">${progress.done.has(x.id) ? '✓' : k + 1}</i>${t(`tut.${x.id}`)}</button>`
    ).join('');
  }

  // the step's goal tiles on the snow, its tab and its button in the bar
  function enterStep() {
    const s = level().steps[step];
    goals = resolveGoal(host.hf, s.goal);
    if (s.goal && step > 0) {
      const c = centreOf(s.goal);
      host.focus(c.x, c.u);
    }
    host.setGoal(goals);
    if (s.tab) host.bar.showTab(s.tab);
    host.bar.setHint(s.hint || null);
    host.setRidePulse(!!s.ride);
  }

  function startLevel(k) {
    idx = Math.max(0, Math.min(LEVELS.length - 1, k));
    step = 0;
    complete = false;
    run = emptyRun();
    list.hidden = true;
    const L = level();
    host.load(L);
    const v = levelView(L);
    host.frame(v.x, v.u);
    enterStep();
    save();
    render();
  }

  function levelDone() {
    complete = true;
    progress.done.add(level().id);
    save();
    host.setGoal([]);
    host.bar.setHint(null);
    host.setRidePulse(false);
    host.cheer();
    host.toast(t('tut.levelDone', { what: t(`tut.${level().id}`) }));
    setFolded(false);
  }

  function check() {
    if (!on || complete) return;
    const L = level();
    let moved = false;
    for (;;) {
      const s = L.steps[step];
      if (!s.done(checkContext(host.hf, host.game(), goals, run))) break;
      moved = true;
      if (step + 1 < L.steps.length) {
        step++;
        enterStep();
      } else {
        levelDone();
        break;
      }
    }
    if (moved) render();
  }

  const setFolded = (f) => {
    root.classList.toggle('is-folded', f);
    fold.setAttribute('aria-expanded', String(!f));
  };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b === fold) return setFolded(!root.classList.contains('is-folded'));
    if (b.dataset.level) return startLevel(+b.dataset.level);
    switch (b.dataset.tut) {
      case 'levels':
        list.hidden = !list.hidden;
        break;
      case 'exit':
        api.stop();
        break;
      case 'restart':
        startLevel(idx);
        break;
      case 'skip':
        startLevel(idx + 1);
        break;
      case 'next':
        if (last()) api.stop();
        else startLevel(idx + 1);
        break;
    }
  });

  onLang(render);

  const api = {
    get active() {
      return on;
    },
    get level() {
      return on ? level().id : null;
    },
    get step() {
      return on ? level().steps[step]?.id : null;
    },
    get complete() {
      return complete;
    },
    // the step's goal tiles, [[i, j], ...]
    get goals() {
      return goals;
    },
    // from a level (the first one not done yet, by default)
    start(k = null) {
      if (!on) {
        host.enter();
        on = true;
        host.toast(t('tut.welcome'));
      }
      const first = LEVELS.findIndex((x) => !progress.done.has(x.id));
      startLevel(k ?? (first < 0 ? 0 : first));
      setFolded(false);
    },
    stop() {
      if (!on) return;
      on = false;
      host.setGoal([]);
      host.bar.setHint(null);
      host.setRidePulse(false);
      list.hidden = true;
      render();
      host.leave();
    },
    // every frame while building
    tick(dt) {
      if (!on || complete) return;
      since += dt;
      if (since < CHECK_EVERY) return;
      since = 0;
      check();
    },
    // a new run: the ride steps start counting again
    runStarted() {
      run = emptyRun();
    },
    // every frame of a run
    rideFrame(sk) {
      if (!on || complete) return;
      followRun(run, sk, host.hf.startZ);
      if (level().steps[step].ride) check();
    },
    check,
  };
  return api;
}
