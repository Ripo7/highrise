// The snow, shaped by your tiles (tiles.js) on the hexagon grid (hex.js). Nothing is
// stamped tile by tile: the tiles of one action make one mask, the mask is blurred into a
// smooth field, and the field shapes the snow. So tiles side by side are one shape (a row
// of raised tiles is a ridge, a cluster a hill, raised beside lowered rolls into it), with
// no seam, step or hexagon corner anywhere.
//
// In order, on the bare slope you designed (slopes.js):
//   steepen / ease and rock bands   change the slope down the fall line, then ease back
//   flatten                         each group levelled to its own average height
//   raise / lower                   the snow lifted or dug, metre for metre
//   smooth                          rolls and lumps blurred away
//   jumps and drops                 one kicker (or step) per group, facing its way
//   powder                          soft pillows in the snow
// and for the rest of the world (world.js): where the rock, powder, ice, clearings and
// planted trees are, and where kickers keep their snow.

import { smoothstep, MIN_H, MAX_H, makeValueNoise } from './heightfield.js';
import { TREE, rng } from './props.js';
import { HEX_R, HEX_W, hexAt, hexCenter, hexCols, hexRows, hexDisk, hexLine } from './hex.js';

export { HEX_R };

export const gridCols = (hf) => hexCols(hf.sizeX);
export const gridRows = (hf) => hexRows(hf.finishZ - hf.startZ);
// the tile at world (x, z), and the world centre of a tile
export const tileOf = (hf, x, z) => hexAt(x + hf.halfX, z - hf.startZ);
export function tileCenter(hf, i, j) {
  const [x, u] = hexCenter(i, j);
  return { x: x - hf.halfX, z: hf.startZ + u };
}
const key = (i, j) => `${i},${j}`;

// the tiles a brush covers around tile (i, j): size 1 is the tile, 2 adds its six
// neighbours (7 tiles), 3 the ring around those (19)
export const BRUSH_TILES = [1, 7, 19];
export const brushTiles = (i, j, size) => hexDisk(i, j, Math.max(0, size - 1));

// tiles along a straight line between two tiles (inclusive), so a fast drag leaves no gaps
export const lineTiles = (a, b) => hexLine(a, b);

// Saves from before the hexagons painted 10 m squares: every hexagon takes the pieces of
// the square its centre was in, so the shapes stay where they were.
export function squaresToHexes(pieces, cols, rows) {
  const at = new Map();
  for (const p of pieces) {
    const k = key(p.i, p.j);
    if (!at.has(k)) at.set(k, []);
    at.get(k).push(p.k);
  }
  if (!at.size) return [];
  const out = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const [x, u] = hexCenter(i, j);
      const ks = at.get(key(Math.floor(x / 10), Math.floor(u / 10)));
      if (ks) for (const k of ks) out.push({ k, i, j });
    }
  }
  return out;
}

// ---------- fields ----------

/**
 * Some tiles as a smooth field over the heightfield cells: val(tile) inside each tile (1 by
 * default), easing to 0 over about sx metres across and sz metres along the slope outside
 * (so corners round off and neighbours run together). Computed over the tiles' bounding
 * box plus a margin. Returns { i0, j0, w, h, f } or null when there are no tiles.
 */
