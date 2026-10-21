import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield, encodeHeights, decodeHeights } from '../src/core/heightfield.js';
import { Skier } from '../src/core/skier.js';
import { applyBrush, strokeTo } from '../src/core/brushes.js';
import { History } from '../src/core/history.js';
import { TEMPLATES, buildTemplate } from './fixtures/templates.js';
import { ScoreKeeper, judgeLanding } from '../src/core/score.js';

function mountain(id = 'blank') {
  const hf = new Heightfield();
  const start = buildTemplate(hf, id);
  return { hf, start };
}

for (const tpl of TEMPLATES) {
  test(`template "${tpl.name}" is skiable hands-off, fast and long`, () => {
    const { hf, start } = mountain(tpl.id);
    const s = new Skier(hf, start).simulate();
    assert.equal(s.status, 'finished', `${tpl.id} ended ${s.status} at z=${s.pos[2].toFixed(0)}`);
    assert.ok(s.time > 30, `${tpl.id} run only ${s.time.toFixed(1)} s`);
    assert.ok(s.maxSpeed * 3.6 > 110, `${tpl.id} too slow: ${(s.maxSpeed * 3.6).toFixed(0)} km/h`);
    assert.ok(s.maxSpeed * 3.6 < 200, 'speeds stay plausible');
    assert.equal(s.wipeouts, 0, 'no wipeout hands-off');
  });
}

test('the kicker line produces five clean jumps', () => {
  const { hf, start } = mountain('kickers');
  const s = new Skier(hf, start).simulate();
  assert.equal(s.jumps, 5);
  assert.ok(s.airTime > 5, `air ${s.airTime.toFixed(1)} s`);
  const lands = s.events.filter((e) => e.type === 'land');
  assert.ok(lands.every((e) => e.quality === 'clean'), lands.map((e) => e.quality).join(','));
});

// ride a skier with a per-step controller until the run ends
function ride(id, control) {
  const { hf, start } = mountain(id);
  const s = new Skier(hf, start);
  const score = new ScoreKeeper();
  while (s.status === 'running') {
    control(s, hf);
    s.step(1 / 240);
    score.update(s, 1 / 240);
  }
  score.finish(s);
  return { s, score };
}

test('releasing a crouch pops the skier into the air', () => {
  const { hf, start } = mountain('blank');
  const s = new Skier(hf, start);
  for (let k = 0; k < 240 * 2; k++) s.step(1 / 240);
  s.input.crouch = true;
  for (let k = 0; k < 240 * 0.5; k++) s.step(1 / 240);
  s.input.crouch = false;
  s.step(1 / 240);
  assert.equal(s.grounded, false);
  let air = 0;
  while (!s.grounded) {
    s.step(1 / 240);
    air += 1 / 240;
  }
  assert.ok(air > 0.5, `air ${air.toFixed(2)} s`);
  assert.ok(s.events.some((e) => e.type === 'pop'));
});

test('a backflip off a kicker lands clean and scores', () => {
  const kick = 260;
  const { s, score } = ride('kickers', (s, hf) => {
    const u = s.pos[2] + hf.halfZ;
    s.input.crouch = (u > kick - 12 && u < kick - 0.5) || (!s.grounded && s.curAir > 2.4);
    s.input.pitch = !s.grounded && u > kick && u < kick + 200 && s.flipTotal < 2 * Math.PI - 0.5 ? -1 : 0;
  });
  const flip = s.events.find((e) => e.type === 'land' && e.flips === 1);
  assert.ok(flip, 'landed a flip');
  assert.equal(flip.flipDir, 'back');
  assert.equal(flip.quality, 'clean');
  assert.ok(score.tricks.some((t) => t.name === 'Backflip'));
  assert.ok(score.total > 3000, `score ${score.total}`);
});

