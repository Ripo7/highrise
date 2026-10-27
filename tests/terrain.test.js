// Wild mountains, pistes traced through them, terrain pieces that merge, and riding it all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield } from '../src/core/heightfield.js';
import { SurfaceMap } from '../src/core/surface.js';
import { PropSet, TREE } from '../src/core/props.js';
import { Skier } from '../src/core/skier.js';
import { newWild, buildWild, wildDims, makeWild, SIZES, STEEPNESS } from '../src/core/wild.js';
import { sampleCurve, pisteCurves, curveAt, nearestOnCurves, insertIndex, newPiste, suggestPiste, DEFAULT_WIDTH } from '../src/core/piste.js';
import { KINDS, placeTiles, eraseTiles, brushTiles, packTiles, unpackTiles, trimTiles, tileOf, gridCols, gridRows } from '../src/core/terrain.js';
import { buildWorld } from '../src/core/world.js';

const fresh = (size = 'small', steep = 'medium', seed = 7) => {
  const hf = new Heightfield();
  const surf = new SurfaceMap(hf);
  const base = buildWild(hf, surf, newWild(size, steep, seed));
  return { hf, surf, base };
};
const P = (hf, x, u, w = DEFAULT_WIDTH) => ({ x, z: hf.startZ + u, w });
const tileAt = (hf, x, u) => tileOf(hf, x, hf.startZ + u);

// ---------- wild mountains ----------

test('a wild mountain is the same for the same seed, different for another', () => {
  const a = makeWild(newWild('medium', 'medium', 42));
  const b = makeWild(newWild('medium', 'medium', 42));
  const c = makeWild(newWild('medium', 'medium', 43));
  for (const [x, u] of [[0, 100], [-200, 600], [150, 900]]) assert.equal(a.height(x, u), b.height(x, u));
  assert.notEqual(a.height(-200, 600), c.height(-200, 600));
});

test('every mountain goes downhill, steeper ones drop more, and all stay within the vertex budget', () => {
  let lastDrop = 0;
  for (const st of STEEPNESS) {
    const { hf } = fresh('medium', st.id, 3);
    const drop = hf.heightAt(0, hf.startZ) - hf.heightAt(0, hf.finishZ);
    assert.ok(drop > lastDrop, `${st.id} drops ${drop.toFixed(0)} m`);
    lastDrop = drop;
  }
  for (const s of SIZES) {
    const d = wildDims(newWild(s.id, 'medium', 1));
    assert.ok(((d.sizeX / d.cell + 1) * (d.sizeZ / d.cell + 1)) < 470000, `${s.id} fits the budget`);
  }
});

test('the mountain grows a forest below the treeline, with clearings, and rock bands on the steep ones', () => {
  const { hf, base } = fresh('medium', 'steep', 11);
  const trees = base.forest.filter((p) => p.k === TREE);
  assert.ok(trees.length > 1500, `${trees.length} trees`);
  const high = trees.filter((p) => p.u < base.gen.treeline - 80).length / Math.max(1, base.gen.treeline - 80);
  const low = trees.filter((p) => p.u > base.gen.treeline + 150).length / (hf.finishZ - hf.startZ - base.gen.treeline - 150);
  assert.ok(low > high * 2, 'denser below the treeline');
  assert.ok(base.gen.bands.length >= 3, 'rock bands');
  assert.ok(base.rock.some((v) => v > 200), 'bare rock on them');
});

// ---------- pistes ----------

test('the piste curve passes through every waypoint, smoothly', () => {
  const pts = [
    { x: 0, z: 0, w: 36 },
    { x: 40, z: 90, w: 36 },
    { x: -20, z: 200, w: 24 },
    { x: 10, z: 320, w: 52 },
  ];
  const c = sampleCurve(pts);
  for (const q of pts) {
    const d = Math.min(...c.xs.map((x, k) => Math.hypot(x - q.x, c.zs[k] - q.z)));
    assert.ok(d < 0.01, 'through the waypoint');
  }
  // no sample-to-sample jumps, no kinks sharper than the bends drawn
  for (let k = 1; k < c.n; k++) assert.ok(Math.hypot(c.xs[k] - c.xs[k - 1], c.zs[k] - c.zs[k - 1]) < 2.6);
  assert.equal(c.ws[0], 36);
  assert.equal(c.ws[c.n - 1], 52);
});

