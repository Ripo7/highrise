// The slope you design, the hexagon tiles and their actions, the start gate anywhere, and
// riding it all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield } from '../src/core/heightfield.js';
import { SurfaceMap } from '../src/core/surface.js';
import { PropSet, TREE } from '../src/core/props.js';
import { Skier } from '../src/core/skier.js';
import { buildSlope, templateDesign, normalizeDesign, designStats, designDims, designFromWild, profile, TEMPLATES, LIMITS, MAX_LENGTH } from '../src/core/slopes.js';
import { brushTiles, lineTiles, tileOf, tileCenter, gridCols, gridRows, squaresToHexes } from '../src/core/terrain.js';
import { applyAction, describe, copyTiles, rotateCopy, pasteTiles, packTiles, unpackTiles, fromPieces, LIFT_MAX } from '../src/core/tiles.js';
import { HEX_R, HEX_W, HEX_H, hexCenter, hexDistance } from '../src/core/hex.js';
import { buildWorld, fallLine, defaultStart, GATE_CLEAR } from '../src/core/world.js';

// a plain slope, 720 m wide, of one pitch all the way down
const PITCH = { gentle: 15, medium: 22, steep: 29 };
const LENGTH = { small: 700, medium: 1100 };
const fresh = (size = 'small', steep = 'medium') => {
  const hf = new Heightfield();
  const surf = new SurfaceMap(hf);
  const L = LENGTH[size];
  const n = Math.ceil(L / 400);
  const base = buildSlope(hf, surf, { width: 'wide', sections: Array.from({ length: n }, () => ({ slope: PITCH[steep], length: L / n })) });
  return { hf, surf, base };
};
const tileAt = (hf, x, u) => tileOf(hf, x, hf.startZ + u);
const pitchAt = (hf, u, d = 4) => (Math.atan2(hf.heightAt(0, hf.startZ + u - d) - hf.heightAt(0, hf.startZ + u + d), 2 * d) * 180) / Math.PI;

// ---------- the slope you design ----------

test('a slope follows its sections: each pitch, as long as designed, eased at the joints', () => {
  const hf = new Heightfield();
  const surf = new SurfaceMap(hf);
  const base = buildSlope(hf, surf, { width: 'medium', sections: [{ slope: 10, length: 100 }, { slope: 30, length: 120 }, { slope: -5, length: 60 }, { slope: 20, length: 100 }] });
  assert.equal(base.L, 380);
  assert.ok(Math.abs(hf.finishZ - hf.startZ - 380) < hf.cell, 'as long as the sections');
  assert.equal(hf.sizeX, 540, 'medium: 540 m wide');
  for (const [u, deg] of [[50, 10], [160, 30], [250, -5], [330, 20]]) assert.ok(Math.abs(pitchAt(hf, u) - deg) < 0.6, `${deg}° at ${u} m (${pitchAt(hf, u).toFixed(1)}°)`);
  // the same across the whole width: bare snow, nothing natural on it
  const z = hf.startZ + 200;
  assert.ok(Math.abs(hf.heightAt(-200, z) - hf.heightAt(200, z)) < 1e-6, 'level across');
  assert.equal(base.forest.length, 0);
  assert.ok(base.rock.every((v) => v === 0));
  // joints roll over: the pitch never jumps from one metre to the next
  let jump = 0;
  for (let u = 1; u < 379; u += 0.5) jump = Math.max(jump, Math.abs(pitchAt(hf, u + 0.5, 0.5) - pitchAt(hf, u, 0.5)));
  assert.ok(jump < 4, `eased joints (${jump.toFixed(1)}° per half metre at most)`);
  // and the drop is what the pitches add up to
  const drop = hf.heightAt(0, hf.startZ) - hf.heightAt(0, hf.startZ + 380);
  const want = [[10, 100], [30, 120], [-5, 60], [20, 100]].reduce((s, [d, l]) => s + l * Math.tan((d * Math.PI) / 180), 0);
  assert.ok(Math.abs(drop - want) < 2, `drop ${drop.toFixed(1)} m (${want.toFixed(1)})`);
  assert.ok(Math.abs(designStats(base.design).drop - want) < 2);
});

