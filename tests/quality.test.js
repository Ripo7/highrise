// Picture quality: which tier Auto picks, and how its frame governor reacts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoTier, tierFor, readSetting, pixelRatio, createGovernor, TIERS } from '../src/render/quality.js';

const desktop = { coarse: false, dpr: 2, memory: 8, cores: 8, floatTargets: true };
const phone = { coarse: true, dpr: 3, memory: 6, cores: 8, floatTargets: true };
const oldPhone = { coarse: true, dpr: 2, memory: 2, cores: 4, floatTargets: true };

test('Auto picks a tier from the device, never above one it dropped to', () => {
  assert.equal(autoTier(desktop), 'high');
  assert.equal(autoTier(phone), 'medium');
  assert.equal(autoTier(oldPhone), 'low');
  assert.equal(autoTier({ ...phone, memory: undefined }), 'medium', 'an iPhone: Safari tells nothing of memory');
  assert.equal(autoTier({ ...phone, memory: undefined, cores: 2 }), 'medium', 'nor the real core count');
  assert.equal(autoTier({ ...desktop, floatTargets: false }), 'low', 'no half-float targets: no post-processing');
  assert.equal(autoTier({ ...desktop, remembered: 'medium' }), 'medium');
  assert.equal(autoTier({ ...oldPhone, remembered: 'high' }), 'low', 'a remembered tier only lowers');
  assert.equal(autoTier({ ...desktop, remembered: 'nonsense' }), 'high');
});

test('a setting runs at its tier; unknown settings are Auto', () => {
  assert.equal(readSetting('medium'), 'medium');
  assert.equal(readSetting(null), 'auto');
  assert.equal(readSetting('ultra'), 'auto');
  assert.equal(tierFor('auto', phone), 'medium');
  assert.equal(tierFor('high', oldPhone), 'high', 'a manual choice is kept');
  assert.equal(tierFor('high', { ...desktop, floatTargets: false }), 'low');
  assert.equal(pixelRatio('high', 3), TIERS.high.maxRatio);
  assert.equal(pixelRatio('low', 2), 1);
  assert.equal(pixelRatio('medium', 1), 1);
  assert.equal(pixelRatio('high', 2, 0.6), 1.2);
});

const feed = (g, ms, n) => {
  const out = [];
  for (let k = 0; k < n; k++) {
    const r = g.frame(typeof ms === 'function' ? ms(g.scale) : ms);
    if (r) out.push(r);
  }
  return out;
};
// a GPU-bound frame: its time goes with the pixels drawn (the scale squared)
const gpu = (base) => (scale) => base * scale * scale;

test('the governor scales down when the GPU is slow, then drops a tier; one slow frame is nothing', () => {
  const g = createGovernor({ window: 10, grace: 0 });
  // fast frames with a spike now and then: nothing to do
  for (let k = 0; k < 20; k++) assert.equal(g.frame(k % 10 === 3 ? 80 : 16.7), null);
  // a little too slow: down until it's quick enough, then it stays
  feed(g, gpu(30), 100);
  assert.ok(g.scale < 1 && 30 * g.scale * g.scale <= 22, `scaled to ${g.scale}`);
  // far too slow: down step by step to the minimum, then a drop
  const g2 = createGovernor({ window: 10, grace: 0 });
  const out = feed(g2, gpu(90), 200);
  const scales = out.filter((r) => r.scale).map((r) => r.scale);
  assert.ok(scales.length >= 2 && scales.every((s, k) => k === 0 || s < scales[k - 1]), `down: ${scales}`);
  assert.ok(Math.abs(scales.at(-1) - 0.6) < 1e-9, 'not below 60 %');
  assert.ok(out.some((r) => r.drop), 'then the next tier down');
  // a hidden tab (huge gaps) is not slowness
  const g3 = createGovernor({ window: 10, grace: 0 });
  assert.deepEqual(feed(g3, 2000, 50), []);
});

test('a frame-rate cap (Low Power Mode: 30 fps whatever is drawn) is left alone', () => {
  const g = createGovernor({ window: 10, grace: 0 });
  const out = feed(g, 33.3, 400);
  // one step down to see, then straight back, and nothing after that
  assert.deepEqual(out.map((r) => r.scale ?? 'drop'), [0.85, 1]);
  assert.equal(g.scale, 1);
  // but a real slowdown on top of the cap still counts
  const more = feed(g, gpu(60), 60);
  assert.ok(more.length > 0 && g.scale < 1, 'much slower than the cap: scales down');
});

test('the governor tries a bigger scale when fast, and backs off for a while if that is too slow', () => {
  const g = createGovernor({ window: 10, grace: 0 });
  feed(g, gpu(40), 40);
  const low = g.scale;
  assert.ok(low < 1);
  // smooth again: after a few calm windows, one step up
  const up = feed(g, 16, 50).filter((r) => r.scale);
  assert.ok(up.length >= 1 && up[0].scale > low, 'a step up');
  const tried = g.scale;
  // too slow at that size: straight back down, and no new try above it for a good while
  const back = feed(g, 30, 10);
  assert.ok(back[0].scale < tried);
  const later = feed(g, 16, 10 * 30).filter((r) => r.scale);
  assert.ok(later.every((r) => r.scale < tried - 1e-9), `stays below ${tried}: ${later.map((r) => r.scale)}`);
  g.reset();
  assert.equal(g.scale, 1);
});
