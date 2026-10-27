// Wild mountains, terrain pieces that merge, the start gate anywhere, and riding it all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield } from '../src/core/heightfield.js';
import { SurfaceMap } from '../src/core/surface.js';
import { PropSet, TREE } from '../src/core/props.js';
import { Skier } from '../src/core/skier.js';
import { newWild, buildWild, wildDims, makeWild, SIZES, STEEPNESS } from '../src/core/wild.js';
import { KINDS, placeTiles, eraseTiles, brushTiles, lineTiles, packTiles, unpackTiles, trimTiles, tileOf, tileCenter, gridCols, gridRows, squaresToHexes } from '../src/core/terrain.js';
import { HEX_R, HEX_W, HEX_H, hexCenter, hexDistance } from '../src/core/hex.js';
import { buildWorld, fallLine, defaultStart, GATE_CLEAR } from '../src/core/world.js';

const fresh = (size = 'small', steep = 'medium', seed = 7) => {
  const hf = new Heightfield();
  const surf = new SurfaceMap(hf);
  const base = buildWild(hf, surf, newWild(size, steep, seed));
  return { hf, surf, base };
};
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

// ---------- the hexagon grid ----------

test('the grid is hexagons: every point is in the tile whose centre is nearest', () => {
  const { hf } = fresh('small', 'medium', 2);
  for (let n = 0; n < 4000; n++) {
    const x = -hf.halfX + Math.random() * hf.sizeX;
    const z = hf.startZ + Math.random() * 400;
    const t = tileOf(hf, x, z);
    const c = tileCenter(hf, t.i, t.j);
    const d = Math.hypot(x - c.x, z - c.z);
    assert.ok(d <= HEX_R + 1e-9, 'inside its hexagon');
    for (const [i, j] of brushTiles(t.i, t.j, 2)) {
      const o = tileCenter(hf, i, j);
      assert.ok(d <= Math.hypot(x - o.x, z - o.z) + 1e-9, 'no neighbour is nearer');
    }
  }
  // six neighbours, all one tile width away; brushes of 1, 7 and 19 tiles
  const ring = brushTiles(10, 7, 2).filter(([i, j]) => i !== 10 || j !== 7);
  const [cx, cu] = hexCenter(10, 7);
  for (const [i, j] of ring) assert.ok(Math.abs(Math.hypot(hexCenter(i, j)[0] - cx, hexCenter(i, j)[1] - cu) - HEX_W) < 1e-9);
  assert.deepEqual([1, 2, 3].map((s) => brushTiles(4, 5, s).length), [1, 7, 19]);
  // a drag leaves no gaps: each tile on a line touches the one before
  const line = lineTiles({ i: 2, j: 3 }, { i: 30, j: 41 });
  for (let k = 1; k < line.length; k++) assert.equal(hexDistance({ i: line[k - 1][0], j: line[k - 1][1] }, { i: line[k][0], j: line[k][1] }), 1);
  // the tiles fill the mountain, whole, edge to edge
  const cols = gridCols(hf);
  const rows = gridRows(hf);
  assert.ok(hexCenter(cols - 1, 1)[0] + HEX_W / 2 <= hf.sizeX + 1e-9 && hexCenter(cols, 1)[0] + HEX_W / 2 > hf.sizeX - HEX_W);
  assert.ok(hexCenter(0, rows - 1)[1] + HEX_R <= hf.finishZ - hf.startZ && hexCenter(0, rows)[1] + HEX_R > hf.finishZ - hf.startZ - HEX_H);
});

