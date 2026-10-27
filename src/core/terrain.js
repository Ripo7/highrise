// Terrain pieces: shapes you paint onto the mountain on a 10 m grid. They don't stamp a
// shape per tile: all the tiles of one kind make one mask, the mask is blurred into a
// smooth field, and the field shapes the snow. So pieces side by side are one shape (a row
// of bumps is a ridge, a block of them a hill, bumps beside a hollow roll into it), with no
// seam, step or edge anywhere, and a piste across them simply follows the snow.
//
//   bump / hollow   raise or dig the snow (bigger areas grow higher or deeper in the middle)
//   flat            the slope eases off: a shelf, with a lip at its lower edge
//   wall            the slope gets steeper, easing back below
//   rocks           a band of rock: a cliff face across the slope, a run-out below it
//   forest          trees (they join any forest around them)
//   clearing        no trees: opens up the natural forest
//   powder          deep untouched snow, even on a piste
//
// Each tile holds one shape (bump, hollow, flat, wall or rocks), one cover (forest or
// clearing) and powder or not: three layers, so trees can grow on a bump.
//
//   piece: { k, i, j }: tile column i (from the left edge), row j (from the top line)

import { smoothstep, MIN_H, MAX_H, makeValueNoise } from './heightfield.js';
import { TREE, rng } from './props.js';

export const TILE = 10;

export const KINDS = {
  bump: { cat: 'terrain', layer: 's', label: 'Bump', hint: 'Raises the snow. Side by side: a ridge, a hill.' },
  hollow: { cat: 'terrain', layer: 's', label: 'Hollow', hint: 'Digs the snow. Together: a bowl, a gully.' },
  flat: { cat: 'terrain', layer: 's', label: 'Flat', hint: 'The slope eases off: a shelf with a lip below.' },
  wall: { cat: 'terrain', layer: 's', label: 'Wall', hint: 'A steeper pitch, easing back below.' },
  rocks: { cat: 'terrain', layer: 's', label: 'Rocks', hint: 'A rock band: a cliff to drop off.' },
  forest: { cat: 'nature', layer: 'c', label: 'Forest', hint: 'Pines. They join the forest around.' },
  clearing: { cat: 'nature', layer: 'c', label: 'Clearing', hint: 'Opens up the forest.' },
  powder: { cat: 'nature', layer: 'p', label: 'Powder', hint: 'Deep untouched snow, even on a piste.' },
};

export const gridCols = (hf) => Math.floor(hf.sizeX / TILE);
export const gridRows = (hf) => Math.floor((hf.finishZ - hf.startZ) / TILE);
export const tileOf = (hf, x, z) => ({ i: Math.floor((x + hf.halfX) / TILE), j: Math.floor((z - hf.startZ) / TILE) });
const key = (i, j) => `${i},${j}`;
const layer = (k) => KINDS[k].layer;

// ---------- editing ----------

// Add pieces; whatever is on the same layer of those tiles is replaced. Returns a new list.
export function placeTiles(pieces, add, cols, rows) {
  const ok = add.filter((p) => KINDS[p.k] && p.i >= 0 && p.j >= 0 && p.i < cols && p.j < rows);
  if (!ok.length) return pieces;
  const fresh = new Map();
  for (const p of ok) fresh.set(`${layer(p.k)}:${key(p.i, p.j)}`, { k: p.k, i: p.i, j: p.j });
  const kept = pieces.filter((p) => !fresh.has(`${layer(p.k)}:${key(p.i, p.j)}`));
  return kept.concat([...fresh.values()]);
}

// Remove every piece on these tiles (all layers). Returns a new list.
export function eraseTiles(pieces, tiles) {
  const t = new Set(tiles.map(([i, j]) => key(i, j)));
  const out = pieces.filter((p) => !t.has(key(p.i, p.j)));
  return out.length === pieces.length ? pieces : out;
}

// the tiles a brush of `size` tiles covers around tile (i, j)
export function brushTiles(i, j, size) {
  const out = [];
  const a = Math.floor((size - 1) / 2);
  for (let dj = 0; dj < size; dj++) for (let di = 0; di < size; di++) out.push([i - a + di, j - a + dj]);
  return out;
}

// tiles along a straight line between two tiles (inclusive), so a fast drag leaves no gaps
export function lineTiles(a, b) {
  const out = [];
  const n = Math.max(Math.abs(b.i - a.i), Math.abs(b.j - a.j));
  for (let t = 0; t <= n; t++) {
    const f = n ? t / n : 0;
    out.push([Math.round(a.i + (b.i - a.i) * f), Math.round(a.j + (b.j - a.j) * f)]);
  }
  return out;
}

export function trimTiles(pieces, cols, rows) {
  return pieces.filter((p) => KINDS[p.k] && p.i >= 0 && p.j >= 0 && p.i < cols && p.j < rows);
}

const ORDER = Object.keys(KINDS);
export function packTiles(pieces) {
  const out = [];
  for (const p of pieces) out.push(ORDER.indexOf(p.k), p.i, p.j);
  return out;
}
export function unpackTiles(a) {
  const out = [];
  if (!Array.isArray(a)) return out;
  for (let q = 0; q + 2 < a.length; q += 3) {
    const k = ORDER[a[q]];
    if (k && Number.isInteger(a[q + 1]) && Number.isInteger(a[q + 2])) out.push({ k, i: a[q + 1], j: a[q + 2] });
  }
  return out;
}