test('a piste is carved level across, groomed, and the trees on it are cleared', () => {
  const { hf, surf, base } = fresh('small', 'medium', 5);
  const pistes = [{ id: 1, pts: [P(hf, 0, 30), P(hf, 60, 200), P(hf, -40, 400), P(hf, 0, 600)], from: null, to: null }];
  const w = buildWorld(hf, surf, base, { pistes });
  const c = w.curves.get(1);
  const props = new PropSet(hf);
  props.set(w.props);
  for (const f of [0.2, 0.4, 0.6, 0.8]) {
    const a = curveAt(c, f);
    const k = a.k;
    const dx = c.xs[Math.min(c.n - 1, k + 2)] - c.xs[Math.max(0, k - 2)];
    const dz = c.zs[Math.min(c.n - 1, k + 2)] - c.zs[Math.max(0, k - 2)];
    const l = Math.hypot(dx, dz);
    const nx = -dz / l;
    const nz = dx / l;
    // across the piste the snow is (nearly) level: a quarter of the natural tilt at most
    const left = hf.heightAt(a.x + nx * 12, a.z + nz * 12);
    const right = hf.heightAt(a.x - nx * 12, a.z - nz * 12);
    const nat = new Heightfield(hf.sizeX, hf.sizeZ, hf.cell);
    nat.h.set(base.h);
    const natTilt = Math.abs(nat.heightAt(a.x + nx * 12, a.z + nz * 12) - nat.heightAt(a.x - nx * 12, a.z - nz * 12));
    assert.ok(Math.abs(left - right) <= natTilt * 0.3 + 0.3, `level across at ${f}: ${Math.abs(left - right).toFixed(2)} vs ${natTilt.toFixed(2)} natural`);
    assert.ok(surf.at(a.x, a.z).g > 0.95, 'groomed');
    assert.equal(props.near(a.x, a.z, 14).length, 0, 'no trees or rocks on the piste');
  }
  // off the piste the snow is wild: powder
  assert.ok(surf.at(c.xs[0] + 120, c.zs[0] + 200).powder > 0.9);
});

test('a piste is graded where the mountain is too steep to ride', () => {
  const { hf, surf, base } = fresh('small', 'steep', 9);
  // straight down through the steepest part of the mountain
  const pistes = [{ id: 1, pts: [P(hf, 0, 20), P(hf, 0, 650)], from: null, to: null }];
  const w = buildWorld(hf, surf, base, { pistes });
  const c = w.curves.get(1);
  let maxDeg = 0;
  for (let k = 5; k < c.n - 5; k++) {
    const d = hf.heightAt(c.xs[k], c.zs[k]) - hf.heightAt(c.xs[k + 1], c.zs[k + 1]);
    maxDeg = Math.max(maxDeg, (Math.atan2(d, c.s[k + 1] - c.s[k]) * 180) / Math.PI);
  }
  assert.ok(maxDeg < 41, `steepest stretch ${maxDeg.toFixed(1)}°`);
});

test('a branch leaves a piste and joins it again with no step where they meet', () => {
  const { hf, surf, base } = fresh('small', 'medium', 5);
  const pistes = [{ id: 1, pts: [P(hf, 0, 30), P(hf, 0, 330), P(hf, 0, 630)], from: null, to: null }];
  const b = newPiste(pistes, [P(hf, 110, 230, 24), P(hf, 120, 420, 24)], { id: 1, f: 0.2 });
  b.to = { id: 1, f: 0.8 };
  pistes.push(b);
  const w = buildWorld(hf, surf, base, { pistes });
  const cb = w.curves.get(b.id);
  const cm = w.curves.get(1);
  assert.ok(cb, 'the branch has a curve');
  // it starts and ends on the main piste
  const s0 = curveAt(cm, 0.2);
  const s1 = curveAt(cm, 0.8);
  assert.ok(Math.hypot(cb.xs[0] - s0.x, cb.zs[0] - s0.z) < 0.5);
  assert.ok(Math.hypot(cb.xs[cb.n - 1] - s1.x, cb.zs[cb.n - 1] - s1.z) < 0.5);
  // walk out of the main piste along the branch: the snow changes gently, no step
  let worst = 0;
  for (let k = 0; k < Math.min(cb.n - 1, 40); k++) {
    const d = Math.abs(hf.heightAt(cb.xs[k + 1], cb.zs[k + 1]) - hf.heightAt(cb.xs[k], cb.zs[k]));
    worst = Math.max(worst, d / Math.max(0.1, cb.s[k + 1] - cb.s[k]));
  }
  assert.ok(worst < 0.8, `steepest step along the junction: ${worst.toFixed(2)}`);
  // only the main piste ends in a finish line (the branch joins it)
  assert.equal(w.ends.finishes.length, 1);
  assert.equal(w.ends.start.id, 1);
});