export function tileField(hf, tiles, sx, sz = sx, val = null) {
  if (!tiles.length) return null;
  let ti0 = Infinity;
  let ti1 = -Infinity;
  let tj0 = Infinity;
  let tj1 = -Infinity;
  let x0 = Infinity;
  let x1 = -Infinity;
  let u0 = Infinity;
  let u1 = -Infinity;
  for (const p of tiles) {
    if (p.i < ti0) ti0 = p.i;
    if (p.i > ti1) ti1 = p.i;
    if (p.j < tj0) tj0 = p.j;
    if (p.j > tj1) tj1 = p.j;
    const [x, u] = hexCenter(p.i, p.j);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
  }
  const { cell, halfZ, startZ } = hf;
  const mx = 3 * sx + cell + HEX_R;
  const mz = 3 * sz + cell + HEX_R;
  const i0 = Math.max(0, Math.floor((x0 - mx) / cell));
  const i1 = Math.min(hf.nx - 1, Math.ceil((x1 + mx) / cell));
  const j0 = Math.max(0, Math.floor((startZ + halfZ + u0 - mz) / cell));
  const j1 = Math.min(hf.nz - 1, Math.ceil((startZ + halfZ + u1 + mz) / cell));
  const w = i1 - i0 + 1;
  const h = j1 - j0 + 1;
  if (w < 1 || h < 1) return null;
  // the mask, tile by tile, on the cells (only near the tiles: a margin of one tile)
  const cols = ti1 - ti0 + 1;
  const rows = tj1 - tj0 + 1;
  const on = new Float32Array(cols * rows);
  const has = new Uint8Array(cols * rows);
  for (const p of tiles) {
    const q = (p.j - tj0) * cols + (p.i - ti0);
    on[q] = val ? val(p) : 1;
    has[q] = 1;
  }
  const f = new Float32Array(w * h);
  const ci0 = Math.max(0, Math.floor((x0 - HEX_R) / cell) - i0);
  const ci1 = Math.min(w - 1, Math.ceil((x1 + HEX_R) / cell) - i0);
  const cj0 = Math.max(0, Math.floor((startZ + halfZ + u0 - HEX_R) / cell) - j0);
  const cj1 = Math.min(h - 1, Math.ceil((startZ + halfZ + u1 + HEX_R) / cell) - j0);
  for (let jj = cj0; jj <= cj1; jj++) {
    const u = (j0 + jj) * cell - halfZ - startZ;
    for (let ii = ci0; ii <= ci1; ii++) {
      const t = hexAt((i0 + ii) * cell, u);
      const ti = t.i - ti0;
      const tj = t.j - tj0;
      if (ti >= 0 && tj >= 0 && ti < cols && tj < rows && has[tj * cols + ti]) f[jj * w + ii] = on[tj * cols + ti];
    }
  }
  // three box blurs make a near-gaussian falloff
  const rx = Math.max(1, Math.round((Math.sqrt(4 * (sx / cell) ** 2 + 1) - 1) / 2));
  const rz = Math.max(1, Math.round((Math.sqrt(4 * (sz / cell) ** 2 + 1) - 1) / 2));
  const tmp = new Float32Array(Math.max(w, h));
  for (let pass = 0; pass < 3; pass++) {
    for (let jj = 0; jj < h; jj++) boxLine(f, jj * w, 1, w, rx, tmp);
    for (let ii = 0; ii < w; ii++) boxLine(f, ii, w, h, rz, tmp);
  }
  return { i0, j0, w, h, f };
}

// running-sum box blur of one row or column in place (zero outside)
function boxLine(a, start, stride, n, r, tmp) {
  for (let k = 0; k < n; k++) tmp[k] = a[start + k * stride];
  const inv = 1 / (2 * r + 1);
  let s = 0;
  for (let k = 0; k <= r && k < n; k++) s += tmp[k];
  for (let k = 0; k < n; k++) {
    a[start + k * stride] = s * inv;
    const add = k + r + 1;
    const sub = k - r;
    if (add < n) s += tmp[add];
    if (sub >= 0) s -= tmp[sub];
  }
}

// the same, but the ends carry on as they are (for heights: no pull towards zero)
function boxLineClamped(a, start, stride, n, r, tmp) {
  for (let k = 0; k < n; k++) tmp[k] = a[start + k * stride];
  const at = (k) => tmp[k < 0 ? 0 : k >= n ? n - 1 : k];
  const inv = 1 / (2 * r + 1);
  let s = 0;
  for (let k = -r; k <= r; k++) s += at(k);
  for (let k = 0; k < n; k++) {
    a[start + k * stride] = s * inv;
    s += at(k + r + 1) - at(k - r);
  }
}