test('landing sideways wipes out, then the skier gets up and finishes', () => {
  const kick = 260;
  const { s, score } = ride('kickers', (s, hf) => {
    const u = s.pos[2] + hf.halfZ;
    // quarter turn in the air: skis across the slope on touchdown
    s.input.steer = !s.grounded && u > kick && u < kick + 200 && Math.abs(s.spin) < Math.PI / 2 ? 1 : 0;
  });
  assert.ok(s.events.some((e) => e.type === 'wipeout' && e.reason === 'sideways'));
  assert.ok(s.events.some((e) => e.type === 'recover'));
  assert.equal(s.status, 'finished');
  assert.ok(score.feed.some((f) => f.kind === 'wipeout'));
});

test('an absorbing crouch does not pop on release', () => {
  const { hf, start } = mountain('kickers');
  const s = new Skier(hf, start);
  while (s.grounded) s.step(1 / 240); // reach the first kicker
  s.input.crouch = true;
  while (!s.grounded) s.step(1 / 240);
  const pops = s.events.filter((e) => e.type === 'pop').length;
  s.input.crouch = false;
  for (let k = 0; k < 10; k++) s.step(1 / 240);
  assert.equal(s.events.filter((e) => e.type === 'pop').length, pops);
});

test('tricks are named and combos multiply', () => {
  assert.equal(judgeLanding({ air: 1.2, spin: 360, flips: 0, quality: 'clean', switch: false }).name, '360');
  assert.equal(judgeLanding({ air: 1.6, spin: 0, flips: 2, flipDir: 'back', quality: 'clean' }).name, 'Double Backflip');
  assert.equal(judgeLanding({ air: 1.2, spin: 540, flips: 0, quality: 'clean', switch: true }).name, 'Switch 540');
  assert.equal(judgeLanding({ air: 0.4, spin: 0, flips: 0, quality: 'clean' }), null);
  const sk = new ScoreKeeper();
  const fake = { events: [], grounded: true, wipeout: 0, status: 'finished' };
  fake.events.push({ type: 'land', air: 1.2, spin: 360, flips: 0, quality: 'clean' });
  fake.events.push({ type: 'land', air: 1.2, spin: 360, flips: 0, quality: 'clean' });
  sk.update(fake, 0);
  assert.equal(sk.multiplier, 1.5);
  const pending = sk.pending;
  sk.update(fake, 10); // combo window runs out: banked
  assert.equal(sk.total, pending);
  fake.events.push({ type: 'land', air: 1.2, spin: 360, flips: 0, quality: 'clean' });
  fake.events.push({ type: 'wipeout', reason: 'impact' });
  sk.update(fake, 0);
  assert.equal(sk.pending, 0, 'wipeout loses the combo');
  assert.equal(sk.total, pending);
});

test('a kicker sculpted on the blank slope produces a jump', () => {
  const { hf, start } = mountain('blank');
  for (let k = 0; k < 25; k++) applyBrush(hf, { tool: 'raise', x: 0, z: -300, radius: 8, strength: 1, dt: 1 / 60 });
  const s = new Skier(hf, start).simulate();
  assert.ok(s.jumps >= 1, 'at least one jump');
});

test('a flat field stops the skier', () => {
  const hf = new Heightfield();
  hf.h.fill(10);
  const s = new Skier(hf, { x: 0, z: hf.startZ }).simulate();
  assert.equal(s.status, 'stuck');
});

test('flatten converges on its target', () => {
  const { hf } = mountain('valley');
  const target = hf.heightAt(0, 0) + 5;
  for (let k = 0; k < 200; k++) applyBrush(hf, { tool: 'flatten', x: 0, z: 0, radius: 10, strength: 1, dt: 1 / 60, targetHeight: target });
  assert.ok(Math.abs(hf.heightAt(0, 0) - target) < 0.2);
});