test('pieces painted on the old 10 m squares land on the hexagons in the same place', () => {
  const { hf } = fresh('small', 'medium', 2);
  // a 6 × 4 block of bumps and one forest square
  const squares = [];
  for (let i = 20; i < 26; i++) for (let j = 10; j < 14; j++) squares.push({ k: 'bump', i, j });
  squares.push({ k: 'forest', i: 40, j: 30 });
  const hexes = squaresToHexes(squares, gridCols(hf), gridRows(hf));
  const bumps = hexes.filter((p) => p.k === 'bump');
  // about the same area (a hexagon is 94 m², a square 100)
  const area = (bumps.length * 3 * Math.sqrt(3) * HEX_R * HEX_R) / 2;
  assert.ok(Math.abs(area - 2400) < 500, `${area.toFixed(0)} m² of bumps`);
  for (const p of bumps) {
    const [x, u] = hexCenter(p.i, p.j);
    assert.ok(x >= 200 && x < 260 && u >= 100 && u < 140, 'inside the old block');
  }
  assert.ok(hexes.some((p) => p.k === 'forest'));
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
  assert.deepEqual(brushTiles(5, 5, 3).length, 19);
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
  const { x: x0, z: zc } = tileCenter(hf, t.i, t.j);
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
  const { x: x0, z: zc } = tileCenter(hf, t.i, t.j);
  let prev = null;
  let maxStep = 0;
  for (let z = zc - 25; z < zc + 35; z += 0.5) {
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
  // the top of the first row, where its hexagons' sides begin
  const z0 = tileCenter(hf, t.i, t.j).z - HEX_R / 2;
  const slopeIn = () => (hf.heightAt(0, z0 + 3) - hf.heightAt(0, z0 + 27)) / 24;
  buildWorld(hf, surf, base, {});
  const natural = slopeIn();
  buildWorld(hf, surf, base, { pieces: across('flat', 4) });
  assert.ok(slopeIn() < natural * 0.45, `flatter (${slopeIn().toFixed(2)} vs ${natural.toFixed(2)})`);
  buildWorld(hf, surf, base, { pieces: across('wall', 4) });
  assert.ok(slopeIn() > natural * 1.5, `steeper (${slopeIn().toFixed(2)} vs ${natural.toFixed(2)})`);
  buildWorld(hf, surf, base, { pieces: across('rocks', 1) });
  let face = 0;
  for (let z = z0 - 5; z < z0 + 15; z += 0.5) face = Math.max(face, (hf.heightAt(0, z) - hf.heightAt(0, z + 0.5)) / 0.5);
  assert.ok(face > 0.95, `a cliff face (${((Math.atan(face) * 180) / Math.PI).toFixed(0)}°)`);
  assert.ok(surf.rock[hf.idx(Math.round((0 + hf.halfX) / hf.cell), Math.round((z0 + 5 + hf.halfZ) / hf.cell))] > 128, 'bare rock');
});

test('forest grows trees, clearings remove them, powder makes deep snow', () => {
  const { hf, surf, base } = fresh('small', 'medium', 5);
  const t = tileAt(hf, -200, 300);
  const forest = [];
  for (let di = 0; di < 4; di++) for (let dj = 0; dj < 4; dj++) forest.push({ k: 'forest', i: t.i + di, j: t.j + dj });
  const before = buildWorld(hf, surf, base, {}).props.filter((p) => p.k === TREE).length;
  const withForest = buildWorld(hf, surf, base, { pieces: forest }).props.filter((p) => p.k === TREE).length;
  assert.ok(withForest > before + 20, `forest adds trees (${withForest - before} on 40 × 40 m)`);
  // a clearing over the natural woods
  const wood = base.forest.filter((p) => p.k === TREE);
  const spot = wood[Math.floor(wood.length / 2)];
  const ct = tileAt(hf, spot.x, spot.u);
  const clearing = brushTiles(ct.i, ct.j, 3).map(([i, j]) => ({ k: 'clearing', i, j }));
  const cleared = buildWorld(hf, surf, base, { pieces: clearing }).props;
  const near = (list) => list.filter((p) => p.k === TREE && Math.abs(p.x - spot.x) < 8 && Math.abs(p.u - spot.u) < 8).length;
  assert.ok(near(cleared) < near(base.forest), 'clearing');
  // the snow is packed everywhere, powder where you paint it
  const pt = tileAt(hf, 0, 300);
  buildWorld(hf, surf, base, { pieces: brushTiles(pt.i, pt.j, 3).map(([i, j]) => ({ k: 'powder', i, j })) });
  assert.ok(surf.at(0, hf.startZ + 305).powder > 0.8, 'powder');
  const packed = surf.at(60, hf.startZ + 200);
  assert.ok(packed.powder < 0.01 && packed.groomed < 0.01, 'packed snow elsewhere');
});

test('the start gate goes anywhere, faces down the fall line, and nothing grows on it', () => {
  const { hf, surf, base } = fresh('small', 'medium', 5);
  // in the middle of the woods
  const wood = base.forest.filter((p) => p.k === TREE && p.u > 200);
  const spot = wood[Math.floor(wood.length / 2)];
  const start = { x: spot.x, z: hf.startZ + spot.u };
  const w = buildWorld(hf, surf, base, { start });
  const close = w.props.filter((p) => Math.hypot(p.x - start.x, hf.startZ + p.u - start.z) < GATE_CLEAR - 0.5);
  assert.equal(close.length, 0, 'clear around the gate');
  const [dx, dz] = fallLine(hf, start.x, start.z);
  const drop = hf.heightAt(start.x, start.z) - hf.heightAt(start.x + dx * 8, start.z + dz * 8);
  assert.ok(drop > 0.5, `downhill (${drop.toFixed(2)} m over 8 m)`);
  const d = defaultStart(hf, base);
  assert.ok(d.z < hf.startZ + 60, 'the default start is near the top');
});

test('rebuilding the mountain is fast enough to preview while dragging', () => {
  const { hf, surf, base } = fresh('medium', 'medium', 8);
  const t = tileAt(hf, 0, 500);
  const pieces = brushTiles(t.i, t.j, 3).map(([i, j]) => ({ k: 'bump', i, j }));
  const start = { x: 0, z: hf.startZ + 30 };
  buildWorld(hf, surf, base, { pieces, start });
  const t0 = performance.now();
  for (let i = 0; i < 4; i++) buildWorld(hf, surf, base, { pieces, start });
  const ms = (performance.now() - t0) / 4;
  assert.ok(ms < 80, `${ms.toFixed(1)} ms per rebuild`);
  assert.ok(gridCols(hf) === 68 && gridRows(hf) > 100, `${gridCols(hf)} × ${gridRows(hf)} tiles`);
});

// ---------- riding it ----------

test('a skier sent from the gate rides to the bottom of the mountain', () => {
  const { hf, surf, base } = fresh('small', 'medium', 5);
  const start = { x: 0, z: hf.startZ + 25 };
  const w = buildWorld(hf, surf, base, { start });
  const props = new PropSet(hf);
  props.set(w.props);
  const sk = new Skier(hf, { ...start, dir: fallLine(hf, start.x, start.z) });
  sk.props = props;
  sk.surface = surf;
  // hands off, but tuck so the trees don't get a wipeout every few seconds
  for (let t = 0; t < 240 && sk.status === 'running'; t += 1 / 60) sk.update(1 / 60);
  assert.equal(sk.status, 'finished');
  assert.ok(sk.pos[2] >= hf.finishZ - 1, 'at the bottom');
});

test('a paused run picks up where it was, on the snow as it is now', () => {
  const { hf, surf, base } = fresh('small', 'medium', 5);
  const start = { x: 0, z: hf.startZ + 25 };
  buildWorld(hf, surf, base, { start });
  const sk = new Skier(hf, { ...start, dir: fallLine(hf, start.x, start.z) });
  sk.surface = surf;
  for (let k = 0; k < 240 * 6; k++) sk.step(1 / 240);
  const v = sk.speed;
  const pos = [...sk.pos];
  // build a bump right under him while paused
  const t = tileOf(hf, pos[0], pos[2]);
  buildWorld(hf, surf, base, { start, pieces: brushTiles(t.i, t.j, 3).map(([i, j]) => ({ k: 'bump', i, j })) });
  sk.resume();
  assert.ok(Math.abs(sk.pos[1] - hf.heightAt(sk.pos[0], sk.pos[2])) < 1e-6, 'back on the snow');
  assert.ok(Math.abs(sk.speed - v) < v * 0.25, `same speed (${sk.speed.toFixed(1)} vs ${v.toFixed(1)})`);
  assert.ok(Math.hypot(sk.pos[0] - pos[0], sk.pos[2] - pos[2]) < 1e-6, 'same place');
  for (let k = 0; k < 240; k++) sk.step(1 / 240);
  assert.equal(sk.status, 'running');
});

// ---------- the feel of the skis ----------

const plane = (deg) => {
  const hf = new Heightfield(600, 2400, 1.5);
  hf.fill((x, z) => 1200 - Math.tan((deg * Math.PI) / 180) * z);
  return hf;
};
const moving = (hf, v, deg) => {
  const s = new Skier(hf, { x: 0, z: hf.startZ + 200, dir: [0, 1] });
  const a = (deg * Math.PI) / 180;
  s.vel = [0, -v * Math.sin(a), v * Math.cos(a)];
  s.heading = s.vel.map((c) => c / v);
  return s;
};
const turn90 = (s, stick) => {
  let turned = 0;
  let prev = Math.atan2(s.vel[0], s.vel[2]);
  let t = 0;
  while (t < 8 && Math.abs(turned) < Math.PI / 2) {
    s.input.steer = stick;
    s.step(1 / 240);
    t += 1 / 240;
    const a = Math.atan2(s.vel[0], s.vel[2]);
    turned += a - prev;
    prev = a;
  }
  return { t, R: s.distance / Math.abs(turned) };
};

test('a carve holds its speed and tightens as you slow down; full stick skids it round and scrubs speed', () => {
  const hf = plane(22);
  const slow = turn90(moving(hf, 8, 22), 0.85);
  const fast = turn90(moving(hf, 22, 22), 0.85);
  assert.ok(slow.R < 12, `tight at 29 km/h (${slow.R.toFixed(1)} m)`);
  assert.ok(fast.R > slow.R * 2.5, `longer arcs at 79 km/h (${fast.R.toFixed(1)} m)`);
  const carve = moving(hf, 15, 22);
  turn90(carve, 0.85);
  const skid = moving(hf, 15, 22);
  const sk = turn90(skid, 1);
  assert.ok(carve.speed > 15, `the carve keeps its speed (${(carve.speed * 3.6).toFixed(0)} km/h)`);
  assert.ok(skid.speed < carve.speed * 0.7, `the skid scrubs it (${(skid.speed * 3.6).toFixed(0)} km/h)`);
  assert.ok(sk.R < turn90(moving(hf, 15, 22), 0.85).R, 'and turns tighter');
});

test('a hockey stop stops you in a few seconds, and the edges hold you still across the slope', () => {
  const hf = plane(22);
  const s = moving(hf, 14, 22);
  let t = 0;
  while (t < 6 && s.speed > 0.3) {
    s.input.brake = true;
    s.step(1 / 240);
    t += 1 / 240;
  }
  assert.ok(t < 4, `stopped from 50 km/h in ${t.toFixed(2)} s`);
  for (let k = 0; k < 240 * 2; k++) s.step(1 / 240);
  assert.ok(s.speed < 0.5, `still standing (${s.speed.toFixed(2)} m/s)`);
});

test('powder is slower than packed snow, and poling gets you going on the flat', () => {
  const hf = plane(20);
  const surf = new SurfaceMap(hf);
  const deep = new SurfaceMap(hf);
  deep.pow.fill(255);
  const a = new Skier(hf, { x: 0, z: hf.startZ + 50, dir: [0, 1] });
  a.surface = surf;
  const b = new Skier(hf, { x: 0, z: hf.startZ + 50, dir: [0, 1] });
  b.surface = deep;
  for (let k = 0; k < 240 * 15; k++) {
    a.step(1 / 240);
    b.step(1 / 240);
  }
  assert.ok(b.speed < a.speed * 0.8, `powder ${(b.speed * 3.6).toFixed(0)} vs packed ${(a.speed * 3.6).toFixed(0)} km/h`);
  const flat = new Heightfield(300, 300, 1.5);
  flat.h.fill(10);
  const c = new Skier(flat, { x: 0, z: 0, dir: [0, 1] });
  c.input.pitch = 1;
  for (let k = 0; k < 240 * 4; k++) c.step(1 / 240);
  assert.equal(c.status, 'running');
  assert.ok(c.speed > 3, `poling (${c.speed.toFixed(1)} m/s)`);
});

test('the body leans into a carve, along the push of the snow', () => {
  const hf = plane(18);
  const s = moving(hf, 15, 18);
  for (let k = 0; k < 240 * 1.2; k++) {
    s.input.steer = 0.85;
    s.step(1 / 240);
  }
  // turning right (towards -x when heading down +z): the body leans that way
  const lean = Math.acos(Math.min(1, s.tilt[0] * s.n[0] + s.tilt[1] * s.n[1] + s.tilt[2] * s.n[2]));
  assert.ok(lean > 0.5, `leaning ${((lean * 180) / Math.PI).toFixed(0)}°`);
  assert.ok(s.tilt[0] < s.n[0], 'into the turn');
});
