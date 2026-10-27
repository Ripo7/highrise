// The run editor's model: sections -> mountain, elements, snow types, structures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield } from '../src/core/heightfield.js';
import { Skier } from '../src/core/skier.js';
import { ScoreKeeper, GATE_POINTS } from '../src/core/score.js';
import { SurfaceMap } from '../src/core/surface.js';
import { StructureSet } from '../src/core/structures.js';
import { PropSet, TREE } from '../src/core/props.js';
import { buildRun } from '../src/core/build.js';
import { ELEMENTS, CATEGORIES } from '../src/core/elements.js';
import {
  TEMPLATES,
  templateRun,
  newSection,
  normalizeSection,
  runLength,
  runStats,
  runGeometry,
  sampleAt,
  packRun,
  unpackRun,
  profileToRun,
  CELL_M,
} from '../src/core/run.js';
import { PROFILE_STEP } from '../src/core/profile.js';

const DT = 1 / 240;

function world(run) {
  const hf = new Heightfield();
  const surf = new SurfaceMap();
  const built = buildRun(hf, surf, run);
  const props = new PropSet(hf);
  props.set(built.props);
  const structs = new StructureSet(hf);
  structs.set(built.structs);
  return { hf, surf, props, structs, built };
}

function skierOn(w) {
  const s = new Skier(w.hf, w.built.start);
  s.props = w.props;
  s.structures = w.structs;
  s.surface = w.surf;
  return s;
}

// steer towards a column of the piste a little way ahead (0 = the middle)
function followLane(w, column = 0) {
  const geo = w.built.geo;
  return (s) => {
    const u = s.pos[2] - w.hf.startZ;
    const target = sampleAt(geo.xc, Math.min(geo.L, Math.max(0, u + 20))) + column * CELL_M;
    const want = Math.max(-15, Math.min(15, (target - s.pos[0]) * 0.9));
    s.input.steer = Math.max(-1, Math.min(1, -(want - s.vel[0]) * 0.5));
  };
}

function ride(w, control = () => {}, maxTime = 300) {
  const s = skierOn(w);
  const score = new ScoreKeeper();
  while (s.status === 'running' && s.time < maxTime) {
    control(s);
    s.step(DT);
    score.update(s, DT);
  }
  score.finish(s);
  return { s, score };
}

const oneSection = (o) => ({ sections: [newSection({ slope: 6, length: 40, width: 60 }), newSection({ slope: 20, length: 200, width: 60, ...o })] });

test('every element has a category and footprint rows for each size', () => {
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const [id, el] of Object.entries(ELEMENTS)) {
    assert.ok(cats.has(el.cat), `${id} category`);
    assert.equal(el.rows.length, 3, `${id} rows`);
  }
});

for (const t of TEMPLATES) {
  test(`template "${t.name}" builds a run of the right length and finishes`, () => {
    const run = templateRun(t.id);
    const st = runStats(run);
    assert.ok(st.ok, st.reason);
    const w = world(run);
    assert.ok(Math.abs(w.hf.finishZ - w.hf.startZ - runLength(run)) < w.hf.cell + 0.5, 'finish line at the end of the run');
    const { s } = ride(w, followLane(w));
    assert.equal(s.status, 'finished', `${t.id} ended ${s.status} ${(s.pos[2] - w.hf.startZ).toFixed(0)} m down`);
    if (t.id !== 'freeride') assert.equal(s.wipeouts, 0, `${t.id}: no wipeouts following the piste`);
  });
}

test('the starter run has jumps and a gate, and a lane-following rider scores them', () => {
  const w = world(templateRun('starter'));
  const { s, score } = ride(w, followLane(w));
  assert.ok(s.jumps >= 1, `jumps ${s.jumps}`);
  assert.equal(s.gatesPassed, 1);
  assert.ok(score.total > GATE_POINTS, `score ${score.total}`);
});

test('the piste is groomed, the snow beside it is powder, and no forest grows on the piste', () => {
  const run = oneSection({ width: 40, forest: 2 });
  const w = world(run);
  const z = w.hf.startZ + 150;
  const xc = sampleAt(w.built.geo.xc, 150);
  assert.ok(w.surf.at(xc, z).g > 0.95, 'groomed in the middle');
  assert.ok(w.surf.at(xc + 60, z).powder > 0.95, 'powder 60 m off');
  const onPiste = w.props.list.filter((p) => Math.abs(p.x - sampleAt(w.built.geo.xc, p.u)) < 20 && p.u > 0);
  assert.equal(onPiste.length, 0, 'no trees on the groomed piste');
  assert.ok(w.props.list.filter((p) => p.k === TREE).length > 200, 'dense forest outside');
});