test('a new waypoint dropped on the piste goes between the two around it', () => {
  const { hf } = fresh('small', 'gentle', 2);
  const p = { id: 1, pts: [P(hf, 0, 30), P(hf, 0, 200), P(hf, 0, 400)], from: null, to: null };
  const c = pisteCurves([p]).get(1);
  const near = nearestOnCurves(new Map([[1, c]]), 3, hf.startZ + 300);
  assert.equal(insertIndex(p, c, near.k), 2);
  const n2 = nearestOnCurves(new Map([[1, c]]), 0, hf.startZ + 60);
  assert.equal(insertIndex(p, c, n2.k), 1);
});

test('a suggested piste goes from the top to the bottom without crossing a cliff', () => {
  const { hf, base } = fresh('medium', 'steep', 4);
  const pts = suggestPiste(hf, base.rock, base.gen);
  assert.ok(pts.length >= 6);
  assert.ok(pts[0].z < hf.startZ + 60);
  assert.ok(pts[pts.length - 1].z > hf.finishZ - 120);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].z > pts[i - 1].z, 'always going down the mountain');
});

// ---------- terrain pieces ----------

test('pieces replace what is on their layer, and erase clears every layer', () => {
  let ps = placeTiles([], [{ k: 'bump', i: 3, j: 4 }, { k: 'forest', i: 3, j: 4 }], 50, 50);
  assert.equal(ps.length, 2, 'a shape and a cover on one tile');
  ps = placeTiles(ps, [{ k: 'hollow', i: 3, j: 4 }], 50, 50);
  assert.deepEqual(ps.map((p) => p.k).sort(), ['forest', 'hollow']);
  ps = placeTiles(ps, [{ k: 'powder', i: 3, j: 4 }, { k: 'bump', i: 99, j: 4 }], 50, 50);
  assert.equal(ps.length, 3, 'off-grid pieces are dropped');
  ps = eraseTiles(ps, [[3, 4]]);
  assert.equal(ps.length, 0);
  assert.deepEqual(brushTiles(5, 5, 3).length, 9);
  const all = Object.keys(KINDS).map((k, n) => ({ k, i: n, j: n * 2 }));
  assert.deepEqual(unpackTiles(packTiles(all)), all);
  assert.equal(trimTiles([{ k: 'bump', i: 5, j: 400 }], 50, 50).length, 0);
});

test('bumps side by side melt into one ridge: no dip between them, no edges', () => {
  const { hf, surf, base } = fresh('small', 'gentle', 3);
  const t = tileAt(hf, 0, 300);
  const row = [];
  for (let di = -3; di <= 3; di++) row.push({ k: 'bump', i: t.i + di, j: t.j });
  buildWorld(hf, surf, base, { pieces: row });
  const nat = new Heightfield(hf.sizeX, hf.sizeZ, hf.cell);
  nat.h.set(base.h);
  const zc = hf.startZ + (t.j + 0.5) * 10;
  const x0 = -hf.halfX + (t.i + 0.5) * 10;
  // along the ridge: the rise never dips between tiles
  const rise = [];
  for (let x = x0 - 25; x <= x0 + 25; x += 1.5) rise.push(hf.heightAt(x, zc) - nat.heightAt(x, zc));
  const lo = Math.min(...rise);
  const hi = Math.max(...rise);
  assert.ok(lo > 2.2, `a ridge (${lo.toFixed(2)} to ${hi.toFixed(2)} m)`);
  assert.ok(hi - lo < 0.6, 'even along its length');
  // across it: a smooth rise and fall, no slope sharper than a gentle roller
  let maxStep = 0;
  for (let z = zc - 30; z < zc + 30; z += 0.5) {
    const a = hf.heightAt(x0, z) - nat.heightAt(x0, z);
    const b = hf.heightAt(x0, z + 0.5) - nat.heightAt(x0, z + 0.5);
    maxStep = Math.max(maxStep, Math.abs(b - a) / 0.5);
  }
  assert.ok(maxStep < 0.45, `smooth flanks (${maxStep.toFixed(2)})`);
  // a bigger block grows taller in the middle: one hill, not a plateau of bumps
  const block = [];
  for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) block.push({ k: 'bump', i: t.i + di, j: t.j + dj });
  buildWorld(hf, surf, base, { pieces: block });
  assert.ok(hf.heightAt(x0, zc) - nat.heightAt(x0, zc) > hi + 1, 'a hill');
});