const fieldAt = (F, i, j) => {
  if (!F) return 0;
  const ii = i - F.i0;
  const jj = j - F.j0;
  return ii < 0 || jj < 0 || ii >= F.w || jj >= F.h ? 0 : F.f[jj * F.w + ii];
};

// reusable work buffers (the mountain is rebuilt on every action)
const scratchBufs = {};
function scratch(name, n) {
  const b = scratchBufs[name];
  if (b && b.length === n) return b;
  return (scratchBufs[name] = new Float32Array(n));
}

export const LIFT_SHARP = 3; // metres of a raise or a dig with tight edges; beyond, wide flanks
const BANK = Math.tan((30 * Math.PI) / 180); // the steepest a flatten's banks get (snow sits at about that)

/**
 * Level a flatten group to its average height: cut where the snow was above it, fill where
 * it was below. Around it the snow goes back to the slope with banks: never steeper than
 * BANK (or a little steeper than the slope itself, on a slope steeper than that), rounded
 * where they leave the terrace and where they meet the snow, and as long as they need to
 * be: a terrace on a steep slope has tall, long banks, never a cliff or a step.
 */
function flattenGroup(hf, group) {
  const { h, nx, nz, cell, halfZ, startZ } = hf;
  // the terrace: the tiles with their outline rounded (half way up their blurred mask), so
  // its edge and its banks are smooth curves, not the zigzag of the hexagons
  const M = tileField(hf, group, 5.5);
  if (!M) return;
  const inside = (i, j) => fieldAt(M, i, j) >= 0.5;
  let x0 = Infinity;
  let x1 = -Infinity;
  let u0 = Infinity;
  let u1 = -Infinity;
  for (const t of group) {
    const [x, u] = hexCenter(t.i, t.j);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
  }
  // the level, and how steep the slope is round about (banks must beat it to meet it)
  let sum = 0;
  let n = 0;
  const ci0 = Math.max(0, Math.floor((x0 - HEX_R) / cell));
  const ci1 = Math.min(nx - 1, Math.ceil((x1 + HEX_R) / cell));
  const cj0 = Math.max(0, Math.floor((startZ + halfZ + u0 - HEX_R) / cell));
  const cj1 = Math.min(nz - 1, Math.ceil((startZ + halfZ + u1 + HEX_R) / cell));
  let grade = 0;
  for (let j = cj0; j <= cj1; j++) {
    for (let i = ci0; i <= ci1; i++) {
      if (!inside(i, j)) continue;
      const q = j * nx + i;
      sum += h[q];
      n++;
      if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) grade = Math.max(grade, Math.hypot(h[q + 1] - h[q - 1], h[q + nx] - h[q - nx]) / (2 * cell));
    }
  }
  if (!n) return;
  const level = sum / n;
  const m = Math.max(BANK, 1.35 * grade);
  const knee = 5; // metres over which a bank rounds into the snow
  // grow the area until its edge is untouched (the banks have met the snow everywhere)
  for (let margin = 30; ; margin *= 2) {
    const i0 = Math.max(0, Math.floor((x0 - HEX_R - margin) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((x1 + HEX_R + margin) / cell));
    const j0 = Math.max(0, Math.floor((startZ + halfZ + u0 - HEX_R - margin) / cell));
    const j1 = Math.min(nz - 1, Math.ceil((startZ + halfZ + u1 + HEX_R + margin) / cell));
    const w = i1 - i0 + 1;
    const hh = j1 - j0 + 1;
    // distance from the terrace, in metres (two-pass chamfer)
    const d = scratch('dist', w * hh);
    for (let jj = 0; jj < hh; jj++) {
      for (let ii = 0; ii < w; ii++) d[jj * w + ii] = inside(i0 + ii, j0 + jj) ? 0 : 1e9;
    }
    chamfer(d, w, hh, cell);
    // the mask is cell by cell: smooth the distance a little, or the banks would start in
    // stair steps along the terrace's edge (and the light would show every one of them)
    const tmp = scratch('tmp', Math.max(w, hh));
    const rb = Math.max(1, Math.round(2.5 / cell));
    for (let pass = 0; pass < 2; pass++) {
      for (let jj = 0; jj < hh; jj++) boxLineClamped(d, jj * w, 1, w, rb, tmp);
      for (let ii = 0; ii < w; ii++) boxLineClamped(d, ii, w, hh, rb, tmp);
    }
    // the shape it makes: on the terrace, the level; off it, the snow, held within a bank
    let edgeTouched = false;
    const out = scratch('flat', w * hh);
    for (let jj = 0; jj < hh; jj++) {
      for (let ii = 0; ii < w; ii++) {
        const q = (j0 + jj) * nx + i0 + ii;
        const dd = d[jj * w + ii];
        const x = h[q] - level;
        // a bank that starts flat off the terrace, then holds its angle
        const lim = (m * dd * dd) / (dd + 4);
        const ax = Math.abs(x);
        let v = ax;
        if (ax > lim - knee) {
          // smooth minimum of |x| and the bank: exactly |x| until within a knee of it
          const k = Math.max(0, knee - Math.abs(ax - lim)) / knee;
          v = Math.min(ax, lim) - (k * k * knee) / 4;
          if (Math.max(0, v) !== ax) {
            const onEdge = ii === 0 || jj === 0 || ii === w - 1 || jj === hh - 1;
            const atBorder = (ii === 0 && i0 === 0) || (jj === 0 && j0 === 0) || (ii === w - 1 && i1 === nx - 1) || (jj === hh - 1 && j1 === nz - 1);
            if (onEdge && !atBorder) edgeTouched = true;
          }
        }
        out[jj * w + ii] = level + Math.sign(x) * Math.max(0, v);
      }
    }
    if (edgeTouched && margin < 240) continue;
    for (let jj = 0; jj < hh; jj++) h.set(out.subarray(jj * w, jj * w + w), (j0 + jj) * nx + i0);
    return;
  }
}