test('deep powder is slower than the groomed piste', () => {
  const run = oneSection({ slope: 22, length: 300 });
  const a = world(run);
  const b = world(run);
  b.surf.g.fill(0); // all powder
  const ra = skierOn(a);
  const rb = skierOn(b);
  for (let k = 0; k < 240 * 12; k++) {
    ra.step(DT);
    rb.step(DT);
  }
  assert.ok(rb.speed < ra.speed * 0.8, `powder ${(rb.speed * 3.6).toFixed(0)} vs groomed ${(ra.speed * 3.6).toFixed(0)} km/h`);
  assert.ok(rb.sink > 0.1, 'the skis sink into powder');
  assert.ok(ra.sink < 0.02, 'but not on the piste');
});

test('a frozen lake is ice: slick and almost frictionless', () => {
  const w = world(oneSection({ cells: [{ r: 2, c: 3, k: 'lake', s: 2 }] }));
  const z = w.hf.startZ + 40 + 2 * CELL_M + 20;
  const x = sampleAt(w.built.geo.xc, 100);
  assert.ok(w.surf.at(x, z).ice > 0.9, 'ice in the middle of the lake');
});

test('a hands-off rider lined up with a box grinds it', () => {
  const w = world(oneSection({ slope: 16, cells: [{ r: 2, c: 3, k: 'box', s: 1 }] }));
  const { s, score } = ride(w);
  assert.ok(s.grinds >= 1, `grinds ${s.grinds}`);
  assert.ok(score.tricks.some((t) => /Box/.test(t.name)), score.tricks.map((t) => t.name).join(', '));
  assert.equal(s.wipeouts, 0);
});

test('a rail grind on a lined-up run, and steering on it turns it into a slide', () => {
  const w = world(oneSection({ slope: 16, cells: [{ r: 2, c: 3, k: 'rail', s: 2 }] }));
  const { s, score } = ride(w, (sk) => {
    sk.input.steer = sk.grind && sk.grind.time < 0.25 ? 1 : 0;
  });
  assert.ok(s.grinds >= 1, `grinds ${s.grinds}`);
  assert.ok(score.tricks.some((t) => /Rail Slide/.test(t.name)), score.tricks.map((t) => t.name).join(', '));
});

test('riding through a slalom gate scores it once', () => {
  const w = world(oneSection({ cells: [{ r: 3, c: 3, k: 'gate', s: 1 }] }));
  const { s, score } = ride(w);
  assert.equal(s.gatesPassed, 1);
  assert.ok(score.total >= GATE_POINTS);
});

test('riding straight into a chalet knocks you down', () => {
  const w = world(oneSection({ slope: 24, cells: [{ r: 4, c: 3, k: 'chalet', s: 2 }] }));
  const { s } = ride(w);
  assert.ok(
    s.events.some((e) => e.type === 'wipeout' && e.reason === 'wall'),
    s.events.filter((e) => e.type === 'wipeout' || e.type === 'bump').map((e) => e.reason || e.what).join(',')
  );
});

test('a tunnel is ridden through without a crash, under its roof', () => {
  const w = world(oneSection({ slope: 18, cells: [{ r: 3, c: 3, k: 'tunnel', s: 2 }] }));
  const s = skierOn(w);
  const t = w.structs.tunnels[0];
  let inside = 0;
  let maxAbove = 0;
  while (s.status === 'running') {
    s.step(DT);
    const la = (s.pos[0] - t.x) * t.dx + (s.pos[2] - t.z) * t.dz;
    if (la > 1 && la < t.L - 1) {
      inside++;
      maxAbove = Math.max(maxAbove, s.pos[1] - w.hf.heightAt(s.pos[0], s.pos[2]));
    }
  }
  assert.equal(s.status, 'finished');
  assert.equal(s.wipeouts, 0);
  assert.ok(inside > 10, 'went through it');
  assert.ok(maxAbove < t.ht, `stayed under the roof (${maxAbove.toFixed(2)} m)`);
});

test('a safety net catches a skier who rides into it', () => {
  const w = world(oneSection({ slope: 20, width: 100, cells: [{ r: 2, c: 2, k: 'net', s: 2 }] }));
  const net = w.built.structs.find((s) => s.type === 'net');
  const s = skierOn(w);
  let hit = null;
  while (s.status === 'running' && s.time < 40 && !hit) {
    // ride down beside the net, then carve across it
    const u = s.pos[2] - w.hf.startZ;
    const target = u < 95 ? net.x + 5 : net.x - 10;
    const want = Math.max(-10, Math.min(10, (target - s.pos[0]) * 0.9));
    s.input.steer = Math.max(-1, Math.min(1, -(want - s.vel[0]) * 0.5));
    const before = s.speed;
    s.step(DT);
    if (s.events.some((e) => e.what === 'net')) hit = { before, after: s.speed };
  }
  assert.ok(hit, 'reached the net');
  assert.ok(hit.after < hit.before * 0.6, `slowed from ${hit.before.toFixed(1)} to ${hit.after.toFixed(1)} m/s`);
});