test('a bump next to a hollow rolls into it', () => {
  const { hf, surf, base } = fresh('small', 'gentle', 3);
  const t = tileAt(hf, 0, 300);
  buildWorld(hf, surf, base, { pieces: [{ k: 'bump', i: t.i, j: t.j }, { k: 'bump', i: t.i, j: t.j - 1 }, { k: 'hollow', i: t.i, j: t.j + 1 }, { k: 'hollow', i: t.i, j: t.j + 2 }] });
  const nat = new Heightfield(hf.sizeX, hf.sizeZ, hf.cell);
  nat.h.set(base.h);
  const x0 = -hf.halfX + (t.i + 0.5) * 10;
  let prev = null;
  let maxStep = 0;
  for (let z = hf.startZ + t.j * 10 - 20; z < hf.startZ + t.j * 10 + 40; z += 0.5) {
    const v = hf.heightAt(x0, z) - nat.heightAt(x0, z);
    if (prev !== null) maxStep = Math.max(maxStep, Math.abs(v - prev) / 0.5);
    prev = v;
  }
  assert.ok(maxStep < 0.6, `one rolling shape (${maxStep.toFixed(2)})`);
});

test('a flat eases the slope off, a wall steepens it, a rock band makes a cliff', () => {
  const { hf, surf, base } = fresh('small', 'medium', 5);
  const t = tileAt(hf, 0, 330);
  const across = (k, rowsDeep) => {
    const out = [];
    for (let di = -8; di <= 8; di++) for (let dj = 0; dj < rowsDeep; dj++) out.push({ k, i: t.i + di, j: t.j + dj });
    return out;
  };
  const z0 = hf.startZ + t.j * 10;
  const slopeIn = () => (hf.heightAt(0, z0 + 3) - hf.heightAt(0, z0 + 27)) / 24;
  buildWorld(hf, surf, base, {});
  const natural = slopeIn();
  buildWorld(hf, surf, base, { pieces: across('flat', 3) });
  assert.ok(slopeIn() < natural * 0.45, `flatter (${slopeIn().toFixed(2)} vs ${natural.toFixed(2)})`);
  buildWorld(hf, surf, base, { pieces: across('wall', 3) });
  assert.ok(slopeIn() > natural * 1.5, `steeper (${slopeIn().toFixed(2)} vs ${natural.toFixed(2)})`);
  buildWorld(hf, surf, base, { pieces: across('rocks', 1) });
  let face = 0;
  for (let z = z0 - 5; z < z0 + 15; z += 0.5) face = Math.max(face, (hf.heightAt(0, z) - hf.heightAt(0, z + 0.5)) / 0.5);
  assert.ok(face > 0.95, `a cliff face (${((Math.atan(face) * 180) / Math.PI).toFixed(0)}°)`);
  assert.ok(surf.rock[hf.idx(Math.round((0 + hf.halfX) / hf.cell), Math.round((z0 + 5 + hf.halfZ) / hf.cell))] > 128, 'bare rock');
});