// distance transform in place: 0 on the set, else the distance to it (metres), 8 neighbours
function chamfer(d, w, h, cell) {
  const a = cell;
  const b = cell * Math.SQRT2;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const q = j * w + i;
      let v = d[q];
      if (i > 0) v = Math.min(v, d[q - 1] + a);
      if (j > 0) {
        v = Math.min(v, d[q - w] + a);
        if (i > 0) v = Math.min(v, d[q - w - 1] + b);
        if (i < w - 1) v = Math.min(v, d[q - w + 1] + b);
      }
      d[q] = v;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const q = j * w + i;
      let v = d[q];
      if (i < w - 1) v = Math.min(v, d[q + 1] + a);
      if (j < h - 1) {
        v = Math.min(v, d[q + w] + a);
        if (i < w - 1) v = Math.min(v, d[q + w + 1] + b);
        if (i > 0) v = Math.min(v, d[q + w - 1] + b);
      }
      d[q] = v;
    }
  }
}

// The jumps and drops, as the ones to shape: a group is the tiles made together, and
// groups that touch, of the same kind and facing the same way, are one (two jumps made one
// after the other side by side are one wide jump, not two with a seam)
function featureGroups(tiles) {
  const at = new Map(tiles.map((t, k) => [key(t.i, t.j), k]));
  const parent = tiles.map((_, k) => k);
  const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const join = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const byGroup = new Map();
  tiles.forEach((t, k) => {
    if (byGroup.has(t.g)) join(k, byGroup.get(t.g));
    else byGroup.set(t.g, k);
    for (const [i, j] of hexDisk(t.i, t.j, 1)) {
      const o = at.get(key(i, j));
      if (o === undefined || o === k) continue;
      const u = tiles[o];
      const dd = Math.abs(((u.dir - t.dir + 540) % 360) - 180);
      if (u.feat === t.feat && dd < 1) join(k, o);
    }
  });
  const out = new Map();
  tiles.forEach((t, k) => {
    const r = find(k);
    if (!out.has(r)) out.set(r, []);
    out.get(r).push(t);
  });
  return [...out.values()];
}