test('designs stay inside their limits, and say why one can’t be built', () => {
  const d = normalizeDesign({ width: 'huge', sections: [{ slope: 80, length: 5 }, { slope: -40.4, length: 1234 }, { slope: 'x' }] });
  assert.equal(d.width, 'medium');
  assert.deepEqual(d.sections, [
    { slope: LIMITS.slope.max, length: LIMITS.length.min },
    { slope: LIMITS.slope.min, length: LIMITS.length.max },
    { slope: 18, length: 100 },
  ]);
  assert.ok(normalizeDesign({}).sections.length > 0, 'never empty');
  assert.match(designStats({ width: 'medium', sections: [{ slope: 20, length: 60 }] }).reason, /short/);
  assert.match(designStats({ width: 'medium', sections: [{ slope: 1, length: 300 }] }).reason, /drop/);
  for (const t of TEMPLATES) assert.ok(designStats(templateDesign(t.id)).ok, `${t.name} can be built`);
  // the longest, widest slope still fits a phone's vertex budget
  const big = { width: 'wide', sections: Array.from({ length: MAX_LENGTH / 300 }, () => ({ slope: 25, length: 300 })) };
  const dims = designDims(big);
  assert.ok((dims.sizeX / dims.cell + 1) * (dims.sizeZ / dims.cell + 1) < 470000, 'fits the budget');
  assert.equal(profile(big).L, MAX_LENGTH);
});

test('the old wild mountains become sections of about the same length and steepness', () => {
  for (const [steep, deg] of [['gentle', 15], ['medium', 22], ['steep', 29]]) {
    const d = designFromWild({ size: 'medium', steep, seed: 4 });
    const st = designStats(d);
    assert.ok(Math.abs(st.length - 1100) <= 20, `${st.length} m long`);
    assert.ok(Math.abs(st.avgDeg - deg) < 3, `${steep}: ${st.avgDeg.toFixed(1)}° on average`);
    assert.ok(st.ok);
  }
  assert.equal(designFromWild({ size: 'small', steep: 'gentle' }).width, 'medium');
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
  // and the pieces become actions: bumps raised, the forest planted
  const tiles = fromPieces(hexes);
  assert.ok(tiles.filter((t) => t.lift === 3).length === bumps.length && tiles.some((t) => t.trees === 2));
});

// ---------- tiles and their actions ----------

// act on tiles, then build the mountain with them
const actOn = (tiles, sel, ...names) => names.reduce((t, n) => applyAction(t, sel, n), tiles);
const natural = (hf, base) => {
  const nat = new Heightfield(hf.sizeX, hf.sizeZ, hf.cell);
  nat.h.set(base.h);
  return nat;
};

test('actions stack on the tiles, toggle, undo cleanly and erase back to nothing', () => {
  const sel = brushTiles(10, 20, 2);
  let t = actOn([], sel, 'raise', 'raise', 'raise');
  assert.equal(t.length, 7);
  assert.ok(t.every((x) => x.lift === 4.5), 'three taps: 4.5 m');
  for (let k = 0; k < 20; k++) t = applyAction(t, sel, 'raise');
  assert.ok(t.every((x) => x.lift === LIFT_MAX), 'as high as it goes');
  t = actOn([], sel, 'raise', 'lower');
  assert.equal(t.length, 0, 'raise then lower: nothing left to keep');
  // toggles: on for all, then off
  t = actOn([], sel, 'powder');
  assert.ok(t.every((x) => x.snow === 'powder'));
  t = applyAction(t, sel, 'ice');
  assert.ok(t.every((x) => x.snow === 'ice'), 'ice replaces powder');
  t = applyAction(t, sel, 'ice');
  assert.equal(t.length, 0, 'tapped again: packed snow');
  // trees get denser, a clearing takes them away
  t = actOn([], sel, 'trees', 'trees', 'trees', 'trees');
  assert.ok(t.every((x) => x.trees === 3));
  t = applyAction(t, sel, 'clear');
  assert.ok(t.every((x) => x.clear && !x.trees));
  // an action that changes nothing hands back the same list (no undo step)
  const full = actOn([], sel, 'smooth', 'smooth', 'smooth');
  assert.equal(applyAction(full, sel, 'smooth'), full);
  // erase: back to the wild mountain
  assert.equal(applyAction(actOn([], sel, 'raise', 'steepen', 'jump', 'trees'), sel, 'erase').length, 0);
  // the selection's readout
  const d = describe(actOn([], sel, 'raise', 'raise', 'steepen', 'trees'), sel);
  assert.deepEqual([d.n, d.lift, d.pitch, d.trees], [7, 3, 1, 1]);
  // saved and read back exactly
  const mix = actOn(actOn([], sel, 'raise', 'flatten', 'smooth', 'trees', 'ice'), [[3, 4], [4, 4]], 'jump', 'lower');
  assert.deepEqual(unpackTiles(packTiles(mix)), mix);
});

