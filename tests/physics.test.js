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

test('landing upside down wipes out, then the skier gets up and finishes', () => {
  const kick = 260;
  const { s, score } = ride('kickers', (s, hf) => {
    const u = s.pos[2] + hf.halfZ;
    s.input.crouch = u > kick - 12 && u < kick - 0.5;
    // half a backflip, then let go: too far from upright for the landing assist
    s.input.pitch = !s.grounded && u > kick && u < kick + 200 && s.flipTotal < Math.PI ? -1 : 0;
  });
  assert.ok(s.events.some((e) => e.type === 'wipeout' && e.reason === 'flip'));
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

test('a speed streak above 100 km/h earns points, banks when you slow down, and a wipeout loses it', () => {
  const sk = new ScoreKeeper();
  const fake = { events: [], grounded: true, wipeout: 0, speed: 35, status: 'running' }; // 126 km/h
  for (let i = 0; i < 300; i++) sk.update(fake, 1 / 60); // 5 s
  assert.ok(sk.streak && sk.streak.points > 500, `streak ${sk.streak?.points}`);
  assert.equal(sk.total, 0, 'not banked yet');
  fake.speed = 20; // 72 km/h
  for (let i = 0; i < 60; i++) sk.update(fake, 1 / 60);
  assert.ok(sk.total > 500 && sk.speedPoints === sk.total, `banked ${sk.total}`);
  assert.ok(sk.feed.some((f) => f.kind === 'speed'));
  // a new streak, then a wipeout
  fake.speed = 40;
  for (let i = 0; i < 120; i++) sk.update(fake, 1 / 60);
  const before = sk.total;
  fake.events.push({ type: 'wipeout', reason: 'impact' });
  fake.wipeout = 1.6; // tumbling
  sk.update(fake, 1 / 60);
  assert.equal(sk.streak, null);
  assert.equal(sk.total, before, 'streak lost, nothing banked');
});

test('letting go mid-flip lets the skier right himself instead of falling', () => {
  const kick = 260;
  const { s } = ride('kickers', (s, hf) => {
    const u = s.pos[2] + hf.halfZ;
    s.input.crouch = u > kick - 12 && u < kick - 0.5;
    // stop pulling 70° short of a full backflip
    s.input.pitch = !s.grounded && u > kick && u < kick + 200 && s.flipTotal < 2 * Math.PI - 1.2 ? -1 : 0;
  });
  const flip = s.events.find((e) => e.type === 'land' && e.flips === 1);
  assert.ok(flip, 'the assist finished the flip');
  assert.notEqual(flip.quality, 'wipeout');
  assert.equal(s.wipeouts, 0);
});

test('running into the edge of the piste bumps you back without a fall', () => {
  const { hf, start } = mountain('blank');
  const s = new Skier(hf, start);
  // heading for the left edge at speed
  s.pos[0] = hf.halfX - 30;
  s.pos[1] = hf.heightAt(s.pos[0], s.pos[2]);
  s.vel = [18, 0, 8];
  s.heading = [0.9, 0, 0.44];
  for (let k = 0; k < 240 * 5 && s.status === 'running'; k++) s.step(1 / 240);
  assert.ok(s.events.some((e) => e.type === 'bump'), 'reached the edge');
  assert.equal(s.wipeouts, 0);
});

import { PropSet, scatterProps, packProps, unpackProps, TREE, ROCK } from '../src/core/props.js';

function straightRun(deg = 20, length = 800) {
  const e = Array.from({ length: length / PROFILE_STEP + 1 }, (_, i) => -Math.tan((deg * Math.PI) / 180) * i * PROFILE_STEP);
  const hf = new Heightfield();
  const start = buildFromProfile(hf, e);
  return { hf, start };
}

test('skiing straight into a tree is a wipeout', () => {
  const { hf, start } = straightRun();
  const props = new PropSet(hf);
  props.add({ k: TREE, u: 200, x: 0, s: 1, r: 0 });
  const s = new Skier(hf, start);
  s.props = props;
  s.simulate();
  const w = s.events.find((e) => e.type === 'wipeout');
  assert.ok(w && w.reason === 'tree', 'hit the tree');
});

test('clipping the side of a tree is a bump, not a fall', () => {
  const { hf, start } = straightRun();
  const props = new PropSet(hf);
  props.add({ k: TREE, u: 200, x: 1.2, s: 1, r: 0 }); // the skier passes 1.2 m from its centre
  const s = new Skier(hf, start);
  s.props = props;
  s.simulate();
  assert.ok(s.events.some((e) => e.type === 'bump' && e.what === 'tree'), 'touched it');
  assert.equal(s.wipeouts, 0);
  assert.equal(s.status, 'finished');
});

test('flying over a rock clears it', () => {
  const { hf, start } = straightRun();
  const props = new PropSet(hf);
  props.add({ k: ROCK, u: 200, x: 0, s: 1, r: 0 });
  const s = new Skier(hf, start);
  s.props = props;
  // load a full jump and pop ~15 m before the rock
  while (s.pos[2] - hf.startZ < 172) s.step(1 / 240);
  s.input.crouch = true;
  for (let k = 0; k < 110; k++) s.step(1 / 240);
  s.input.crouch = false;
  s.simulate();
  assert.equal(s.wipeouts, 0);
  assert.ok(!s.events.some((e) => e.type === 'bump'));
});

test('auto-scattered forest covers the whole mountain in patches, start and finish clear', () => {
  const { hf } = straightRun(22, 1600);
  const list = scatterProps(hf, 0, 1600, 3);
  assert.ok(list.length > 400 && list.length < 4000, `${list.length} props`);
  assert.ok(list.some((p) => p.k === ROCK) && list.some((p) => p.k === TREE));
  // free mountain: trees in the middle too, not just a forest along the sides
  const middle = list.filter((p) => p.k === TREE && Math.abs(p.x) < 46).length;
  assert.ok(middle > 20, `${middle} trees in the middle`);
  // but in patches: plenty of the mountain stays open snow (glades)
  const cells = new Set(list.map((p) => `${Math.floor(p.x / 40)},${Math.floor(p.u / 40)}`));
  const total = Math.ceil(480 / 40) * Math.ceil(1600 / 40);
  assert.ok(cells.size < total * 0.85, `${cells.size} of ${total} 40 m squares have props`);
  // nothing right at the start gate or under the finish arch
  const finishU = hf.finishZ - hf.startZ;
  assert.ok(list.every((p) => !(p.u < 60 && Math.abs(p.x) < 70)));
  assert.ok(list.every((p) => !(p.u > finishU - 50 && Math.abs(p.x) < 40)));
  // save round trip
  const back = unpackProps(packProps(list));
  assert.equal(back.length, list.length);
  assert.ok(Math.abs(back[10].u - list[10].u) < 0.06);
});

test('4 km of scatter stays light enough for phones', () => {
  const { hf } = straightRun(25, 4000);
  const list = scatterProps(hf, 0, 4000, 9);
  assert.ok(list.length < 9000, `${list.length} props`);
});

test('a run plays out the same at any frame rate (fixed physics step)', () => {
  const result = (fps) => {
    const { hf, start } = mountain('kickers');
    const s = new Skier(hf, start);
    while (s.status === 'running') s.update(1 / fps);
    return { time: s.time.toFixed(3), jumps: s.jumps, air: s.airTime.toFixed(3), x: s.pos[0].toFixed(3) };
  };
  const ref = result(60);
  for (const fps of [30, 75, 120, 144, 165, 240]) assert.deepEqual(result(fps), ref, `${fps} fps`);
});

test('the recorded path keeps 30 samples a second at high refresh rates (ghost stays in time)', () => {
  const { hf, start } = mountain('blank');
  const s = new Skier(hf, start);
  while (s.status === 'running' && s.time < 20) s.update(1 / 165);
  const samples = s.path.length - 1;
  assert.ok(Math.abs(samples / 30 - s.time) < 0.05, `${samples} samples for ${s.time.toFixed(2)} s`);
});

test('a tuck held over a kicker lip does not start a front flip', () => {
  const { hf, start } = mountain('kickers');
  const s = new Skier(hf, start);
  let maxPitchEarly = 0;
  while (s.status === 'running' && s.jumps < 1) {
    // tuck all the way into the jump, let go 0.15 s after leaving the lip
    s.input.pitch = s.grounded || s.sinceGround < 0.15 ? 1 : 0;
    s.step(1 / 240);
    if (!s.grounded && s.sinceGround < 0.15) maxPitchEarly = Math.max(maxPitchEarly, Math.abs(s.pitch));
  }
  assert.ok(maxPitchEarly < 0.01, `pitched ${maxPitchEarly.toFixed(2)} rad off the lip`);
  const land = s.events.find((e) => e.type === 'land');
  assert.equal(land.flips, 0);
  assert.equal(land.quality, 'clean');
});

test('a deliberate pop with the stick held spins straight away', () => {
  const { hf, start } = mountain('kickers');
  const s = new Skier(hf, start);
  while (s.grounded) s.step(1 / 240);
  while (!s.grounded) s.step(1 / 240); // land the first kicker
  s.input.crouch = true;
  for (let k = 0; k < 120; k++) s.step(1 / 240);
  s.input.steer = 1;
  s.input.crouch = false;
  s.step(1 / 240);
  for (let k = 0; k < 24; k++) s.step(1 / 240); // 0.1 s
  assert.ok(Math.abs(s.spin) > 0.2, `spun ${s.spin.toFixed(2)} rad in 0.1 s`);
});
