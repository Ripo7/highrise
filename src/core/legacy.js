// Saves from the section editor (save format v5): the run was a stack of sections, each
// with a slope, a length, ups and downs, and a grid of 20 m cells holding elements. Here
// the sections become the mountain's descent (a profile) and the elements become pieces
// on the 10 m grid, so a run designed then still loads as the same mountain.

import { PROFILE_STEP, MAX_LENGTH } from './profile.js';
import { TILE, GRID_X0, sampleAt } from './mountain.js';
import { PIECES, pieceW, pieceH, placePieces } from './pieces.js';

const OLD_CELL = 20; // metres
const OLD_COLS = 7; // across, centred on the piste
const WAVES = [0, 1.0, 2.2, 3.8]; // amplitude of the ups and downs, metres
const WAVE_L = [40, 34, 44, 58]; // and their wavelength
// how many old 20 m rows each element ran over, by size (small, medium, large)
const ROWS = {
  kicker: [1, 2, 2],
  table: [2, 3, 4],
  berm: [2, 3, 4],
  rollers: [2, 3, 4],
  moguls: [1, 2, 3],
  gully: [2, 3, 5],
  lake: [1, 2, 2],
  rail: [1, 2, 2],
  box: [1, 1, 2],
  pipe: [3, 5, 7],
  tunnel: [1, 2, 2],
  net: [1, 2, 3],
};
const RENAME = { cliff: 'drop' };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// the packed sections: [id, slope, length, width, bend, waves, forest, cells[[r, c, k, s]]]
function sections(packed) {
  if (!Array.isArray(packed) || !packed.length) return null;
  const out = [];
  let total = 0;
  for (const r of packed.slice(0, 40)) {
    if (!Array.isArray(r)) continue;
    const slope = clamp(Number.isFinite(+r[1]) ? +r[1] : 18, -20, 55);
    const length = clamp(Math.round((Number.isFinite(+r[2]) ? +r[2] : 80) / OLD_CELL) * OLD_CELL, OLD_CELL, 300);
    if (total + length > MAX_LENGTH) break;
    const cells = Array.isArray(r[7]) ? r[7].filter((c) => Array.isArray(c) && typeof c[2] === 'string') : [];
    out.push({ slope, length, waves: clamp(Math.round(+r[5] || 0), 0, WAVES.length - 1), cells, u0: total });
    total += length;
  }
  return out.length ? out : null;
}

function boxSmooth(a, r) {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let s = 0;
    let m = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) {
      s += a[j];
      m++;
    }
    out[i] = s / m;
  }
  return out;
}

/** The descent of a v5 run: elevations every PROFILE_STEP metres (null if unreadable). */
export function v5Profile(packed) {
  const secs = sections(packed);
  if (!secs) return null;
  const last = secs[secs.length - 1];
  const L = last.u0 + last.length;
  const n = Math.floor(L / PROFILE_STEP) + 1;
  const raw = new Float64Array(n);
  const at = (u) => secs.findLast((s) => u >= s.u0) || secs[0];
  for (let i = 0; i < n; i++) raw[i] = -Math.tan((at(Math.min(L - 1e-6, i * PROFILE_STEP)).slope * Math.PI) / 180);
  const slope = boxSmooth(boxSmooth(raw, 2), 2); // section joints roll over instead of kinking
  const e = new Array(n).fill(0);
  for (let i = 1; i < n; i++) e[i] = e[i - 1] + 0.5 * (slope[i - 1] + slope[i]) * PROFILE_STEP;
  // the ups and downs, faded in and out at the ends of their section
  for (let i = 0; i < n; i++) {
    const u = i * PROFILE_STEP;
    const s = at(Math.min(L - 1e-6, u));
    const a = WAVES[s.waves];
    if (!a) continue;
    const fade = Math.min(12, s.length / 3);
    const t0 = clamp((u - s.u0) / fade, 0, 1);
    const t1 = clamp((u - (s.u0 + s.length - fade)) / fade, 0, 1);
    const win = t0 * t0 * (3 - 2 * t0) * (1 - t1 * t1 * (3 - 2 * t1));
    e[i] += a * win * Math.sin((2 * Math.PI * (u - s.u0)) / WAVE_L[s.waves]);
  }
  return e;
}

/** The elements of a v5 run as pieces, placed beside the new mountain's piste (base.lane). */
export function v5Pieces(packed, base, rows) {
  const secs = sections(packed);
  if (!secs) return [];
  const add = [];
  for (const s of secs) {
    for (const [r, c, k0, sz] of s.cells) {
      const k = RENAME[k0] || k0;
      const P = PIECES[k];
      if (!P || !(c >= 0 && c < OLD_COLS) || !(r >= 0) || r * OLD_CELL >= s.length) continue;
      const size = clamp(Math.round(+sz || 0), 0, 2);
      const u = s.u0 + r * OLD_CELL;
      const xLeft = sampleAt(base.lane.xc, u + OLD_CELL / 2) - (OLD_COLS * OLD_CELL) / 2 + c * OLD_CELL;
      const i0 = Math.round((xLeft - GRID_X0) / TILE);
      const j0 = Math.round(u / TILE);
      const across = OLD_CELL / TILE; // an old cell was two tiles wide...
      const along = ((ROWS[k] || [1, 1, 1])[size] * OLD_CELL) / TILE; // ...and two tiles per row long
      const put = (i, j) => add.push({ k, i, j, r: 0 });
      if (P.merge === 'none') put(i0, j0);
      else if (P.merge === 'across') for (let di = 0; di < across; di++) put(i0 + di, j0);
      else if (P.merge === 'along') for (let dj = 0; dj < along; dj++) put(i0, j0 + dj);
      else {
        // fields and rectangles: fill the old cell's area (a chalet grows with its size)
        const w = k === 'chalet' ? (size ? 2 : 1) : across;
        const h = k === 'chalet' ? (size > 1 ? 2 : 1) : along;
        for (let dj = 0; dj + pieceH(k) <= Math.max(h, pieceH(k)); dj += pieceH(k))
          for (let di = 0; di + pieceW(k) <= Math.max(w, pieceW(k)); di += pieceW(k)) put(i0 + di, j0 + dj);
      }
    }
  }
  return placePieces([], add, rows);
}
