// The ride camera's hand: shake by trauma, springs for the landing dip and the lens

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShake, createSpring } from '../src/render/cameraFeel.js';

const run = (fn, seconds, dt = 1 / 60) => {
  const out = [];
  for (let t = 0; t < seconds; t += dt) out.push(fn(dt));
  return out;
};

test('a knock shakes the camera, then it settles', () => {
  const s = createShake({ decay: 1.5 });
  s.add(0.8);
  const xs = run((dt) => Math.hypot(s.update(dt).x, s.y), 0.3);
  assert.ok(Math.max(...xs) > 0.05, 'a big knock shows');
  run((dt) => s.update(dt), 1);
  assert.equal(s.trauma, 0);
  assert.equal(Math.abs(s.x), 0);
  assert.equal(Math.abs(s.roll), 0);
});

test('small knocks barely show, big ones really do (trauma squared)', () => {
  const peak = (k) => {
    const s = createShake();
    s.add(k);
    return Math.max(...run((dt) => Math.abs(s.update(dt).y), 0.2));
  };
  assert.ok(peak(0.9) > peak(0.3) * 5);
  const s = createShake();
  s.add(0.7);
  s.add(0.7);
  assert.equal(s.trauma, 1, 'never more than full');
});

test('the shake is smooth: no jolt from one frame to the next', () => {
  const s = createShake({ decay: 0 });
  s.add(1);
  const ys = run((dt) => s.update(dt).y, 1);
  let worst = 0;
  for (let i = 1; i < ys.length; i++) worst = Math.max(worst, Math.abs(ys[i] - ys[i - 1]));
  // at 60 fps a step is a fraction of the swing (random jolts would jump across it)
  assert.ok(worst < 0.25, `largest step ${worst}`);
});

test('a kicked spring dips, overshoots a little and comes back', () => {
  const d = createSpring(0, { k: 70, d: 0.45 });
  d.kick(-4);
  const v = run((dt) => d.step(0, dt), 2);
  const low = Math.min(...v);
  const high = Math.max(...v);
  assert.ok(low < -0.2 && low > -0.6, `dip ${low}`);
  assert.ok(high > 0 && high < -low * 0.5, `overshoot ${high}`);
  assert.ok(Math.abs(v.at(-1)) < 1e-3, 'settled');
});

test('a spring follows its target, the same at any frame rate', () => {
  const at = (dt) => {
    const f = createSpring(60, { k: 36, d: 0.85 });
    for (let i = 0, n = Math.round(0.4 / dt); i < n; i++) f.step(80, dt);
    return f.value;
  };
  assert.ok(Math.abs(at(1 / 30) - at(1 / 144)) < 0.6);
  const f = createSpring(60, { k: 36, d: 0.85 });
  run((dt) => f.step(80, dt), 3);
  assert.ok(Math.abs(f.value - 80) < 0.05);
  // a long frame (a tab in the background) can't blow it up
  f.step(60, 5);
  assert.ok(f.value > 55 && f.value < 85);
});