test('undo and redo restore snapshots', () => {
  const { hf } = mountain('blank');
  const h = new History();
  const orig = hf.copy();
  h.push(hf.copy());
  applyBrush(hf, { tool: 'raise', x: 0, z: 0, radius: 10, strength: 1, dt: 1 });
  const edited = hf.copy();
  hf.set(h.undo(hf.copy()));
  assert.deepEqual(hf.h, orig);
  hf.set(h.redo(hf.copy()));
  assert.deepEqual(hf.h, edited);
});

test('autosave round-trips sculpting to the centimetre', () => {
  const { hf } = mountain('couloir');
  const base = hf.copy();
  for (let k = 0; k < 60; k++) applyBrush(hf, { tool: 'raise', x: 20, z: -100, radius: 30, strength: 1, dt: 1 / 30 });
  for (let k = 0; k < 60; k++) applyBrush(hf, { tool: 'lower', x: -40, z: 200, radius: 30, strength: 1, dt: 1 / 30 });
  const delta = hf.h.map((v, i) => v - base[i]);
  const back = decodeHeights(encodeHeights(delta), delta.length);
  let worst = 0;
  for (let i = 0; i < delta.length; i++) worst = Math.max(worst, Math.abs(back[i] - delta[i]));
  assert.ok(worst <= 0.006, `worst error ${worst}`);
});

test('a fast swipe leaves a continuous ridge', () => {
  const { hf } = mountain('blank');
  const before = hf.copy();
  const stroke = { last: null, carry: 0 };
  // 80 m swipe in 0.15 s at 60 fps (≈ 9 frames)
  for (let f = 0; f <= 9; f++) {
    strokeTo(hf, stroke, { tool: 'raise', x: -40 + (80 * f) / 9, z: 0, radius: 12, strength: 0.5, dt: 1 / 60 });
  }
  for (const x of [-30, -10, 10, 30]) {
    const [gx, gz] = hf.toGrid(x, 0);
    const k = Math.round(gz) * hf.nx + Math.round(gx);
    const gain = hf.h[k] - before[k];
    assert.ok(gain > 1, `ridge at x=${x} only ${gain.toFixed(2)} m`);
  }
});

test('steering right carves the skier to his right', () => {
  const { hf, start } = mountain('blank');
  const a = new Skier(hf, start);
  const b = new Skier(hf, start);
  for (let k = 0; k < 240 * 3; k++) {
    b.input.steer = k > 240 ? 1 : 0;
    a.step(1 / 240);
    b.step(1 / 240);
  }
  // facing downhill (+z), the skier's right is -x
  assert.ok(b.pos[0] < a.pos[0] - 1, `steered x ${b.pos[0].toFixed(2)} vs ${a.pos[0].toFixed(2)}`);
});

test('braking is slower than tucking', () => {
  const { hf, start } = mountain('blank');
  const tuck = new Skier(hf, start);
  tuck.input.tuck = true;
  const brake = new Skier(hf, start);
  brake.input.brake = true;
  for (let k = 0; k < 240 * 6; k++) {
    tuck.step(1 / 240);
    brake.step(1 / 240);
  }
  assert.ok(tuck.speed > brake.speed * 2, `tuck ${tuck.speed.toFixed(1)} brake ${brake.speed.toFixed(1)}`);
});

import { applyStamp, restoreRect } from '../src/core/stamps.js';

test('a kicker stamped on the blank slope launches the skier', () => {
  const { hf, start } = mountain('blank');
  const base = hf.copy();
  // a 24 m kicker straight down the fall line, lip at z = -300
  applyStamp(hf, base, 'kicker', 0, -324, 0, -300, 22, 0.5);
  const s = new Skier(hf, start).simulate();
  const land = s.events.find((e) => e.type === 'land');
  assert.ok(land && land.air > 0.8, `air ${land?.air}`);
  assert.equal(s.wipeouts, 0);
});

test('stamps are undone exactly by restoring their rect', () => {
  const { hf } = mountain('valley');
  const base = hf.copy();
  for (const kind of ['kicker', 'table', 'berm', 'rollers']) {
    const r = applyStamp(hf, base, kind, 10, -100, 30, -40, 30, 0.6);
    assert.ok(r, kind);
    restoreRect(hf, base, r);
    assert.deepEqual(hf.h, base, kind);
  }
});