test('elements follow the piste when it bends', () => {
  const run = { sections: [newSection({ slope: 15, length: 40 }), newSection({ slope: 20, length: 200, bend: 80, cells: [{ r: 8, c: 5, k: 'lift', s: 1 }] })] };
  const w = world(run);
  const pylon = w.built.structs.find((s) => s.type === 'pylon');
  const u = pylon.z - w.hf.startZ;
  const xc = sampleAt(w.built.geo.xc, u);
  assert.ok(xc > 60, `the piste moved over (${xc.toFixed(0)} m)`);
  assert.ok(Math.abs(pylon.x - (xc + 2 * CELL_M)) < 3, `pylon two columns right of the piste centre (${pylon.x.toFixed(1)} vs ${(xc + 40).toFixed(1)})`);
});

test('section slopes give the run its profile; joints are eased', () => {
  const run = { sections: [newSection({ slope: 10, length: 100 }), newSection({ slope: 35, length: 100 })] };
  const geo = runGeometry(run);
  const deg = (u) => (Math.atan2(sampleAt(geo.e, u - 2) - sampleAt(geo.e, u + 2), 4) * 180) / Math.PI;
  assert.ok(Math.abs(deg(50) - 10) < 0.5, `first section ${deg(50).toFixed(1)}°`);
  assert.ok(Math.abs(deg(160) - 35) < 0.5, `second section ${deg(160).toFixed(1)}°`);
  const mid = deg(100);
  assert.ok(mid > 14 && mid < 31, `eased joint ${mid.toFixed(1)}°`);
});

test('runs save and load exactly', () => {
  const run = templateRun('park');
  const back = unpackRun(JSON.parse(JSON.stringify(packRun(run))));
  assert.deepEqual(back, run);
});

test('values snap to their steps and limits', () => {
  const s = normalizeSection({ slope: 80.4, length: 33, width: 7, bend: 333, waves: 9, forest: -2, cells: [{ r: 0, c: 9, k: 'kicker' }] });
  assert.equal(s.slope, 55);
  assert.equal(s.length, 40);
  assert.equal(s.width, 20);
  assert.equal(s.bend, 100);
  assert.equal(s.waves, 3);
  assert.equal(s.forest, 0);
  assert.equal(s.cells.length, 0, 'out-of-grid cell dropped');
});

test('an old drawn profile turns into sections of the same shape', () => {
  const e = [];
  for (let u = 0; u <= 800; u += PROFILE_STEP) e.push(u < 300 ? -u * Math.tan(0.25) : -300 * Math.tan(0.25) - (u - 300) * Math.tan(0.5));
  const run = profileToRun(e);
  assert.ok(Math.abs(runLength(run) - 800) <= 40, `length ${runLength(run)}`);
  assert.ok(run.sections.length >= 2 && run.sections.length <= 6, `${run.sections.length} sections`);
  const st = runStats(run);
  const drop = 300 * Math.tan(0.25) + 500 * Math.tan(0.5);
  assert.ok(Math.abs(st.drop - drop) / drop < 0.08, `drop ${st.drop.toFixed(0)} vs ${drop.toFixed(0)}`);
});

test('a 4 km run with many elements builds quickly and stays light', () => {
  const sections = [];
  const kinds = Object.keys(ELEMENTS);
  for (let i = 0; i < 14; i++) {
    sections.push(
      newSection({
        slope: 15 + (i % 4) * 6,
        length: 280,
        bend: i % 2 ? 40 : -40,
        waves: i % 4,
        forest: i % 3,
        cells: [0, 3, 6, 9, 12].map((r, k) => ({ r, c: (i + k) % 7, k: kinds[(i * 5 + k) % kinds.length], s: k % 3 })),
      })
    );
  }
  const run = { sections };
  const t0 = performance.now();
  const w = world(run);
  const ms = performance.now() - t0;
  assert.ok(ms < 4000, `built in ${ms.toFixed(0)} ms`);
  assert.ok(w.hf.nx * w.hf.nz <= 450000, `${w.hf.nx * w.hf.nz} vertices`);
  assert.ok(w.props.list.length < 9000, `${w.props.list.length} trees and rocks`);
});
