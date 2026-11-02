// Contact shadows: open snow stays open, hollows and the feet of bumps darken, trees and
// rocks get a soft disc

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield } from '../src/core/heightfield.js';
import { occlusion } from '../src/core/occlusion.js';

const field = (fn) => {
  const hf = new Heightfield(120, 120, 1.5);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.h[j * hf.nx + i] = fn(-hf.halfX + i * hf.cell, -hf.halfZ + j * hf.cell);
  return hf;
};
const at = (hf, out, x, z) => out[Math.round((z + hf.halfZ) / hf.cell) * hf.nx + Math.round((x + hf.halfX) / hf.cell)];

test('a plain slope, however steep, is open sky', () => {
  const hf = field((x, z) => -0.6 * z + 0.1 * x);
  const out = occlusion(hf, [], new Uint8Array(hf.nx * hf.nz));
  assert.ok(Math.max(...out) <= 1, `max ${Math.max(...out)}`);
});

test('a pit and the foot of a raised block darken; the top of the block stays open', () => {
  const hf = field((x, z) => -0.3 * z + (Math.hypot(x - 20, z) < 4 ? -2 : 0) + (Math.abs(x + 20) < 6 && Math.abs(z) < 6 ? 3 : 0));
  const out = occlusion(hf, [], new Uint8Array(hf.nx * hf.nz));
  assert.ok(at(hf, out, 20, 0) > 100, `the pit: ${at(hf, out, 20, 0)}`);
  assert.ok(at(hf, out, -20 + 7.5, 0) > 40, `by the block's foot: ${at(hf, out, -12.5, 0)}`);
  assert.equal(at(hf, out, -20, 0), 0, 'on top of the block');
  assert.equal(at(hf, out, 0, 40), 0, 'far from both');
});

test('a tree darkens a soft disc round its base, strongest in the middle', () => {
  const hf = field(() => 0);
  const out = occlusion(hf, [{ x: 0, z: 0, r: 3, a: 0.5 }], new Uint8Array(hf.nx * hf.nz));
  const mid = at(hf, out, 0, 0);
  const side = at(hf, out, 1.5, 0);
  assert.ok(mid > 100 && mid <= 128, `middle ${mid}`);
  assert.ok(side > 0 && side < mid, `towards the edge ${side}`);
  assert.equal(at(hf, out, 4.5, 0), 0, 'outside the disc');
});
