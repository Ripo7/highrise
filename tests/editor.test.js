// The editing tools: picking a piece of what you built, the slope's joints dragged in 3D,
// projects saved under a name

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield, MIN_H, MAX_H } from '../src/core/heightfield.js';
import { SurfaceMap } from '../src/core/surface.js';
import { buildSlope, moveJoint, sectionAt, sectionStarts, profile, elevationAt, templateDesign, normalizeDesign, LIMITS, MAX_LENGTH, TOP } from '../src/core/slopes.js';
import { brushTiles } from '../src/core/terrain.js';
import { applyAction, tileKey } from '../src/core/tiles.js';
import { pieceLayers, allBuilt } from '../src/core/pieces.js';
import { listProjects, saveProject, loadProject, deleteProject, findByName, cleanName } from '../src/projects.js';

const keys = (list) => list.map(([i, j]) => tileKey(i, j)).sort();

test('a double tap picks a piece of what was built: the gate, the jump, the hill, then all of it', () => {
  const hill = brushTiles(10, 20, 2);
  let tiles = applyAction(applyAction([], hill, 'raise'), hill, 'raise');
  const jump = [
    [10, 20],
    [11, 20],
  ];
  tiles = applyAction(tiles, jump, 'jump', { dir: 0 });
  tiles = applyAction(tiles, [[10, 20]], 'gate');
  const wood = [
    [12, 20],
    [13, 20],
  ];
  tiles = applyAction(tiles, wood, 'trees');
  const layers = pieceLayers(tiles, 10, 20);
  assert.deepEqual(
    layers.map((l) => l.kind),
    ['gate', 'jump', 'raise', 'built']
  );
  assert.deepEqual(keys(layers[1].tiles), keys(jump), 'the jump: its group');
  assert.deepEqual(keys(layers[2].tiles), keys(hill), 'the hill: the raised tiles that touch');
  assert.ok(layers[3].tiles.length > hill.length, 'then all that touches, the trees too');
  assert.deepEqual(pieceLayers(tiles, 30, 30), [], 'nothing built there');
  assert.equal(allBuilt(tiles).length, tiles.length);
  // two hills apart are two pieces
  const other = brushTiles(30, 40, 2);
  const two = applyAction(tiles, other, 'raise');
  assert.deepEqual(keys(pieceLayers(two, 30, 40)[0].tiles), keys(other));
});

test('dragging the bottom of a section sets its length and pitch; the ones below keep theirs', () => {
  const d = templateDesign('classic');
  const starts = sectionStarts(d);
  const p = profile(d);
  const k = 1;
  const u0 = starts[k];
  const e0 = elevationAt(p, u0, d);
  // 200 m on, 150 m down: about 37°
  const m = moveJoint(d, k, u0 + 200, e0 - 150);
  assert.equal(m.sections[k].length, 200);
  assert.equal(m.sections[k].slope, Math.round((Math.atan2(150, 200) * 180) / Math.PI));
  for (let i = 0; i < d.sections.length; i++) if (i !== k) assert.deepEqual(m.sections[i], d.sections[i], `section ${i + 1} as it was`);
  assert.deepEqual(d, templateDesign('classic'), 'the design given is left alone');
  // on its steps and in its limits: no shorter than 20 m, no steeper than 50°, no climb over 15°
  const short = moveJoint(d, k, u0 + 3, e0 - 100);
  assert.equal(short.sections[k].length, LIMITS.length.min);
  assert.equal(short.sections[k].slope, LIMITS.slope.max);
  assert.equal(moveJoint(d, k, u0 + 100, e0 + 90).sections[k].slope, LIMITS.slope.min);
  // the whole slope stays under 3 km
  const long = moveJoint(normalizeDesign({ width: 'medium', sections: Array.from({ length: 10 }, () => ({ slope: 20, length: 290 })) }), 0, 5000, -1000);
  assert.ok(long.sections.reduce((s, x) => s + x.length, 0) <= MAX_LENGTH);
  // seen from above (no height): the pitch stays
  assert.equal(moveJoint(d, k, u0 + 300, null).sections[k].slope, d.sections[k].slope);
  // which section is where
  assert.equal(sectionAt(d, 0), 0);
  assert.equal(sectionAt(d, starts[3] + 1), 3);
  assert.equal(sectionAt(d, 1e5), d.sections.length - 1);
});

test('the top of the slope stays put whatever the design, inside the heights a mountain can have', () => {
  for (const sections of [
    [{ slope: 50, length: 400 }, ...Array.from({ length: 7 }, () => ({ slope: 50, length: 370 }))],
    [{ slope: -15, length: 400 }, { slope: -15, length: 400 }, { slope: 5, length: 200 }],
    templateDesign('cruiser').sections,
  ]) {
    const hf = new Heightfield();
    buildSlope(hf, new SurfaceMap(hf), { width: 'narrow', sections });
    assert.ok(Math.abs(hf.heightAt(0, hf.startZ) - TOP) < 0.5, 'the start line at TOP');
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of hf.h) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    assert.ok(lo - 20 > MIN_H && hi + 20 < MAX_H, `heights ${lo.toFixed(0)}..${hi.toFixed(0)} inside the limits, with room to dig and raise`);
  }
});

// a localStorage stand-in
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('projects: saved under a name, the latest first, replaced by name, opened, deleted', () => {
  const store = memory();
  assert.deepEqual(listProjects(store), []);
  const a = saveProject('  Park   run ', { v: 12, n: 1 }, { length: 700 }, store, 1000);
  assert.equal(a.name, 'Park run', 'tidied');
  const b = saveProject('Slalom', { v: 12, n: 2 }, {}, store, 2000);
  assert.deepEqual(
    listProjects(store).map((p) => p.name),
    ['Slalom', 'Park run']
  );
  assert.equal(listProjects(store)[1].summary.length, 700);
  assert.equal(findByName('park RUN', store).id, a.id, 'names match whatever the case');
  // the same name again: the same project, newer
  const a2 = saveProject('park run', { v: 12, n: 3 }, {}, store, 3000);
  assert.equal(a2.id, a.id);
  assert.equal(listProjects(store).length, 2);
  assert.equal(loadProject(a.id, store).data.n, 3);
  deleteProject(b.id, store);
  assert.deepEqual(
    listProjects(store).map((p) => p.name),
    ['park run']
  );
  assert.equal(loadProject(b.id, store), null);
  assert.throws(() => saveProject('   ', {}, {}, store), 'a name is needed');
  assert.equal(cleanName('x'.repeat(80)).length, 40);
  // a broken list doesn't break anything
  store.setItem('highrise.projects.v1', '{nope');
  assert.deepEqual(listProjects(store), []);
});