test('raised tiles side by side melt into one ridge: no dip between them, no edges', () => {
  const { hf, surf, base } = fresh('small', 'gentle', 3);
  const nat = natural(hf, base);
  const t = tileAt(hf, 0, 300);
  const row = [];
  for (let di = -3; di <= 3; di++) row.push([t.i + di, t.j]);
  buildWorld(hf, surf, base, { tiles: actOn([], row, 'raise', 'raise') });
  const { x: x0, z: zc } = tileCenter(hf, t.i, t.j);
  // along the ridge: the rise never dips between tiles
  const rise = [];
  for (let x = x0 - 25; x <= x0 + 25; x += 1.5) rise.push(hf.heightAt(x, zc) - nat.heightAt(x, zc));
  const lo = Math.min(...rise);
  const hi = Math.max(...rise);
  assert.ok(lo > 2, `a ridge (${lo.toFixed(2)} to ${hi.toFixed(2)} m)`);
  assert.ok(hi - lo < 0.5, 'even along its length');
  assert.ok(hi < 3.05, 'no higher than raised (3 m)');
  // across it: a smooth rise and fall
  let maxStep = 0;
  for (let z = zc - 30; z < zc + 30; z += 0.5) {
    const a = hf.heightAt(x0, z) - nat.heightAt(x0, z);
    const b = hf.heightAt(x0, z + 0.5) - nat.heightAt(x0, z + 0.5);
    maxStep = Math.max(maxStep, Math.abs(b - a) / 0.5);
  }
  assert.ok(maxStep < 0.55, `smooth flanks (${maxStep.toFixed(2)})`);
  // raised beside lowered: one rolling shape
  const up = brushTiles(t.i, t.j, 2);
  const down = brushTiles(t.i, t.j + 3, 2);
  buildWorld(hf, surf, base, { tiles: actOn(actOn([], up, 'raise', 'raise'), down, 'lower', 'lower') });
  let prev = null;
  maxStep = 0;
  for (let z = zc - 25; z < zc + 50; z += 0.5) {
    const v = hf.heightAt(x0, z) - nat.heightAt(x0, z);
    if (prev !== null) maxStep = Math.max(maxStep, Math.abs(v - prev) / 0.5);
    prev = v;
  }
  assert.ok(maxStep < 0.6, `one rolling shape (${maxStep.toFixed(2)})`);
});

