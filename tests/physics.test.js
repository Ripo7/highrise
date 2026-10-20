import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield } from '../src/core/heightfield.js';
import { Skier } from '../src/core/skier.js';
import { applyBrush } from '../src/core/brushes.js';
import { History } from '../src/core/history.js';

const START = { x: 0, z: -105 };

test('default mountain is skiable to the finish', () => {
  const hf = new Heightfield();
  hf.generateDefault();
  const s = new Skier(hf, START).simulate();
  assert.equal(s.status, 'finished');
  assert.ok(s.time > 5 && s.time < 30, `time ${s.time}`);
  assert.ok(s.maxSpeed * 3.6 < 160, 'speeds stay plausible');
});

test('a kicker in the line produces a jump', () => {
  const hf = new Heightfield();
  hf.generateDefault();
  for (let k = 0; k < 25; k++) applyBrush(hf, { tool: 'raise', x: 0, z: -20, radius: 8, strength: 1, dt: 1 / 60 });
  const s = new Skier(hf, START).simulate();
  assert.ok(s.jumps >= 1, 'at least one jump');
  assert.ok(s.events.some((e) => e.type === 'jump'));
});

test('a flat field stops the skier', () => {
  const hf = new Heightfield();
  hf.h.fill(10);
  const s = new Skier(hf, START).simulate();
  assert.equal(s.status, 'stuck');
});

test('smooth and flatten converge', () => {
  const hf = new Heightfield();
  hf.generateDefault();
  const before = hf.heightAt(0, 0);
  for (let k = 0; k < 200; k++) applyBrush(hf, { tool: 'flatten', x: 0, z: 0, radius: 10, strength: 1, dt: 1 / 60, targetHeight: before + 5 });
  assert.ok(Math.abs(hf.heightAt(0, 0) - (before + 5)) < 0.2);
});

test('undo and redo restore snapshots', () => {
  const hf = new Heightfield();
  hf.generateDefault();
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

import { strokeTo } from '../src/core/brushes.js';

test('a fast swipe leaves a continuous ridge', () => {
  const hf = new Heightfield();
  hf.generateDefault();
  const before = hf.copy();
  const stroke = { last: null, carry: 0 };
  // 80 m swipe in 0.15 s at 60 fps (≈ 9 frames)
  for (let f = 0; f <= 9; f++) {
    strokeTo(hf, stroke, { tool: 'raise', x: -40 + (80 * f) / 9, z: 0, radius: 12, strength: 0.5, dt: 1 / 60 });
  }
  for (const x of [-30, -10, 10, 30]) {
    const [gx, gz] = hf.toGrid(x, 0);
    const k = Math.round(gz) * hf.res + Math.round(gx);
    const gain = hf.h[k] - before[k];
    assert.ok(gain > 1, `ridge at x=${x} only ${gain.toFixed(2)} m`);
  }
});
