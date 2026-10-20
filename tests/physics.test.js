import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield, encodeHeights, decodeHeights } from '../src/core/heightfield.js';
import { Skier } from '../src/core/skier.js';
import { applyBrush, strokeTo } from '../src/core/brushes.js';
import { History } from '../src/core/history.js';
import { TEMPLATES, buildTemplate } from '../src/core/templates.js';

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
    assert.ok(!s.events.some((e) => e.type === 'crash'), 'no crash hands-off');
  });
}

test('the kicker line produces five clean jumps', () => {
  const { hf, start } = mountain('kickers');
  const s = new Skier(hf, start).simulate();
  assert.equal(s.jumps, 5);
  assert.ok(s.airTime > 5, `air ${s.airTime.toFixed(1)} s`);
  assert.ok(!s.events.some((e) => e.type === 'rough' || e.type === 'crash'));
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

test('autosave round-trips heights to the centimetre', () => {
  const { hf } = mountain('couloir');
  const back = decodeHeights(encodeHeights(hf.h), hf.h.length);
  let worst = 0;
  for (let i = 0; i < hf.h.length; i++) worst = Math.max(worst, Math.abs(back[i] - hf.h[i]));
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