test('flatten levels a group to one height, smooth takes the lumps out', () => {
  const { hf, surf, base } = fresh('small', 'steep', 4);
  const nat = natural(hf, base);
  const t = tileAt(hf, 0, 320);
  const big = brushTiles(t.i, t.j, 3);
  const mid = brushTiles(t.i, t.j, 2);
  const spread = (field) => {
    const ys = mid.map(([i, j]) => tileCenter(hf, i, j)).map((c) => field.heightAt(c.x, c.z));
    return Math.max(...ys) - Math.min(...ys);
  };
  buildWorld(hf, surf, base, { tiles: actOn([], big, 'flatten') });
  assert.ok(spread(hf) < 0.1 && spread(nat) > 5, `level (${spread(hf).toFixed(2)} m, was ${spread(nat).toFixed(2)})`);
  // raised after flattening: still level, just higher
  buildWorld(hf, surf, base, { tiles: actOn([], big, 'flatten', 'raise', 'raise') });
  assert.ok(spread(hf) < 0.1, 'still level');
  // smooth: the lumps go, the slope stays (lumps first: every other tile raised)
  const rough = (field) => {
    let r = 0;
    const c = tileCenter(hf, t.i, t.j);
    for (let z = c.z - 8; z < c.z + 8; z += 1) for (let x = c.x - 8; x < c.x + 8; x += 1) r += Math.abs(field.heightAt(x - 1, z) + field.heightAt(x + 1, z) - 2 * field.heightAt(x, z)) + Math.abs(field.heightAt(x, z - 1) + field.heightAt(x, z + 1) - 2 * field.heightAt(x, z));
    return r;
  };
  const lumps = actOn([], big.filter((_, k) => k % 2 === 0), 'raise', 'raise');
  buildWorld(hf, surf, base, { tiles: lumps });
  const lumpy = rough(hf);
  const c = tileCenter(hf, t.i, t.j);
  const drop = (f) => f.heightAt(c.x, c.z - 10) - f.heightAt(c.x, c.z + 10);
  const lumpyDrop = drop(hf);
  buildWorld(hf, surf, base, { tiles: actOn(lumps, big, 'smooth', 'smooth', 'smooth') });
  assert.ok(rough(hf) < lumpy * 0.5, `smoother (${rough(hf).toFixed(1)} vs ${lumpy.toFixed(1)})`);
  assert.ok(Math.abs(drop(hf) - lumpyDrop) < Math.abs(drop(nat)) * 0.25, 'the same slope');
});

test('ease takes the slope off, steepen adds to it, rocks make a cliff of bare rock', () => {
  const { hf, surf, base } = fresh('small', 'medium', 5);
  const t = tileAt(hf, 0, 330);
  const across = (rowsDeep) => {
    const out = [];
    for (let di = -8; di <= 8; di++) for (let dj = 0; dj < rowsDeep; dj++) out.push([t.i + di, t.j + dj]);
    return out;
  };
  // the top of the first row, where its hexagons' sides begin
  const z0 = tileCenter(hf, t.i, t.j).z - HEX_R / 2;
  const slopeIn = () => (hf.heightAt(0, z0 + 3) - hf.heightAt(0, z0 + 27)) / 24;
  buildWorld(hf, surf, base, {});
  const nat = slopeIn();
  buildWorld(hf, surf, base, { tiles: actOn([], across(4), 'ease', 'ease', 'ease') });
  assert.ok(slopeIn() < nat * 0.45, `flatter (${slopeIn().toFixed(2)} vs ${nat.toFixed(2)})`);
  buildWorld(hf, surf, base, { tiles: actOn([], across(4), 'ease') });
  assert.ok(slopeIn() < nat * 0.9 && slopeIn() > nat * 0.6, 'one tap: a little gentler');
  buildWorld(hf, surf, base, { tiles: actOn([], across(4), 'steepen', 'steepen', 'steepen') });
  assert.ok(slopeIn() > nat * 1.5, `steeper (${slopeIn().toFixed(2)} vs ${nat.toFixed(2)})`);
  buildWorld(hf, surf, base, { tiles: actOn([], across(1), 'rocks') });
  let face = 0;
  for (let z = z0 - 5; z < z0 + 15; z += 0.5) face = Math.max(face, (hf.heightAt(0, z) - hf.heightAt(0, z + 0.5)) / 0.5);
  assert.ok(face > 0.95, `a cliff face (${((Math.atan(face) * 180) / Math.PI).toFixed(0)}°)`);
  assert.ok(surf.rock[hf.idx(Math.round((0 + hf.halfX) / hf.cell), Math.round((z0 + 5 + hf.halfZ) / hf.cell))] > 128, 'bare rock');
});

// a skier straight down the fall line through tile t, from 60 m above it: his longest flight
function flight(hf, surf, base, t, tiles) {
  buildWorld(hf, surf, base, { tiles });
  const c = tileCenter(hf, t.i, t.j);
  const fl = fallLine(hf, c.x, c.z, 10);
  const props = new PropSet(hf);
  const sk = new Skier(hf, { x: c.x - fl[0] * 60, z: c.z - fl[1] * 60, dir: fl });
  sk.props = props;
  sk.surface = surf;
  let cur = 0;
  let best = 0;
  let high = 0;
  for (let k = 0; k < 240 * 8 && sk.status === 'running'; k++) {
    sk.step(1 / 240);
    cur = sk.grounded ? 0 : cur + 1 / 240;
    best = Math.max(best, cur);
    high = Math.max(high, sk.pos[1] - hf.heightAt(sk.pos[0], sk.pos[2]));
  }
  return { air: best, high, status: sk.status };
}