// ---------- fields ----------

/**
 * One kind's tiles as a smooth field over the heightfield cells: 1 inside, easing to 0
 * over about sx metres across and sz metres along the slope outside (so corners round
 * off and neighbours run together). Computed over the tiles' bounding box plus a margin.
 * Returns { i0, j0, w, h, f } or null when there are no tiles.
 */
export function tileField(hf, tiles, sx, sz = sx) {
  if (!tiles.length) return null;
  let ti0 = Infinity;
  let ti1 = -Infinity;
  let tj0 = Infinity;
  let tj1 = -Infinity;
  for (const p of tiles) {
    if (p.i < ti0) ti0 = p.i;
    if (p.i > ti1) ti1 = p.i;
    if (p.j < tj0) tj0 = p.j;
    if (p.j > tj1) tj1 = p.j;
  }
  const { cell, halfZ, startZ } = hf;
  const mx = 3 * sx + cell;
  const mz = 3 * sz + cell;
  const i0 = Math.max(0, Math.floor((ti0 * TILE - mx) / cell));
  const i1 = Math.min(hf.nx - 1, Math.ceil(((ti1 + 1) * TILE + mx) / cell));
  const j0 = Math.max(0, Math.floor((startZ + halfZ + tj0 * TILE - mz) / cell));
  const j1 = Math.min(hf.nz - 1, Math.ceil((startZ + halfZ + (tj1 + 1) * TILE + mz) / cell));
  const w = i1 - i0 + 1;
  const h = j1 - j0 + 1;
  if (w < 1 || h < 1) return null;
  // the mask, tile by tile, on the cells
  const cols = ti1 - ti0 + 1;
  const on = new Uint8Array(cols * (tj1 - tj0 + 1));
  for (const p of tiles) on[(p.j - tj0) * cols + (p.i - ti0)] = 1;
  const f = new Float32Array(w * h);
  for (let jj = 0; jj < h; jj++) {
    const u = (j0 + jj) * cell - halfZ - startZ;
    const tj = Math.floor(u / TILE) - tj0;
    if (tj < 0 || tj > tj1 - tj0) continue;
    for (let ii = 0; ii < w; ii++) {
      const ti = Math.floor(((i0 + ii) * cell) / TILE) - ti0;
      if (ti >= 0 && ti < cols && on[tj * cols + ti]) f[jj * w + ii] = 1;
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

const fieldAt = (F, i, j) => {
  if (!F) return 0;
  const ii = i - F.i0;
  const jj = j - F.j0;
  return ii < 0 || jj < 0 || ii >= F.w || jj >= F.h ? 0 : F.f[jj * F.w + ii];
};

/**
 * Shape the snow with the terrain pieces (hf is changed in place). Returns what the rest
 * of the world needs: the rock band field (bare rock), the powder field, the clearing
 * field and the trees the forest pieces grow.
 */
export function applyTerrain(hf, pieces) {
  const by = {};
  for (const k of ORDER) by[k] = [];
  for (const p of pieces) by[p.k]?.push(p);
  const { h, nx, nz, cell } = hf;

  // bumps and hollows: a tight field for the shape and a wide one so big areas dome
  const add = (tiles, a, b) => {
    const F1 = tileField(hf, tiles, 6);
    const F2 = tileField(hf, tiles, 16);
    if (!F1) return;
    for (let jj = 0; jj < F2.h; jj++) {
      const j = F2.j0 + jj;
      for (let ii = 0; ii < F2.w; ii++) {
        const i = F2.i0 + ii;
        const v = a * fieldAt(F1, i, j) + b * F2.f[jj * F2.w + ii];
        if (v) h[j * nx + i] += v;
      }
    }
  };
  add(by.bump, 5, 3);
  add(by.hollow, -4, -2.5);

  // flats, walls and rock bands change the slope along the fall line: walk down each
  // column, steering the height by how much of each field is there, then ease back to the
  // mountain below them (a flat leaves a lip, a wall a gentler run-out)
  const Ff = tileField(hf, by.flat, 6, 5);
  const Fw = tileField(hf, by.wall, 6, 5);
  const Fr = tileField(hf, by.rocks, 5, 1.5);
  const slopeFields = [Ff, Fw, Fr].filter(Boolean);
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
        const ff = fieldAt(Ff, i, j);
        const fw = fieldAt(Fw, i, j);
        const fr = fieldAt(Fr, i, j);
        const g = h[(j + 1) * nx + i] - h[j * nx + i]; // how the snow drops over this cell
        const inc = (-0.8 * ff + 0.9 * fw) * g - 0.85 * fr * cell;
        const cover = Math.min(1, ff + fw + fr);
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

  // powder: soft pillows in the snow, and no grooming
  const Fp = tileField(hf, by.powder, 4);
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

  // forest: trees on a jittered 7 m grid, thinning out at the edges of the painted area;
  // each spot has its own random numbers, so painting more doesn't move the trees there
  const trees = [];
  const Ft = tileField(hf, by.forest, 5);
  if (Ft) {
    const step = 7;
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
        if (r() < 0.82 * smoothstep(0.25, 0.75, v)) trees.push({ k: TREE, u: pu, x: px, s: 0.7 + r() * 0.75, r: r() * 6.283 });
      }
    }
  }
  return { rock: Fr, powder: Fp, clearing: tileField(hf, by.clearing, 5), trees, fieldAt };
}
