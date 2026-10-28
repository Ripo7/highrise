// The snow, shaped by your tiles (tiles.js) on the hexagon grid (hex.js). Nothing is
// stamped tile by tile: the tiles of one action make one mask, the mask is blurred into a
// smooth field, and the field shapes the snow. So tiles side by side are one shape (a row
// of raised tiles is a ridge, a cluster a hill, raised beside lowered rolls into it), with
// no seam, step or hexagon corner anywhere.
//
// In order, on the wild mountain:
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
import { HEX_R, hexAt, hexCenter, hexCols, hexRows, hexDisk, hexLine } from './hex.js';

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
 * Shape the snow with the tiles (hf is changed in place; it holds the wild mountain when
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

  // flatten: each group levelled to its own average height, with banks just outside it
  for (const group of groupBy(pick((t) => t.flat), (t) => t.flat)) {
    const W = tileField(hf, group, 4);
    if (!W) continue;
    const inGroup = new Set(group.map((t) => key(t.i, t.j)));
    let sum = 0;
    let n = 0;
    for (let jj = 0; jj < W.h; jj++) {
      const j = W.j0 + jj;
      const u = j * cell - hf.halfZ - hf.startZ;
      for (let ii = 0; ii < W.w; ii++) {
        const i = W.i0 + ii;
        const t = hexAt(i * cell, u);
        if (inGroup.has(key(t.i, t.j))) {
          sum += h[j * nx + i];
          n++;
        }
      }
    }
    if (!n) continue;
    const level = sum / n;
    for (let jj = 0; jj < W.h; jj++) {
      const row = (W.j0 + jj) * nx + W.i0;
      for (let ii = 0; ii < W.w; ii++) {
        const k = smoothstep(0.12, 0.55, W.f[jj * W.w + ii]);
        if (k) h[row + ii] += (level - h[row + ii]) * k;
      }
    }
  }

  // raise / lower: metre for metre in the middle of an area, rounded off at its edges
  const Fl = tileField(hf, pick((t) => t.lift), 3.5, 3.5, (t) => t.lift);
  if (Fl) {
    for (let jj = 0; jj < Fl.h; jj++) {
      const row = (Fl.j0 + jj) * nx + Fl.i0;
      for (let ii = 0; ii < Fl.w; ii++) {
        const v = Fl.f[jj * Fl.w + ii];
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

  // jumps and drops: one per group, facing its own way
  const kickers = [];
  for (const group of groupBy(pick((t) => (t.feat === 'jump' || t.feat === 'drop') && t.g), (t) => t.g)) {
    const k = shapeFeature(hf, group, group[0].feat, group[0].dir);
    if (k && group[0].feat === 'jump') kickers.push(k);
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
 * tiles set how wide it is (across its facing) and how long: a longer one is bigger.
 *   jump: a concave ramp up to a lip near the far edge, then the snow falls away behind it
 *   drop: the snow shelves up to an edge, falls sharply, and a landing eases back below
 * Added to hf. Returns the footprint (a field of 0..1) for a jump, so world.js keeps snow
 * on its steep back instead of baring rock.
 */
function shapeFeature(hf, tiles, kind, dirDeg) {
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
  // jump: the ramp curves up harder on a long one, so every lip kicks out at about 24°
  const P = Math.max(1.6, Math.min(3.5, (0.45 * L) / H));
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

  // across: as wide as the tiles, measured on the line back inside them
  const M = tileField(hf, tiles, 1.5);
  if (!M) return null;
  const { cell, nx, h } = hf;
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
  for (let j = j0; j <= j1; j++) {
    const z = j * cell - hf.halfZ;
    for (let i = i0; i <= i1; i++) {
      const x = i * cell - hf.halfX;
      const t = x * dx + z * dz;
      if (t < tMin - 7 || t > tMax + reach) continue;
      const tc = Math.max(t0, Math.min(t1, t));
      const qx = x - dx * (t - tc);
      const qz = z - dz * (t - tc);
      const m = fieldAt(M, Math.round((qx + hf.halfX) / cell), Math.round((qz + hf.halfZ) / cell));
      if (m < 0.005) continue;
      const v = m * profile(t);
      if (!v) continue;
      h[j * nx + i] = Math.max(MIN_H, Math.min(MAX_H, h[j * nx + i] + v));
      if (kind === 'jump' && v > 0.05) foot.f[(j - j0) * w + (i - i0)] = Math.min(1, m * 1.5);
    }
  }
  return foot;
}