test('a jump faces down the slope and sends you flying; a longer one further; a drop too', () => {
  const { hf, surf, base } = fresh('small', 'medium', 5);
  const t = tileAt(hf, 0, 250);
  const c = tileCenter(hf, t.i, t.j);
  const fl = fallLine(hf, c.x, c.z, 10);
  const dir = (Math.atan2(fl[0], fl[1]) * 180) / Math.PI;
  const none = flight(hf, surf, base, t, []);
  const one = flight(hf, surf, base, t, applyAction([], [[t.i, t.j]], 'jump', { dir }));
  const three = flight(hf, surf, base, t, applyAction([], [[t.i, t.j - 1], [t.i, t.j], [t.i, t.j + 1]], 'jump', { dir }));
  const drop = flight(hf, surf, base, t, applyAction([], [[t.i, t.j]], 'drop', { dir }));
  assert.ok(none.air < 0.25, `no jump: on the snow (${none.air.toFixed(2)} s)`);
  assert.ok(one.air > 0.5 && one.status === 'running', `a jump: ${one.air.toFixed(2)} s in the air`);
  assert.ok(three.high > one.high * 1.5 && three.air > one.air && three.status === 'running', `a bigger one: ${three.high.toFixed(1)} m up, ${three.air.toFixed(2)} s (one tile: ${one.high.toFixed(1)} m, ${one.air.toFixed(2)} s)`);
  assert.ok(drop.air > 0.25 && drop.status === 'running', `a drop: ${drop.air.toFixed(2)} s`);
  // the kicker keeps its snow, however steep its back; and no trees grow on it
  const w = buildWorld(hf, surf, base, { tiles: applyAction(actOn([], brushTiles(t.i, t.j, 2), 'trees', 'trees', 'trees'), [[t.i, t.j]], 'jump', { dir }) });
  let rock = 0;
  for (let d = -6; d < 8; d += 0.5) rock = Math.max(rock, surf.at(c.x + fl[0] * d, c.z + fl[1] * d).rock);
  assert.ok(rock < 0.3, `snow on the kicker (rock ${rock.toFixed(2)})`);
  assert.ok(!w.props.some((p) => Math.hypot(p.x - c.x, hf.startZ + p.u - c.z) < 5), 'no tree on the jump');
});

test('rotate turns a jump a twelfth of a turn; copies keep their shape on any row, turned or not', () => {
  const sel = [[10, 20]];
  let t = applyAction([], sel, 'jump', { dir: 0 });
  t = applyAction(t, sel, 'rotate');
  assert.equal(t[0].dir, 330);
  assert.equal(applyAction(actOn([], sel, 'raise'), sel, 'rotate').length, 1, 'nothing to turn: unchanged');
  // an L of three tiles with a jump on its corner
  const shape = [[10, 20], [11, 20], [10, 21]];
  const src = applyAction(actOn([], shape, 'raise'), [[10, 20]], 'jump', { dir: 0 });
  const clip = copyTiles(src, shape);
  const centres = (cells) => cells.map(([i, j]) => hexCenter(i, j));
  const rel = (cells) => centres(cells).map(([x, u], k, a) => [x - a[0][0], u - a[0][1]]);
  const close = (a, b) => a.every(([x, u], k) => Math.abs(x - b[k][0]) < 1e-9 && Math.abs(u - b[k][1]) < 1e-9);
  for (const [i, j] of [[30, 40], [31, 41], [5, 7]]) {
    const r = pasteTiles(src, clip, i, j, 68, 110);
    assert.ok(close(rel(r.placed), rel(shape)), `same shape at ${i},${j}`);
  }
  // pasted groups are their own
  const r = pasteTiles(src, clip, 30, 40, 68, 110);
  const jumps = r.tiles.filter((x) => x.feat === 'jump');
  assert.equal(new Set(jumps.map((x) => x.g)).size, 2);
  // turned: the shape turns a sixth of a turn, and the jump turns with it
  const turned = rotateCopy(clip);
  const placed = pasteTiles([], turned, 30, 40, 68, 110);
  const ang = (v) => (Math.atan2(v[0], v[1]) * 180) / Math.PI;
  const before = rel(shape);
  const after = rel(placed.placed);
  for (let k = 1; k < 3; k++) {
    let d = ang(after[k]) - ang(before[k]);
    d = ((d % 360) + 540) % 360 - 180;
    assert.ok(Math.abs(d + 60) < 1e-6, `tile ${k} turned ${d.toFixed(1)}°`);
  }
  assert.equal(placed.tiles.find((x) => x.feat === 'jump').dir, 300);
});

