// Gates: the Gate action, the course they make, and riding through it

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield } from '../src/core/heightfield.js';
import { SurfaceMap } from '../src/core/surface.js';
import { PropSet } from '../src/core/props.js';
import { Skier } from '../src/core/skier.js';
import { buildSlope } from '../src/core/slopes.js';
import { buildWorld } from '../src/core/world.js';
import { tileOf, tileCenter, gridCols, gridRows } from '../src/core/terrain.js';
import { HEX_W } from '../src/core/hex.js';
import { applyAction, describe, copyTiles, pasteTiles, packTiles, unpackTiles } from '../src/core/tiles.js';
import { buildGates, courseKey, CourseRun } from '../src/core/course.js';
import { ScoreKeeper, GATE_POINTS } from '../src/core/score.js';

function slope(sections = [{ slope: 16, length: 500 }], width = 'medium') {
  const hf = new Heightfield();
  const surf = new SurfaceMap(hf);
  const base = buildSlope(hf, surf, { width, sections });
  const at = (x, u) => {
    const t = tileOf(hf, x, hf.startZ + u);
    return [t.i, t.j];
  };
  return { hf, surf, base, at, start: { x: 0, z: hf.startZ + 14 } };
}

test('Gate makes one gate of the selection; again takes it away; erase, copy and paste know it', () => {
  const { at } = slope();
  const row = [at(-10, 100), at(0, 100), at(10, 100)];
  let t = applyAction([], row, 'gate');
  assert.equal(t.length, 3);
  assert.ok(t.every((x) => x.gate === t[0].gate && x.gate > 0), 'one gate for the three tiles');
  assert.ok(describe(t, row).gate, 'the bar shows it on');
  const two = applyAction(t, [at(0, 200)], 'gate');
  assert.notEqual(two.find((x) => x.j === at(0, 200)[1]).gate, t[0].gate, 'another tap, another gate');
  assert.equal(applyAction(t, row, 'gate').length, 0, 'tapped again: gone');
  // on top of anything else
  const both = applyAction(applyAction([], [at(0, 100)], 'jump'), [at(0, 100)], 'gate');
  assert.ok(both[0].feat === 'jump' && both[0].gate > 0, 'a gate on a jump');
  assert.equal(applyAction(both, [at(0, 100)], 'erase').length, 0, 'erase takes all of it');
  // a pasted gate is a gate of its own
  const clip = copyTiles(t, row);
  const p = pasteTiles(t, clip, ...at(0, 300), 200, 200).tiles;
  assert.equal(new Set(p.map((x) => x.gate)).size, 2, 'the copy is another gate');
  // saved and loaded, and the saves from before gates still load
  assert.deepEqual(unpackTiles(packTiles(p)), p);
  const old = packTiles(applyAction([], [at(0, 100)], 'raise')).slice(0, 12);
  const back = unpackTiles(old, 12);
  assert.equal(back.length, 1);
  assert.equal(back[0].lift, 1.5);
  assert.equal(back[0].gate, 0);
});

test('a gate stands across the fall line, as wide as its tiles; gates are numbered down the mountain', () => {
  const { hf, at, start } = slope();
  let tiles = applyAction([], [at(-20, 250)], 'gate');
  tiles = applyAction(tiles, [at(-10, 120), at(0, 120), at(10, 120)], 'gate');
  tiles = applyAction(tiles, [at(30, 6)], 'gate'); // above the start gate
  const gates = buildGates(hf, tiles, start);
  assert.equal(gates.length, 3);
  const [above, wide, one] = gates;
  assert.ok(above.behind && above.n === 0, 'above the start: it doesn’t count');
  assert.equal(wide.n, 1, 'numbered from the top');
  assert.equal(one.n, 2);
  assert.ok(Math.abs(one.dir[1] - 1) < 0.01, 'facing down the fall line');
  const c = tileCenter(hf, ...at(-20, 250));
  assert.ok(Math.hypot(one.x - c.x, one.z - c.z) < 0.01, 'at the middle of its tile');
  assert.ok(Math.abs(one.half - (HEX_W / 2 - 0.5)) < 0.01, `one tile: ${(2 * one.half).toFixed(1)} m between the poles`);
  assert.ok(Math.abs(wide.half - (HEX_W * 1.5 - 0.5)) < 0.2, `three tiles: ${(2 * wide.half).toFixed(1)} m`);
  // the course is the gates' tiles: the snow around them can change, it's the same course
  const key = courseKey(gates);
  assert.equal(courseKey(buildGates(hf, applyAction(tiles, [at(0, 160)], 'raise'), start)), key);
  assert.notEqual(courseKey(buildGates(hf, applyAction(tiles, [at(0, 400)], 'gate'), start)), key);
});

test('through a gate between its poles; past it outside them is a miss; the other way is nothing', () => {
  const gate = { n: 1, key: 'a', x: 0, z: 0, dir: [0, 1], across: [1, 0], half: 4.7, behind: false };
  const run = new CourseRun([gate]);
  assert.deepEqual(run.step(10, -1, 10, 1, 1), [{ type: 'miss', n: 1, t: 1 }], 'outside the poles');
  assert.ok(!run.complete);
  assert.equal(run.step(2, 1, 2, -1, 2).length, 0, 'uphill: nothing');
  const ev = run.step(-3, -0.4, -2, 0.3, 3);
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0], { type: 'gate', n: 1, count: 1, total: 1, t: 3 });
  assert.ok(run.complete);
  assert.deepEqual(run.splits, [3]);
  assert.equal(run.step(-3, -1, -2, 1, 4).length, 0, 'once only');
  // a paused run on a changed course: what's still there keeps its state
  const other = { ...gate, key: 'b', n: 2, z: 50 };
  const next = run.carryTo([gate, other]);
  assert.deepEqual(next.passed, [true, false]);
  assert.equal(next.count, 1);
  assert.equal(next.total, 2);
});

