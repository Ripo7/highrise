// Saves from the section editor (v5) load as a mountain with pieces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield } from '../src/core/heightfield.js';
import { SurfaceMap } from '../src/core/surface.js';
import { StructureSet } from '../src/core/structures.js';
import { buildBase, sampleAt, TILE, GRID_X0 } from '../src/core/mountain.js';
import { buildWorld } from '../src/core/world.js';
import { gridRows } from '../src/core/pieces.js';
import { v5Profile, v5Pieces } from '../src/core/legacy.js';

// [id, slope, length, width, bend, waves, forest, cells[[row, col, kind, size]]]
const RUN = [
  ['a', 12, 100, 60, 0, 0, 1, [[1, 3, 'kicker', 1]]],
  ['b', 24, 200, 60, 20, 2, 1, [[0, 1, 'trees', 0], [2, 3, 'box', 2], [4, 5, 'cliff', 0], [3, 0, 'chalet', 2]]],
  ['c', 8, 120, 60, 0, 0, 0, [[1, 3, 'gate', 0], [0, 2, 'nonsense', 0]]],
];

test('v5 sections become a descending profile of the same length', () => {
  const e = v5Profile(RUN);
  assert.ok(e);
  assert.equal((e.length - 1) * 4, 420);
  assert.ok(e[e.length - 1] < -80, `drops (${e[e.length - 1].toFixed(0)} m)`);
  // the second section is steeper than the first
  const d1 = e[10] - e[20];
  const d2 = e[40] - e[50];
  assert.ok(d2 > d1, 'steeper in the middle');
  assert.equal(v5Profile([]), null);
  assert.equal(v5Profile('junk'), null);
});

test('v5 elements become pieces where the cells were, unknown kinds dropped', () => {
  const hf = new Heightfield();
  const surf = new SurfaceMap(hf);
  const base = buildBase(hf, surf, { profile: v5Profile(RUN), seed: 1 });
  const pieces = v5Pieces(RUN, base, gridRows(base.L));
  const of = (k) => pieces.filter((p) => p.k === k);
  assert.equal(of('kicker').length, 2, 'a kicker two tiles wide');
  assert.equal(of('trees').length, 4, 'trees fill the old 20 m cell');
  assert.equal(of('box').length, 4, 'a large box runs over two old rows');
  assert.ok(of('drop').length >= 1, 'a cliff becomes a drop');
  assert.equal(of('chalet').length, 4, 'a lodge fills 2 × 2 tiles');
  assert.equal(of('gate').length, 1);
  assert.ok(!pieces.some((p) => p.k === 'nonsense'));
  // the kicker sits in the middle column, 20 m into the run
  assert.ok(of('kicker').every((p) => p.j === 2));
  const i = Math.min(...of('kicker').map((p) => p.i));
  const xc = sampleAt(base.lane.xc, 30);
  assert.ok(Math.abs(GRID_X0 + (i + 1) * TILE - xc) <= 10, 'kicker on the piste');
  // and the whole thing builds
  const structs = new StructureSet(hf);
  const built = buildWorld(hf, surf, base, pieces);
  structs.set(built.structs);
  assert.equal(structs.list.filter((s) => s.type === 'rail' && s.box).length, 1, 'one merged box');
});
