// Ready-made mountains and building pieces: placing, merging, building, riding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield } from '../src/core/heightfield.js';
import { Skier } from '../src/core/skier.js';
import { ScoreKeeper } from '../src/core/score.js';
import { SurfaceMap } from '../src/core/surface.js';
import { StructureSet } from '../src/core/structures.js';
import { PropSet, TREE } from '../src/core/props.js';
import { newMountain, buildBase, mountainLength, sampleAt, TILE, GRID_X0, SLOPES, LENGTHS } from '../src/core/mountain.js';
import { buildWorld, starterPieces } from '../src/core/world.js';
import {
  PIECES,
  CATEGORIES,
  placePieces,
  erasePieces,
  rowPieces,
  groupUnits,
  packPieces,
  unpackPieces,
  gridRows,
  tileOf,
} from '../src/core/pieces.js';
import { profileStats } from '../src/core/profile.js';

const DT = 1 / 240;

function world(m = newMountain('medium', 'short', 42), pieces = []) {
  const hf = new Heightfield();
  const surf = new SurfaceMap();
  const base = buildBase(hf, surf, m);
  const built = buildWorld(hf, surf, base, pieces);
  const props = new PropSet(hf);
  props.set(built.props);
  const structs = new StructureSet(hf);
  structs.set(built.structs);
  return { hf, surf, base, props, structs, built, pieces };
}

function rider(w) {
  const s = new Skier(w.hf, w.base.start);
  s.props = w.props;
  s.structures = w.structs;
  s.surface = w.surf;
  return s;
}

// steer along the piste centre (plus an offset)
function follow(w, off = 0) {
  return (s) => {
    const u = s.pos[2] - w.hf.startZ;
    const target = sampleAt(w.base.lane.xc, Math.min(w.base.L, Math.max(0, u + 20))) + off;
    const want = Math.max(-15, Math.min(15, (target - s.pos[0]) * 0.9));
    s.input.steer = Math.max(-1, Math.min(1, -(want - s.vel[0]) * 0.5));
  };
}

function ride(w, control = () => {}, maxTime = 200) {
  const s = rider(w);
  const score = new ScoreKeeper();
  while (s.status === 'running' && s.time < maxTime) {
    control(s);
    s.step(DT);
    score.update(s, DT);
  }
  score.finish(s);
  return { s, score };
}

// the tile column under the piste centre at u metres down
const laneCol = (base, u) => tileOf(sampleAt(base.lane.xc, u), u).i;

test('every piece has a known category and merge rule', () => {
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const [k, p] of Object.entries(PIECES)) {
    assert.ok(cats.has(p.cat), k);
    assert.ok(['field', 'across', 'along', 'rect', 'none'].includes(p.merge), k);
  }
});

for (const sl of SLOPES) {
  for (const len of LENGTHS) {
    test(`a ${sl.label.toLowerCase()} ${len.label.toLowerCase()} mountain is skiable down its piste`, () => {
      const w = world(newMountain(sl.id, len.id, 7));
      const st = profileStats(w.base.e);
      assert.ok(Math.abs(st.length - len.m) < 8, `length ${st.length}`);
      assert.ok(Math.abs(st.avgDeg - sl.deg) < sl.deg * 0.3, `average ${st.avgDeg.toFixed(1)}° for ${sl.deg}°`);
      const { s } = ride(w, follow(w));
      assert.equal(s.status, 'finished', `ended ${s.status} ${(s.pos[2] - w.hf.startZ).toFixed(0)} m down`);
      assert.equal(s.wipeouts, 0);
    });
  }
}

test('the base mountain has a groomed piste with forest beside it, not on it', () => {
  const w = world(newMountain('medium', 'medium', 3));
  const u = 300;
  const xc = sampleAt(w.base.lane.xc, u);
  assert.ok(w.surf.at(xc, w.hf.startZ + u).g > 0.95);
  assert.ok(w.surf.at(xc + 90, w.hf.startZ + u).powder > 0.95);
  const onPiste = w.props.list.filter((p) => Math.abs(p.x - sampleAt(w.base.lane.xc, p.u)) < 20);
  assert.equal(onPiste.length, 0);
  assert.ok(w.props.list.filter((p) => p.k === TREE).length > 300);
});