const groupBy = (list, f) => {
  const m = new Map();
  for (const t of list) {
    const k = f(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
};

/**
 * Shape the snow with the tiles (hf is changed in place; it holds the bare slope when
 * this is called). Returns what the rest of the world needs: the rock, powder, ice,
 * clearing and no-trees fields, the kickers' footprints (they keep their snow however
 * steep), and the planted trees.
 */
export function applyTerrain(hf, tiles) {
  const { h, nx, nz, cell } = hf;
  const pick = (f) => tiles.filter(f);

  // steepen / ease and rock bands change the slope along the fall line: walk down each
  // column, steering the height by how much of each field is there, then ease back to the
  // mountain below them (an eased pitch leaves a lip, a steeper one a gentler run-out)
  const pitchT = pick((t) => t.pitch);
  const Fpm = tileField(hf, pitchT, 6, 5);
  const Fpv = tileField(hf, pitchT, 6, 5, (t) => (t.pitch < 0 ? 0.8 : 0.9) * (t.pitch / 3));
  const Fr = tileField(hf, pick((t) => t.feat === 'rocks'), 5, 1.5);
  const slopeFields = [Fpm, Fr].filter(Boolean);
  if (slopeFields.length) {
    let i0 = nx;
    let i1 = -1;
    let j0 = nz;
    let j1 = -1;
    for (const F of slopeFields) {
      i0 = Math.min(i0, F.i0);
      i1 = Math.max(i1, F.i0 + F.w - 1);
      j0 = Math.min(j0, F.j0);
      j1 = Math.max(j1, F.j0 + F.h - 1);
    }
    j1 = Math.min(nz - 1, j1 + Math.ceil(160 / cell));
    const w = i1 - i0 + 1;
    const hh = j1 - j0 + 1;
    const D = new Float32Array(w * hh);
    for (let ii = 0; ii < w; ii++) {
      const i = i0 + ii;
      let delta = 0;
      for (let jj = 0; jj < hh - 1; jj++) {
        const j = j0 + jj;
        const fp = fieldAt(Fpv, i, j);
        const fr = fieldAt(Fr, i, j);
        const g = h[(j + 1) * nx + i] - h[j * nx + i]; // how the snow drops over this cell
        // a hexagon row is a little shallower than a 10 m square: rock bands cut a bit more
        const inc = fp * g - 0.95 * fr * cell;
        const cover = Math.min(1, fieldAt(Fpm, i, j) + fr);
        delta += inc - delta * (1 - cover) * (cell / Math.max(20, 3 * Math.abs(delta)));
        D[(jj + 1) * w + ii] = delta;
      }
    }
    // soften across the slope so the sides of a shelf or a band are banks, not steps
    const tmp = new Float32Array(Math.max(w, hh));
    const r = Math.max(1, Math.round(3 / cell));
    for (let pass = 0; pass < 2; pass++) for (let jj = 0; jj < hh; jj++) boxLine(D, jj * w, 1, w, r, tmp);
    for (let jj = 0; jj < hh; jj++) {
      const row = (j0 + jj) * nx;
      for (let ii = 0; ii < w; ii++) {
        const v = D[jj * w + ii];
        if (v) h[row + i0 + ii] = Math.max(MIN_H, Math.min(MAX_H, h[row + i0 + ii] + v));
      }
    }
  }

  // flatten: each group levelled to its own average height, cut into the slope and built
  // up from it, with banks back to the snow around (see flattenGroup)
  for (const group of groupBy(pick((t) => t.flat), (t) => t.flat)) flattenGroup(hf, group);

  // raise / lower: metre for metre in the middle of an area, rounded off at its edges. The
  // first 3 m have tight edges (a bump, a roller); anything more spreads its flanks wider,
  // so a big hill or a deep bowl has slopes you can ride, not walls
  const liftT = pick((t) => t.lift);
  const sharp = (t) => Math.max(-LIFT_SHARP, Math.min(LIFT_SHARP, t.lift));
  for (const F of [tileField(hf, liftT, 3.5, 3.5, sharp), tileField(hf, liftT.filter((t) => Math.abs(t.lift) > LIFT_SHARP), 9, 9, (t) => t.lift - sharp(t))]) {
    if (!F) continue;
    for (let jj = 0; jj < F.h; jj++) {
      const row = (F.j0 + jj) * nx + F.i0;
      for (let ii = 0; ii < F.w; ii++) {
        const v = F.f[jj * F.w + ii];
        if (v) h[row + ii] = Math.max(MIN_H, Math.min(MAX_H, h[row + ii] + v));
      }
    }
  }

  // smooth: blend towards a blurred copy of the snow (it keeps the overall slope, the rolls
  // and lumps go)
  const Fs = tileField(hf, pick((t) => t.smooth), 5, 5, (t) => t.smooth / 3);
  if (Fs) {
    const B = new Float32Array(Fs.w * Fs.h);
    for (let jj = 0; jj < Fs.h; jj++) B.set(h.subarray((Fs.j0 + jj) * nx + Fs.i0, (Fs.j0 + jj) * nx + Fs.i0 + Fs.w), jj * Fs.w);
    const r = Math.max(1, Math.round(4 / cell));
    const tmp = new Float32Array(Math.max(Fs.w, Fs.h));
    for (let pass = 0; pass < 3; pass++) {
      for (let jj = 0; jj < Fs.h; jj++) boxLineClamped(B, jj * Fs.w, 1, Fs.w, r, tmp);
      for (let ii = 0; ii < Fs.w; ii++) boxLineClamped(B, ii, Fs.w, Fs.h, r, tmp);
    }
    for (let jj = 0; jj < Fs.h; jj++) {
      const row = (Fs.j0 + jj) * nx + Fs.i0;
      for (let ii = 0; ii < Fs.w; ii++) {
        const k = Math.min(1, 1.25 * Fs.f[jj * Fs.w + ii]);
        if (k) h[row + ii] += (B[jj * Fs.w + ii] - h[row + ii]) * k;
      }
    }
  }

  // jumps and drops: one per group, facing its own way. Side by side they merge (the
  // highest rise and the deepest dip win, so two kickers next to each other make one wide
  // kicker, not a double-height seam between them)
  const kickers = [];
  const featGroups = featureGroups(pick((t) => (t.feat === 'jump' || t.feat === 'drop') && t.g));
  if (featGroups.length) {
    const acc = { up: scratch('up', nx * nz), down: scratch('down', nx * nz), i0: nx, i1: -1, j0: nz, j1: -1 };
    for (const group of featGroups) {
      const k = shapeFeature(hf, group, group[0].feat, group[0].dir, acc);
      if (k && group[0].feat === 'jump') kickers.push(k);
    }
    for (let j = acc.j0; j <= acc.j1; j++) {
      for (let i = acc.i0; i <= acc.i1; i++) {
        const q = j * nx + i;
        const v = acc.up[q] + acc.down[q];
        if (v) h[q] = Math.max(MIN_H, Math.min(MAX_H, h[q] + v));
        acc.up[q] = 0;
        acc.down[q] = 0;
      }
    }
  }

  // powder: soft pillows in the snow
  const Fp = tileField(hf, pick((t) => t.snow === 'powder'), 4);
  if (Fp) {
    const pn = makeValueNoise(991);
    for (let jj = 0; jj < Fp.h; jj++) {
      const j = Fp.j0 + jj;
      const z = j * cell - hf.halfZ;
      for (let ii = 0; ii < Fp.w; ii++) {
        const v = Fp.f[jj * Fp.w + ii];
        if (v < 0.01) continue;
        const i = Fp.i0 + ii;
        const x = i * cell - hf.halfX;
        const p = pn(x * 0.16, z * 0.16);
        h[j * nx + i] += v * (0.55 * Math.max(0, p) + 0.15);
      }
    }
  }

  // trees: on a jittered 5 m grid, more of them the denser the tiles, thinning out at the
  // edges; each spot has its own random numbers, so planting more doesn't move the trees
  const trees = [];
  const Ft = tileField(hf, pick((t) => t.trees), 5, 5, (t) => t.trees / 3);
  if (Ft) {
    const step = 5;
    const x0 = Ft.i0 * cell - hf.halfX;
    const x1 = (Ft.i0 + Ft.w) * cell - hf.halfX;
    const u0 = Ft.j0 * cell - hf.halfZ - hf.startZ;
    const u1 = (Ft.j0 + Ft.h) * cell - hf.halfZ - hf.startZ;
    for (let gu = Math.floor(u0 / step); gu * step < u1; gu++) {
      for (let gx = Math.floor(x0 / step); gx * step < x1; gx++) {
        const r = rng(((gx * 73856093) ^ (gu * 19349663)) >>> 0);
        const px = (gx + r()) * step;
        const pu = (gu + r()) * step;
        const [ci, cj] = hf.toGrid(px, hf.startZ + pu);
        const v = fieldAt(Ft, Math.round(ci), Math.round(cj));
        if (v > 0.04 && r() < 0.85 * Math.pow(Math.min(1, v), 1.1)) trees.push({ k: TREE, u: pu, x: px, s: 0.7 + r() * 0.75, r: r() * 6.283 });
      }
    }
  }

  return {
    rock: Fr,
    powder: Fp,
    ice: tileField(hf, pick((t) => t.snow === 'ice'), 4),
    clearing: tileField(hf, pick((t) => t.clear), 5),
    // no trees on a jump or a drop (nor right around them)
    noTrees: tileField(hf, pick((t) => t.feat === 'jump' || t.feat === 'drop'), 3),
    kickers,
    trees,
    fieldAt,
  };
}

/**
 * A jump or a drop from a group of tiles, facing dirDeg (0 = down the map, 90 = +x). The
 * tiles set how wide it is (their span across its facing) and how long (their span along
 * it): a longer one is bigger.
 *   jump: a concave ramp up to a lip near the far edge, then the snow falls away behind it
 *   drop: the snow shelves up to an edge, falls sharply, and a landing eases back below
 * Its rises and dips go into acc.up / acc.down (the highest and the deepest of all the
 * features), which applyTerrain adds to the snow. Returns the footprint (a field of 0..1)
 * for a jump, so world.js keeps snow on its steep back instead of baring rock.
 */
function shapeFeature(hf, tiles, kind, dirDeg, acc) {
  const th = (dirDeg * Math.PI) / 180;
  const dx = Math.sin(th);
  const dz = Math.cos(th);
  const centres = tiles.map((t) => tileCenter(hf, t.i, t.j));
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const c of centres) {
    const t = c.x * dx + c.z * dz;
    t0 = Math.min(t0, t);
    t1 = Math.max(t1, t);
  }
  const tMin = t0 - 0.9 * HEX_R;
  const tMax = t1 + 0.5 * HEX_R;
  const L = tMax - tMin;
  const H = Math.max(1.4, Math.min(4.5, 0.22 * L)); // jump: lip height
  // jump: the ramp curves up harder on a long one, and its lip kicks out a little steeper
  // the bigger it is (about 22° on one tile, 29° on the biggest)
  const lip = 0.4 + 0.05 * (H - 1.4);
  const P = Math.max(1.6, Math.min(3.8, (lip * L) / H));
  const K = 1.6 + 0.7 * H; // jump: how far behind the lip the snow is back to the slope
  const D = Math.max(2, Math.min(5, 1.6 + 0.12 * L)); // drop: the step
  const reach = kind === 'jump' ? K + 2 : 1.2 + 4 * D + 2;
  const profile =
    kind === 'jump'
      ? (t) => {
          if (t <= tMin) return 0;
          if (t <= tMax) return H * Math.pow((t - tMin) / L, P);
          return H * (1 - smoothstep(tMax, tMax + K, t));
        }
      : (t) => (D / 2) * smoothstep(tMin - 6, tMax - 1, t) - D * smoothstep(tMax, tMax + 1.2, t) + (D / 2) * smoothstep(tMax + 1.2, tMax + 1.2 + 4 * D, t);

  // across: as wide as the tiles side by side (a column of tiles zigzags down the rows, so
  // it's the span of all of them, the same all along its length: a clean kicker)
  const px = dz;
  const pz = -dx;
  const hw = 0.5 * (HEX_W / 2 + HEX_R); // a hexagon's half width, between flats and corners
  // the tiles' spans across, merged where they touch: one plateau, no dip at the seams
  const spans = [];
  for (const ak of centres.map((c) => c.x * px + c.z * pz).sort((p, q) => p - q)) {
    const last = spans[spans.length - 1];
    if (last && ak - hw <= last[1]) last[1] = Math.max(last[1], ak + hw);
    else spans.push([ak - hw, ak + hw]);
  }
  const coverage = (a) => {
    let m = 0;
    for (const [A, B] of spans) m = Math.max(m, smoothstep(A - 1.2, A + 1.2, a) * (1 - smoothstep(B - 1.2, B + 1.2, a)));
    return m;
  };
  const { cell, nx } = hf;
  let xa = Infinity;
  let xb = -Infinity;
  let za = Infinity;
  let zb = -Infinity;
  for (const c of centres) {
    xa = Math.min(xa, c.x);
    xb = Math.max(xb, c.x);
    za = Math.min(za, c.z);
    zb = Math.max(zb, c.z);
  }
  const pad = HEX_R + 8 + reach;
  const i0 = Math.max(0, Math.floor((xa - pad + hf.halfX) / cell));
  const i1 = Math.min(hf.nx - 1, Math.ceil((xb + pad + hf.halfX) / cell));
  const j0 = Math.max(0, Math.floor((za - pad + hf.halfZ) / cell));
  const j1 = Math.min(hf.nz - 1, Math.ceil((zb + pad + hf.halfZ) / cell));
  const w = i1 - i0 + 1;
  const foot = { i0, j0, w, h: j1 - j0 + 1, f: new Float32Array(w * (j1 - j0 + 1)) };
  acc.i0 = Math.min(acc.i0, i0);
  acc.i1 = Math.max(acc.i1, i1);
  acc.j0 = Math.min(acc.j0, j0);
  acc.j1 = Math.max(acc.j1, j1);
  for (let j = j0; j <= j1; j++) {
    const z = j * cell - hf.halfZ;
    for (let i = i0; i <= i1; i++) {
      const x = i * cell - hf.halfX;
      const t = x * dx + z * dz;
      if (t < tMin - 7 || t > tMax + reach) continue;
      const m = coverage(x * px + z * pz);
      if (m < 0.005) continue;
      const v = m * profile(t);
      if (!v) continue;
      const q = j * nx + i;
      if (v > 0) acc.up[q] = Math.max(acc.up[q], v);
      else acc.down[q] = Math.min(acc.down[q], v);
      if (kind === 'jump' && v > 0.05) foot.f[(j - j0) * w + (i - i0)] = Math.min(1, m * 1.5);
    }
  }
  return foot;
}
