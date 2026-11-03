// The ranges round the mountain (render/panorama.js): out of the clouds, taller further off

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peakHeight } from '../src/render/panorama.js';

const ring = (r) => {
  const hs = [];
  for (let a = 0; a < 360; a += 3) hs.push(peakHeight(Math.cos((a * Math.PI) / 180) * r, Math.sin((a * Math.PI) / 180) * r));
  return { max: Math.max(...hs), mean: hs.reduce((s, h) => s + h, 0) / hs.length };
};

test('the peaks rise out of the clouds past the inner edge and sink back at the far one', () => {
  assert.ok(ring(3600).max < 0, 'the inner edge is under the clouds');
  assert.ok(ring(13000).max < 0, 'and the outer one');
  assert.ok(ring(8000).max > 400, `peaks up out of them (${ring(8000).max.toFixed(0)} m)`);
});

test('the further rows stand taller, so they show over the nearer ones, but never tower', () => {
  assert.ok(ring(9500).mean > ring(5000).mean, `${ring(9500).mean.toFixed(0)} vs ${ring(5000).mean.toFixed(0)} m`);
  for (const r of [4500, 6000, 8000, 10000, 12000]) assert.ok(ring(r).max < 1700, `${r} m out: ${ring(r).max.toFixed(0)} m`);
});

test('the same mountains every time', () => {
  assert.equal(peakHeight(4321, -6789), peakHeight(4321, -6789));
});