test('trees grow denser each tap, clearings open the natural forest, powder and ice change the snow', () => {
  const { hf, surf, base } = fresh('small', 'medium', 5);
  const t = tileAt(hf, -150, 260);
  const patch = brushTiles(t.i, t.j, 3);
  const count = (tiles) => buildWorld(hf, surf, base, { tiles }).props.filter((p) => p.k === TREE).length;
  const n0 = count([]);
  const n1 = count(actOn([], patch, 'trees'));
  const n3 = count(actOn([], patch, 'trees', 'trees', 'trees'));
  assert.ok(n1 > n0 + 8 && n3 > n1 + 25, `trees: ${n0} → ${n1} → ${n3}`);
  // a clearing in the middle of a planted wood
  const wood = actOn([], patch, 'trees', 'trees', 'trees');
  const mid = brushTiles(t.i, t.j, 2);
  const c0 = tileCenter(hf, t.i, t.j);
  const near = (list) => list.filter((p) => p.k === TREE && Math.hypot(p.x - c0.x, hf.startZ + p.u - c0.z) < 9).length;
  const before = near(buildWorld(hf, surf, base, { tiles: wood }).props);
  const after = near(buildWorld(hf, surf, base, { tiles: applyAction(wood, mid, 'clear') }).props);
  assert.ok(before > 5 && after === 0, `cleared (${before} → ${after} trees)`);
  // the snow: packed everywhere, powder or ice where you put it
  const pt = tileAt(hf, 0, 300);
  const pc = tileCenter(hf, pt.i, pt.j);
  buildWorld(hf, surf, base, { tiles: actOn([], brushTiles(pt.i, pt.j, 3), 'powder') });
  assert.ok(surf.at(pc.x, pc.z).powder > 0.8, 'powder');
  buildWorld(hf, surf, base, { tiles: actOn([], brushTiles(pt.i, pt.j, 3), 'ice') });
  assert.ok(surf.at(pc.x, pc.z).ice > 0.8 && surf.at(pc.x, pc.z).powder < 0.01, 'ice');
  const packed = surf.at(60, hf.startZ + 200);
  assert.ok(packed.powder < 0.01 && packed.ice < 0.01, 'packed snow elsewhere');
});

test('the start gate goes anywhere, faces down the fall line, and nothing grows on it', () => {
  const { hf, surf, base } = fresh('small', 'medium', 5);
  // in the middle of a dense wood
  const t = tileAt(hf, 60, 300);
  const tiles = actOn([], brushTiles(t.i, t.j, 3), 'trees', 'trees', 'trees');
  const c = tileCenter(hf, t.i, t.j);
  const start = { x: c.x, z: c.z };
  assert.ok(buildWorld(hf, surf, base, { tiles }).props.some((p) => Math.hypot(p.x - start.x, hf.startZ + p.u - start.z) < GATE_CLEAR - 0.5), 'trees there without the gate');
  const w = buildWorld(hf, surf, base, { start, tiles });
  const close = w.props.filter((p) => Math.hypot(p.x - start.x, hf.startZ + p.u - start.z) < GATE_CLEAR - 0.5);
  assert.equal(close.length, 0, 'clear around the gate');
  const [dx, dz] = fallLine(hf, start.x, start.z);
  const drop = hf.heightAt(start.x, start.z) - hf.heightAt(start.x + dx * 8, start.z + dz * 8);
  assert.ok(drop > 0.5, `downhill (${drop.toFixed(2)} m over 8 m)`);
  const d = defaultStart(hf, base);
  assert.ok(d.z < hf.startZ + 60, 'the default start is near the top');
});