test('placing over a piece on the same layer replaces it; other layers stack', () => {
  let ps = placePieces([], [{ k: 'kicker', i: 10, j: 5 }], 50);
  ps = placePieces(ps, [{ k: 'mound', i: 10, j: 6 }], 50);
  assert.equal(ps.length, 2, 'a mound under a kicker is fine');
  ps = placePieces(ps, [{ k: 'rail', i: 10, j: 6 }], 50);
  assert.deepEqual(ps.map((p) => p.k).sort(), ['mound', 'rail'], 'the rail replaced the kicker it overlaps');
  ps = erasePieces(ps, [[10, 6]]);
  assert.equal(ps.length, 0, 'the eraser clears every layer');
  assert.equal(placePieces([], [{ k: 'kicker', i: 10, j: 49 }], 50).length, 0, 'a kicker hanging off the bottom is refused');
});

test('dragging places a straight row, jumps spaced for a landing', () => {
  const across = rowPieces('kicker', { i: 10, j: 5 }, { i: 13, j: 6 });
  assert.deepEqual(across.map((p) => [p.i, p.j]), [[10, 5], [11, 5], [12, 5], [13, 5]]);
  const down = rowPieces('kicker', { i: 10, j: 5 }, { i: 10, j: 16 });
  assert.deepEqual(down.map((p) => p.j), [5, 10, 15], 'two tiles of kicker, three of landing');
  const rail = rowPieces('rail', { i: 10, j: 5 }, { i: 10, j: 8 });
  assert.deepEqual(rail.map((p) => p.j), [5, 6, 7, 8], 'rails end to end');
});

test('neighbours merge by their rule', () => {
  const kinds = (ps) => groupUnits(ps).map((u) => `${u.k}:${u.cols}x${u.rows}`).sort();
  // kickers side by side become one wide kicker; one below another stays separate
  assert.deepEqual(kinds([{ k: 'kicker', i: 1, j: 0 }, { k: 'kicker', i: 2, j: 0 }, { k: 'kicker', i: 3, j: 0 }]), ['kicker:3x2']);
  assert.deepEqual(kinds([{ k: 'kicker', i: 1, j: 0 }, { k: 'kicker', i: 1, j: 2 }]), ['kicker:1x2', 'kicker:1x2']);
  // rails end to end become one long rail; side by side they stay two
  assert.deepEqual(kinds([{ k: 'rail', i: 1, j: 0 }, { k: 'rail', i: 1, j: 1 }, { k: 'rail', i: 1, j: 2 }]), ['rail:1x3']);
  assert.deepEqual(kinds([{ k: 'rail', i: 1, j: 0 }, { k: 'rail', i: 2, j: 0 }]), ['rail:1x1', 'rail:1x1']);
  // a filled rectangle of chalets is one building; an L shape stays separate
  assert.deepEqual(kinds([0, 1].flatMap((i) => [0, 1].map((j) => ({ k: 'chalet', i, j })))), ['chalet:2x2']);
  assert.equal(groupUnits([{ k: 'chalet', i: 0, j: 0 }, { k: 'chalet', i: 1, j: 0 }, { k: 'chalet', i: 0, j: 1 }]).length, 3);
  // painted trees join into one forest, whatever the shape
  assert.deepEqual(kinds([{ k: 'trees', i: 0, j: 0 }, { k: 'trees', i: 1, j: 0 }, { k: 'trees', i: 1, j: 1 }]), ['trees:2x2']);
  // nets: rotated across, a row joins up
  assert.deepEqual(kinds([{ k: 'net', i: 0, j: 0, r: 1 }, { k: 'net', i: 1, j: 0, r: 1 }]), ['net:2x1']);
});

test('a wide kicker on the piste launches the rider into a clean jump', () => {
  const m = newMountain('medium', 'short', 11);
  const probe = world(m);
  const c = laneCol(probe.base, 150);
  const w = world(m, [{ k: 'kicker', i: c - 1, j: 15 }, { k: 'kicker', i: c, j: 15 }, { k: 'kicker', i: c + 1, j: 15 }]);
  const { s } = ride(w, follow(w, GRID_X0 + (c + 0.5) * TILE - sampleAt(w.base.lane.xc, 150)));
  assert.ok(s.jumps >= 1, `jumps ${s.jumps}`);
  assert.equal(s.wipeouts, 0);
});

test('rails end to end make one long grind', () => {
  const m = newMountain('gentle', 'short', 5);
  const probe = world(m);
  const c = laneCol(probe.base, 100);
  const x = GRID_X0 + (c + 0.5) * TILE;
  const w = world(m, [10, 11, 12].map((j) => ({ k: 'box', i: c, j })));
  assert.equal(w.structs.rails.length, 1, 'one box');
  assert.ok(w.structs.rails[0].len > 25, `${w.structs.rails[0].len.toFixed(1)} m long`);
  const { s, score } = ride(w, (sk) => {
    const want = Math.max(-10, Math.min(10, (x - sk.pos[0]) * 0.9));
    sk.input.steer = sk.grind ? 0 : Math.max(-1, Math.min(1, -(want - sk.vel[0]) * 0.5));
  });
  assert.ok(s.grinds >= 1, `grinds ${s.grinds}`);
  const g = s.events.find((e) => e.type === 'grind');
  assert.ok(g.dist > 20, `ground ${g.dist.toFixed(1)} m`);
  assert.ok(score.tricks.some((t) => /Box/.test(t.name)));
});