test('trees keep out of a gate', () => {
  const { hf, surf, base, at, start } = slope();
  const wood = [];
  for (let x = -40; x <= 40; x += 10) for (let u = 80; u <= 160; u += 9) wood.push(at(x, u));
  let tiles = applyAction(applyAction(applyAction([], wood, 'trees'), wood, 'trees'), wood, 'trees');
  tiles = applyAction(tiles, [at(0, 120), at(10, 120)], 'gate');
  const w = buildWorld(hf, surf, base, { tiles, start });
  const g = w.gates[0];
  const inGate = w.props.filter((p) => {
    const dx = p.x - g.x;
    const dz = hf.startZ + p.u - g.z;
    return Math.abs(dx * g.dir[0] + dz * g.dir[1]) < 3 && Math.abs(dx * g.across[0] + dz * g.across[1]) < g.half + 1;
  });
  assert.ok(w.props.length > 20, `a wood (${w.props.length} trees)`);
  assert.equal(inGate.length, 0, 'none between the poles');
});

// ride down steering for the next gate (no hands with gain 0)
function race(env, tiles, gain = 2) {
  const { hf, surf, base, start } = env;
  const w = buildWorld(hf, surf, base, { tiles, start });
  const props = new PropSet(hf);
  props.set(w.props);
  const sk = new Skier(hf, { x: start.x, z: start.z, dir: [0, 1] });
  sk.props = props;
  sk.surface = surf;
  sk.course = new CourseRun(w.gates);
  const score = new ScoreKeeper();
  for (let k = 0; k < 240 * 90 && sk.status === 'running'; k++) {
    const c = sk.course;
    const next = c.gates.find((g, i) => !c.passed[i] && g.z > sk.pos[2] - 2);
    const tx = next ? next.x : sk.pos[0];
    const tz = next ? next.z + 6 : sk.pos[2] + 50;
    let e = Math.atan2(tx - sk.pos[0], tz - sk.pos[2]) - Math.atan2(sk.vel[0], sk.vel[2]);
    while (e > Math.PI) e -= 2 * Math.PI;
    while (e < -Math.PI) e += 2 * Math.PI;
    sk.input.steer = Math.max(-1, Math.min(1, -gain * e));
    sk.step(1 / 240);
    score.update(sk, 1 / 240);
  }
  return { sk, course: sk.course, score };
}

test('a slalom: ride it straight and miss the gates; steer through them and the run counts', () => {
  const env = slope();
  let tiles = [];
  for (const [x, u] of [
    [-25, 100],
    [25, 180],
    [-25, 260],
    [25, 340],
  ])
    tiles = applyAction(tiles, [env.at(x, u)], 'gate');
  const straight = race(env, tiles, 0);
  assert.equal(straight.sk.status, 'finished');
  assert.equal(straight.course.count, 0, 'straight down: through none');
  assert.ok(straight.course.missed.every(Boolean), 'and every one missed');
  assert.ok(straight.score.feed.some((f) => f.i18n?.text?.[0] === 'feed.missed'), 'the feed says so');
  const steered = race(env, tiles, 2);
  assert.equal(steered.sk.status, 'finished');
  assert.ok(steered.course.complete, `through all four (${steered.course.count}/4)`);
  assert.ok(steered.course.splits.every((t, k) => k === 0 || t > steered.course.splits[k - 1]), 'splits in order');
  assert.equal(steered.score.gatePoints, 4 * GATE_POINTS);
  // next time, the splits against that run
  const best = steered.course.splits;
  const again = new ScoreKeeper({ splits: best.map((t) => t - 0.5) });
  again.onEvent({ type: 'gate', n: 1, count: 1, total: 4, t: best[0] });
  assert.deepEqual(again.feed[0].i18n.sub, ['feed.splitBehind', { t: Math.round(best[0] * 100) / 100, d: 0.5 }]);
  const faster = new ScoreKeeper({ splits: best.map((t) => t + 1) });
  faster.onEvent({ type: 'gate', n: 1, count: 1, total: 4, t: best[0] });
  assert.equal(faster.feed[0].i18n.sub[0], 'feed.splitAhead');
});

test('the grid of a course fits every slope width', () => {
  for (const width of ['narrow', 'medium', 'wide']) {
    const env = slope([{ slope: 20, length: 300 }], width);
    const left = applyAction([], [[0, 10]], 'gate');
    const right = applyAction(left, [[gridCols(env.hf) - 1, 12]], 'gate');
    const gates = buildGates(env.hf, right, env.start);
    assert.equal(gates.length, 2, width);
    assert.ok(gates.every((g) => Math.abs(g.x) < env.hf.halfX && g.z < env.hf.startZ + gridRows(env.hf) * 9 + 9), `${width}: on the mountain`);
  }
});