test('rebuilding the mountain is fast enough for every tap', () => {
  const { hf, surf, base } = fresh('medium', 'medium', 8);
  const t = tileAt(hf, 0, 500);
  const big = brushTiles(t.i, t.j, 3);
  let tiles = actOn([], big, 'raise', 'smooth');
  tiles = actOn(tiles, brushTiles(t.i, t.j + 5, 2), 'flatten', 'ice');
  tiles = actOn(tiles, brushTiles(t.i + 6, t.j, 2), 'trees', 'trees');
  tiles = actOn(tiles, brushTiles(t.i - 6, t.j + 6, 2), 'steepen', 'powder');
  tiles = applyAction(tiles, brushTiles(t.i - 6, t.j, 2), 'jump', { dir: 0 });
  const start = { x: 0, z: hf.startZ + 30 };
  buildWorld(hf, surf, base, { tiles, start });
  const t0 = performance.now();
  for (let i = 0; i < 4; i++) buildWorld(hf, surf, base, { tiles, start });
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
  buildWorld(hf, surf, base, { start, tiles: actOn([], brushTiles(t.i, t.j, 3), 'raise', 'raise') });
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

test('ice is fast and the edges barely hold', () => {
  const ice = plane(20);
  const isurf = new SurfaceMap(ice);
  isurf.ice.fill(255);
  isurf.version++;
  const packed = plane(20);
  const run = (hf, surf, steer) => {
    const sk = new Skier(hf, { x: 0, z: -hf.halfZ + 30, dir: [0, 1] });
    if (surf) sk.surface = surf;
    for (let k = 0; k < 240 * 6; k++) sk.step(1 / 240);
    for (let k = 0; k < 240 * 2; k++) {
      sk.input.steer = steer;
      sk.step(1 / 240);
    }
    return { v: sk.speed, x: sk.pos[0] };
  };
  const a = run(ice, isurf, 0);
  const b = run(packed, null, 0);
  assert.ok(a.v > b.v * 1.03, `faster on ice (${(a.v * 3.6).toFixed(0)} vs ${(b.v * 3.6).toFixed(0)} km/h)`);
  const ta = run(ice, isurf, 0.8);
  const tb = run(packed, null, 0.8);
  assert.ok(Math.abs(ta.x) < Math.abs(tb.x) * 0.8, `turns wider on ice (${ta.x.toFixed(1)} vs ${tb.x.toFixed(1)} m)`);
});

// ---------- merging and folds ----------

// the steepest pitch (degrees) in a box around world (x, z)
const steepest = (hf, x0, z0, r) => {
  let w = 0;
  const c = hf.cell;
  for (let z = z0 - r; z < z0 + r; z += c) {
    for (let x = x0 - r; x < x0 + r; x += c) {
      const g = Math.hypot(hf.heightAt(x + c, z) - hf.heightAt(x - c, z), hf.heightAt(x, z + c) - hf.heightAt(x, z - c)) / (2 * c);
      w = Math.max(w, (Math.atan(g) * 180) / Math.PI);
    }
  }
  return w;
};

test('a terrace is cut and filled with banks the snow can hold, never a cliff', () => {
  const { hf, surf, base } = fresh('small', 'gentle');
  const t = tileAt(hf, 0, 300);
  const c = tileCenter(hf, t.i, t.j);
  buildWorld(hf, surf, base, { tiles: actOn([], brushTiles(t.i, t.j, 3), 'flatten') });
  assert.ok(steepest(hf, c.x, c.z, 45) < 33, `banks of ${steepest(hf, c.x, c.z, 45).toFixed(1)}° on a 15° slope`);
  assert.ok(Math.abs(hf.heightAt(c.x, c.z - 6) - hf.heightAt(c.x, c.z + 6)) < 0.05, 'level in the middle');
  // and far from it the slope is untouched
  const nat = natural(hf, base);
  assert.ok(Math.abs(hf.heightAt(c.x + 120, c.z) - nat.heightAt(c.x + 120, c.z)) < 1e-6);
  // on a steep slope the banks stay just steeper than the slope, not a wall
  const steep = fresh('small', 'steep');
  const s = tileAt(steep.hf, 0, 300);
  const sc = tileCenter(steep.hf, s.i, s.j);
  buildWorld(steep.hf, steep.surf, steep.base, { tiles: actOn([], brushTiles(s.i, s.j, 3), 'flatten') });
  assert.ok(steepest(steep.hf, sc.x, sc.z, 60) < 42, `banks of ${steepest(steep.hf, sc.x, sc.z, 60).toFixed(1)}° on a 29° slope`);
});

test('a big raise or dig spreads its flanks: a hill and a bowl, not a tower and a pit', () => {
  const { hf, surf, base } = fresh('small', 'medium');
  const t = tileAt(hf, 0, 300);
  const c = tileCenter(hf, t.i, t.j);
  const up = [];
  for (let k = 0; k < 10; k++) up.push('raise');
  buildWorld(hf, surf, base, { tiles: actOn([], brushTiles(t.i, t.j, 2), ...up) });
  const nat = natural(hf, base);
  assert.ok(hf.heightAt(c.x, c.z) - nat.heightAt(c.x, c.z) > 9.5, 'a big hill (15 m asked, on just 7 tiles)');
  assert.ok(steepest(hf, c.x, c.z, 40) < 47, `flanks of ${steepest(hf, c.x, c.z, 40).toFixed(1)}°`);
  buildWorld(hf, surf, base, { tiles: actOn([], brushTiles(t.i, t.j, 2), ...up.map(() => 'lower')) });
  assert.ok(steepest(hf, c.x, c.z, 40) < 47, 'a bowl too');
});

test('jumps made one after the other side by side merge into one wide kicker', () => {
  const { hf, surf, base } = fresh('small', 'medium');
  const nat = natural(hf, base);
  const t = tileAt(hf, 0, 250);
  const a = tileCenter(hf, t.i, t.j);
  const b = tileCenter(hf, t.i + 1, t.j);
  const lipAcross = () => {
    let bz = 0;
    let best = 0;
    for (let dz = -6; dz < 10; dz += 0.25) {
      const v = hf.heightAt((a.x + b.x) / 2, a.z + dz) - nat.heightAt((a.x + b.x) / 2, a.z + dz);
      if (v > best) {
        best = v;
        bz = dz;
      }
    }
    const hs = [];
    for (let x = a.x - 2; x <= b.x + 2; x += 0.5) hs.push(hf.heightAt(x, a.z + bz) - nat.heightAt(x, a.z + bz));
    return [Math.min(...hs), Math.max(...hs)];
  };
  buildWorld(hf, surf, base, { tiles: applyAction(applyAction([], [[t.i, t.j]], 'jump', { dir: 0 }), [[t.i + 1, t.j]], 'jump', { dir: 0 }) });
  const [lo, hi] = lipAcross();
  assert.ok(hi - lo < 0.1, `an even lip (${lo.toFixed(2)} to ${hi.toFixed(2)} m), no double-height seam`);
});

test('folds between sections ride well: a sharp break is a lip, a dip absorbs, no wipeout', () => {
  for (const secs of [[[10, 150], [40, 150], [10, 150]], [[30, 200], [5, 60], [30, 150]], [[25, 150], [-10, 40], [25, 200]]]) {
    const hf = new Heightfield();
    const surf = new SurfaceMap(hf);
    buildSlope(hf, surf, { width: 'narrow', sections: secs.map(([slope, length]) => ({ slope, length })) });
    const sk = new Skier(hf, { x: 0, z: hf.startZ + 5, dir: [0, 1] });
    sk.props = new PropSet(hf);
    sk.surface = surf;
    for (let k = 0; k < 240 * 80 && sk.status === 'running'; k++) sk.step(1 / 240);
    assert.equal(sk.status, 'finished', secs.join(' → '));
    assert.equal(sk.wipeouts, 0, `${secs.join(' → ')}: no wipeout`);
  }
});