test('terrain pieces shape the snow: mounds rise, hollows dip, flats level out, drops make a wall', () => {
  const m = newMountain('medium', 'short', 9);
  const plain = world(m);
  const h0 = (i, j) => plain.hf.heightAt(GRID_X0 + (i + 0.5) * TILE, plain.hf.startZ + (j + 0.5) * TILE);
  const w = world(m, [
    { k: 'mound', i: 5, j: 10 },
    { k: 'hollow', i: 40, j: 10 },
    ...[0, 1, 2].map((d) => ({ k: 'flat', i: 8 + d, j: 25 })),
    { k: 'drop', i: 38, j: 30 },
  ]);
  const h = (i, j, du = 5) => w.hf.heightAt(GRID_X0 + (i + 0.5) * TILE, w.hf.startZ + j * TILE + du);
  assert.ok(h(5, 10) - h0(5, 10) > 1.5, 'mound');
  assert.ok(h(40, 10) - h0(40, 10) < -1.5, 'hollow');
  assert.ok(Math.abs(h(9, 25, 1) - h(9, 25, 9)) < 0.3, 'flat along the slope');
  assert.ok(h(38, 30, 8.5) - h(38, 30, 10.5) > 3, 'drop wall');
});

test('groom and powder paint the surface', () => {
  const m = newMountain('medium', 'short', 9);
  const w = world(m, [{ k: 'groom', i: 3, j: 20 }, { k: 'powder', i: laneCol(world(m).base, 205), j: 20 }]);
  assert.ok(w.surf.at(GRID_X0 + 3.5 * TILE, w.hf.startZ + 205).g > 0.95, 'groomed off-piste');
  assert.ok(w.surf.at(GRID_X0 + (laneCol(w.base, 205) + 0.5) * TILE, w.hf.startZ + 205).powder > 0.95, 'powder on the piste');
});

test('the base forest clears out of pieces and their landings', () => {
  const m = newMountain('medium', 'short', 4);
  const w = world(m, [{ k: 'kicker', i: 4, j: 20 }]);
  const x0 = GRID_X0 + 4 * TILE;
  const inside = w.props.list.filter((p) => p.x > x0 - 3 && p.x < x0 + TILE + 3 && p.u > 200 && p.u < 260);
  assert.equal(inside.length, 0);
});

test('the starter pieces build and the run is still skiable', () => {
  const m = newMountain('medium', 'medium', 21);
  const probe = world(m);
  const w = world(m, starterPieces(probe.base));
  assert.ok(w.structs.count >= 5, `${w.structs.count} structures`);
  const { s } = ride(w, follow(w));
  assert.equal(s.status, 'finished');
});

test('pieces save and load exactly', () => {
  const ps = [{ k: 'kicker', i: 3, j: 4, r: 0 }, { k: 'net', i: 9, j: 2, r: 1 }, { k: 'groom', i: 0, j: 0, r: 0 }];
  assert.deepEqual(unpackPieces(JSON.parse(JSON.stringify(packPieces(ps)))), ps);
});

test('an old drawn run becomes the mountain as drawn', () => {
  const e = [];
  for (let u = 0; u <= 800; u += 4) e.push(-u * 0.4);
  const m = { profile: e, seed: 1 };
  assert.equal(mountainLength(m), 800);
  const w = world(m);
  assert.equal(gridRows(w.base.L), 80);
  const { s } = ride(w, follow(w));
  assert.equal(s.status, 'finished');
});

test('rebuilding a long mountain full of pieces is quick', () => {
  const m = newMountain('steep', 'long', 2);
  const probe = world(m);
  const kinds = Object.keys(PIECES);
  const ps = [];
  for (let n = 0; n < 400; n++) ps.push({ k: kinds[n % kinds.length], i: (n * 7) % 46, j: (n * 13) % 140, r: n % 2 });
  const placed = placePieces([], ps, gridRows(probe.base.L));
  const t0 = performance.now();
  const w = world(m, placed);
  void w;
  const ms = performance.now() - t0;
  assert.ok(ms < 3000, `built in ${ms.toFixed(0)} ms`);
});