import { resample, smooth, clampSlopes, profileStats, buildFromProfile, addDelta, pisteDims, PROFILE_STEP } from '../src/core/profile.js';

// a drawn run: 25° start, a flat shelf, a 35° wall, then easing out (points every ~3 m)
function drawnRun() {
  const pts = [[0, 0]];
  let e = 0;
  for (let u = 3; u <= 1600; u += 3) {
    const deg = u < 400 ? 25 : u < 520 ? 4 : u < 760 ? 35 : u < 1200 ? 18 : 10;
    e -= Math.tan((deg * Math.PI) / 180) * 3;
    pts.push([u, e]);
  }
  return smooth(clampSlopes(resample(pts)), 2);
}

test('a drawn profile becomes a skiable piste of the right length', () => {
  const e = drawnRun();
  const st = profileStats(e);
  assert.ok(Math.abs(st.length - 1600) < PROFILE_STEP + 1, `length ${st.length}`);
  assert.ok(st.maxDeg > 30 && st.maxDeg < 37, `max ${st.maxDeg.toFixed(1)}°`);
  assert.ok(st.ok);
  const hf = new Heightfield();
  const start = buildFromProfile(hf, e);
  assert.ok(Math.abs(hf.finishZ - hf.startZ - st.length) < hf.cell + 0.5, 'finish line at the end of the drawing');
  assert.ok(hf.nx * hf.nz <= 450000, `mesh ${hf.nx * hf.nz} vertices`);
  const s = new Skier(hf, start).simulate();
  assert.equal(s.status, 'finished');
  assert.ok(s.time > 30, `run ${s.time.toFixed(1)} s`);
});

test('long runs stay within the vertex budget', () => {
  const d = pisteDims(4000);
  const hf = new Heightfield(d.sizeX, d.sizeZ, d.cell);
  assert.ok(hf.nx * hf.nz <= 450000, `${hf.nx * hf.nz} vertices at ${d.cell} m`);
});

test('editing the profile keeps the sculpting in place along the run', () => {
  const e = drawnRun();
  const hf = new Heightfield();
  buildFromProfile(hf, e);
  const base = hf.copy();
  // a kicker 300 m down the run, 40 m right of centre
  const z = hf.startZ + 300;
  applyStamp(hf, base, 'kicker', 40, z - 22, 40, z, 22, 0.6);
  const delta = hf.h.map((v, i) => v - base[i]);
  const oldDims = { sizeX: hf.sizeX, sizeZ: hf.sizeZ, cell: hf.cell };
  // make the run 400 m longer and steeper at the end, then carry the sculpting over
  const e2 = e.concat(Array.from({ length: 100 }, (_, i) => e[e.length - 1] - (i + 1) * PROFILE_STEP * 0.5));
  buildFromProfile(hf, e2);
  const fresh = hf.copy();
  addDelta(hf, delta, oldDims);
  const z2 = hf.startZ + 300;
  const [gx, gz] = hf.toGrid(40, z2 - 1);
  const k = Math.round(gz) * hf.nx + Math.round(gx);
  assert.ok(hf.h[k] - fresh[k] > 1, `kicker carried over (${(hf.h[k] - fresh[k]).toFixed(2)} m)`);
});

test('a straight drawn run never launches the skier out of the gate', () => {
  for (const deg of [12, 20, 30, 45]) {
    const e = Array.from({ length: 120 }, (_, i) => -Math.tan((deg * Math.PI) / 180) * i * PROFILE_STEP);
    const hf = new Heightfield();
    const s = new Skier(hf, buildFromProfile(hf, e)).simulate();
    assert.equal(s.status, 'finished', `${deg}°`);
    assert.equal(s.jumps, 0, `${deg}° run jumped`);
  }
});
