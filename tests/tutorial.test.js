// The French translation and the tutorial levels

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t, num, setLang } from '../src/i18n.js';
import { TUT_STRINGS } from '../src/tutorialText.js';
import { Heightfield } from '../src/core/heightfield.js';
import { SurfaceMap } from '../src/core/surface.js';
import { PropSet } from '../src/core/props.js';
import { Skier } from '../src/core/skier.js';
import { buildSlope } from '../src/core/slopes.js';
import { buildWorld, fallLine } from '../src/core/world.js';
import { tileCenter, gridCols, gridRows } from '../src/core/terrain.js';
import { ACTIONS, TABS, applyAction, copyTiles, pasteTiles, tileKey } from '../src/core/tiles.js';
import { LEVELS, resolveGoal, checkContext, emptyRun, followRun } from '../src/core/tutorial.js';
import { CourseRun } from '../src/core/course.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)(\|[^}]*)?\}/g)].map((m) => m[1]).sort().join(',');

test('every string is in English and in French, with the same placeholders', () => {
  const en = STRINGS.en;
  const fr = STRINGS.fr;
  for (const k of Object.keys(en)) {
    assert.ok(k in fr, `French for ${k}`);
    assert.ok(fr[k].trim(), `${k} is not empty in French`);
    assert.equal(placeholders(fr[k]), placeholders(en[k]), `${k}: same placeholders`);
  }
  for (const k of Object.keys(fr)) assert.ok(k in en, `English for ${k}`);
  // every action and tab has its name and its hint
  for (const id of Object.keys(ACTIONS)) for (const k of [`act.${id}`, `act.${id}.hint`]) assert.ok(k in en && k in fr, k);
  for (const { id } of TABS) assert.ok(`tab.${id}` in en, `tab.${id}`);
  // the tutorial's own strings were added to both
  for (const k of Object.keys(TUT_STRINGS.en)) assert.ok(k in en && k in fr, k);
});

test('plurals and numbers follow the language', () => {
  assert.equal(t('bar.chip', { n: 1 }), '1 tile');
  assert.equal(t('bar.chip', { n: 0 }), '0 tiles');
  assert.equal(t('bar.chip', { n: 7 }), '7 tiles');
  assert.equal(num(1.5), '1.5');
  setLang('fr');
  try {
    // French: singular for 0 and 1, a comma for decimals
    assert.equal(t('bar.chip', { n: 1 }), '1 tuile');
    assert.equal(t('bar.chip', { n: 0 }), '0 tuile');
    assert.equal(t('bar.chip', { n: 7 }), '7 tuiles');
    assert.equal(num(1.5), '1,5');
    assert.equal(t('done.raise', { v: '+1,5' }), 'Monté : +1,5 m');
  } finally {
    setLang('en');
  }
});

// a level's slope, with its own tiles on it
function levelWorld(level) {
  const hf = new Heightfield();
  const surf = new SurfaceMap(hf);
  const base = buildSlope(hf, surf, level.design);
  const tiles = level.tiles ? level.tiles(hf) : [];
  const z = hf.startZ + (level.start?.u ?? 14);
  return { hf, surf, base, tiles, start: { x: level.start?.x ?? 0, z } };
}

// what a player does for each step (as in the browser: select the goal, press the buttons)
const PLAN = {
  'select.pick': ['sel'],
  'select.clear': ['unsel'],
  'select.big': ['sel'],
  'raise.up': ['sel', 'raise', 'raise', 'unsel'],
  'raise.down': ['sel', 'lower', 'lower'],
  'flatten.terrace': ['sel', 'flatten'],
  'flatten.lift': ['raise'],
  'smooth.bumps': ['sel', 'smooth', 'smooth', 'smooth'],
  'pitch.steeper': ['sel', 'steepen', 'steepen', 'unsel'],
  'pitch.gentler': ['sel', 'ease', 'ease'],
  'jump.build': ['sel', 'jump', 'unsel'],
  'jump.start': ['start'],
  'jump.fly': ['ride'],
  'drop.build': ['sel', 'drop', 'unsel'],
  'drop.land': ['ride'],
  'rocks.band': ['sel', 'rocks', 'unsel'],
  'rocks.over': ['ride'],
  'gates.one': ['sel', 'gate', 'unsel'],
  'gates.wide': ['sel', 'gate', 'unsel'],
  'gates.race': ['ride'],
  'trees.wood': ['sel', 'trees', 'trees', 'unsel'],
  'trees.lane': ['sel', 'clear', 'unsel'],
  'trees.through': ['ride'],
  'snow.powder': ['sel', 'powder', 'unsel'],
  'snow.ice': ['sel', 'ice', 'unsel'],
  'snow.feel': ['ride'],
  'copy.copy': ['sel', 'copy', 'unsel'],
  'copy.paste': ['paste'],
  'copy.turn': ['rotate'],
  'erase.wipe': ['sel', 'erase'],
};