test('forest grows trees, clearings remove them, powder un-grooms a piste', () => {
  const { hf, surf, base } = fresh('small', 'medium', 5);
  const pistes = [{ id: 1, pts: [P(hf, 0, 30), P(hf, 0, 650)], from: null, to: null }];
  const t = tileAt(hf, -200, 300);
  const forest = [];
  for (let di = 0; di < 4; di++) for (let dj = 0; dj < 4; dj++) forest.push({ k: 'forest', i: t.i + di, j: t.j + dj });
  const before = buildWorld(hf, surf, base, { pistes }).props.filter((p) => p.k === TREE).length;
  const withForest = buildWorld(hf, surf, base, { pistes, pieces: forest }).props.filter((p) => p.k === TREE).length;
  assert.ok(withForest > before + 20, `forest adds trees (${withForest - before} on 40 × 40 m)`);
  // a clearing over the natural woods
  const wood = base.forest.filter((p) => p.k === TREE);
  const spot = wood[Math.floor(wood.length / 2)];
  const ct = tileAt(hf, spot.x, spot.u);
  const clearing = brushTiles(ct.i, ct.j, 3).map(([i, j]) => ({ k: 'clearing', i, j }));
  const cleared = buildWorld(hf, surf, base, { pistes, pieces: clearing }).props;
  const near = (list) => list.filter((p) => p.k === TREE && Math.abs(p.x - spot.x) < 8 && Math.abs(p.u - spot.u) < 8).length;
  assert.ok(near(cleared) < near(base.forest), 'clearing');
  // powder on the piste
  const pt = tileAt(hf, 0, 300);
  buildWorld(hf, surf, base, { pistes, pieces: brushTiles(pt.i, pt.j, 3).map(([i, j]) => ({ k: 'powder', i, j })) });
  assert.ok(surf.at(0, hf.startZ + 305).powder > 0.8, 'powder on the piste');
  assert.ok(surf.at(0, hf.startZ + 200).g > 0.95, 'groomed elsewhere');
});

test('rebuilding the mountain is fast enough to preview while dragging', () => {
  const { hf, surf, base } = fresh('medium', 'medium', 8);
  const pistes = [{ id: 1, pts: [P(hf, 0, 30), P(hf, 60, 300), P(hf, -60, 700), P(hf, 0, 1050)], from: null, to: null }];
  const t = tileAt(hf, 0, 500);
  const pieces = brushTiles(t.i, t.j, 3).map(([i, j]) => ({ k: 'bump', i, j }));
  buildWorld(hf, surf, base, { pistes, pieces });
  const t0 = performance.now();
  for (let i = 0; i < 4; i++) buildWorld(hf, surf, base, { pistes, pieces });
  const ms = (performance.now() - t0) / 4;
  assert.ok(ms < 80, `${ms.toFixed(1)} ms per rebuild`);
  assert.ok(gridCols(hf) === 72 && gridRows(hf) > 100);
});

// ---------- riding it ----------

test('a skier sent down a piste rides it to the finish line', () => {
  const { hf, surf, base } = fresh('small', 'medium', 5);
  const pistes = [{ id: 1, pts: [P(hf, 0, 25), P(hf, 0, 250), P(hf, 0, 450), P(hf, 0, 620)], from: null, to: null }];
  const w = buildWorld(hf, surf, base, { pistes });
  const props = new PropSet(hf);
  props.set(w.props);
  const sk = new Skier(hf, w.ends.start);
  sk.props = props;
  sk.surface = surf;
  sk.finishes = w.ends.finishes;
  for (let t = 0; t < 120 && sk.status === 'running'; t += 1 / 60) sk.update(1 / 60);
  assert.equal(sk.status, 'finished');
  const f = w.ends.finishes[0];
  assert.ok(Math.abs(sk.pos[2] - f.z) < 15, 'at the finish line, not the bottom of the mountain');
  assert.equal(sk.wipeouts, 0, 'no trees on the piste to hit');
});

test('the start sends the skier down the piste, not straight down the fall line', () => {
  const { hf, surf, base } = fresh('small', 'gentle', 5);
  const pistes = [{ id: 1, pts: [P(hf, -80, 40), P(hf, 40, 120), P(hf, 120, 260)], from: null, to: null }];
  const w = buildWorld(hf, surf, base, { pistes });
  assert.ok(w.ends.start.dir[0] > 0.5, 'heading across the slope, to the right');
  const sk = new Skier(hf, w.ends.start);
  sk.surface = surf;
  assert.ok(sk.vel[0] > 5, 'pushed off along the piste');
});