// ride straight down from the start gate, no hands
function rideStraight(w) {
  const { hf, surf, base, tiles, start } = w;
  const built = buildWorld(hf, surf, base, { tiles, start });
  const props = new PropSet(hf);
  props.set(built.props);
  const sk = new Skier(hf, { x: start.x, z: start.z, dir: fallLine(hf, start.x, start.z) });
  sk.props = props;
  sk.surface = surf;
  sk.course = new CourseRun(built.gates);
  const run = emptyRun();
  for (let k = 0; k < 240 * 40 && sk.status === 'running'; k++) {
    sk.step(1 / 240);
    followRun(run, sk, hf.startZ);
  }
  return run;
}

test('every tutorial level has its words, goals on the grid, and nothing done before you start', () => {
  assert.equal(LEVELS.length, 13, 'thirteen levels');
  const actions = new Set();
  for (const level of LEVELS) {
    for (const k of [`tut.${level.id}`, `tut.${level.id}.lede`]) assert.ok(k in TUT_STRINGS.en && k in TUT_STRINGS.fr, k);
    const w = levelWorld(level);
    for (const s of level.steps) {
      assert.ok(`tut.${level.id}.${s.id}` in TUT_STRINGS.fr, `words for ${level.id}.${s.id}`);
      assert.ok(PLAN[`${level.id}.${s.id}`], `a plan for ${level.id}.${s.id}`);
      if (s.hint && ACTIONS[s.hint]) actions.add(s.hint);
      if (!s.goal) continue;
      const g = resolveGoal(w.hf, s.goal);
      assert.ok(g.length > 0, `${level.id}.${s.id}: goal tiles`);
      assert.ok(g.every(([i, j]) => i >= 0 && j >= 0 && i < gridCols(w.hf) && j < gridRows(w.hf)), 'on the grid');
      assert.equal(new Set(g.map(([i, j]) => tileKey(i, j))).size, g.length, 'each tile once');
    }
    const first = level.steps[0];
    const c = checkContext(w.hf, { tiles: w.tiles, sel: new Set(), clip: null, start: w.start }, resolveGoal(w.hf, first.goal));
    assert.equal(first.done(c), false, `${level.id}: not done before you start`);
  }
  // every tile action is taught somewhere
  for (const id of Object.keys(ACTIONS)) assert.ok(actions.has(id), `a level for ${id}`);
});

test('every tutorial level can be done, step by step, the way it says (rides included)', () => {
  for (const level of LEVELS) {
    const w = levelWorld(level);
    let sel = new Set();
    let clip = null;
    let run = emptyRun();
    for (const s of level.steps) {
      const goal = resolveGoal(w.hf, s.goal);
      const list = () => [...sel].map((k) => k.split(',').map(Number));
      for (const what of PLAN[`${level.id}.${s.id}`]) {
        if (what === 'sel') sel = new Set(goal.map(([i, j]) => tileKey(i, j)));
        else if (what === 'unsel') sel = new Set();
        else if (what === 'start') {
          const c = tileCenter(w.hf, ...goal[0]);
          w.start = { x: c.x, z: c.z };
        } else if (what === 'copy') clip = copyTiles(w.tiles, list());
        else if (what === 'paste') {
          // the copy's anchor on the goal's first tile: it lands on the goal
          const r = pasteTiles(w.tiles, clip, goal[0][0], goal[0][1], gridCols(w.hf), gridRows(w.hf));
          w.tiles = r.tiles;
          sel = new Set(r.placed.map(([i, j]) => tileKey(i, j)));
        } else if (what === 'ride') run = rideStraight(w);
        else w.tiles = applyAction(w.tiles, list(), what, { dir: 0 });
      }
      const c = checkContext(w.hf, { tiles: w.tiles, sel, clip, start: w.start }, goal, run);
      assert.ok(s.done(c), `${level.id}.${s.id} done (${JSON.stringify({ air: run.air.toFixed(2), land: run.cleanLand, fin: run.finished, hits: run.hits, u: Math.round(run.u) })})`);
    }
  }
});

test('the ride steps aren’t done by just riding the bare slope', () => {
  for (const level of LEVELS) {
    const ride = level.steps.find((s) => s.ride);
    // (riding through your lane, or across your powder and ice, is the point there)
    if (!ride || level.id === 'snow' || level.id === 'trees') continue;
    const w = levelWorld(level);
    const run = rideStraight(w);
    const c = checkContext(w.hf, { tiles: w.tiles, sel: new Set(), clip: null, start: w.start }, [], run);
    assert.equal(ride.done(c), false, `${level.id}: needs what you built`);
  }
});
