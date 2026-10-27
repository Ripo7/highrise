// Ready-made mountains. You pick how steep (gentle, medium, steep) and how long (short,
// medium, long); the mountain comes with a natural descent (easier at the top, a few
// steeper pitches and rolls, a run-out at the bottom), a groomed piste meandering down it,
// powder and forest on either side. Then you build on it with pieces (pieces.js).
//
// Everything here is the base the pieces are built on; it's computed once per mountain
// and kept (buildBase), so placing a piece only re-applies the pieces.

import { makeValueNoise, smoothstep, START_MARGIN, SIZE_X } from './heightfield.js';
import { PROFILE_STEP, profileAt, pisteDims, MAX_LENGTH } from './profile.js';
import { TREE, ROCK, rng } from './props.js';

export const TILE = 10; // the build grid, metres
export const GRID_COLS = Math.floor(SIZE_X / TILE);
export const GRID_X0 = -SIZE_X / 2;

export const SLOPES = [
  { id: 'gentle', label: 'Gentle', deg: 14, blurb: 'Green and blue: long cruising turns' },
  { id: 'medium', label: 'Medium', deg: 21, blurb: 'Blue with red pitches' },
  { id: 'steep', label: 'Steep', deg: 29, blurb: 'Black: fast and committing' },
];

export const LENGTHS = [
  { id: 'short', label: 'Short', m: 500 },
  { id: 'medium', label: 'Medium', m: 900 },
  { id: 'long', label: 'Long', m: 1500 },
];

export function newMountain(slope = 'medium', length = 'medium', seed = Math.floor(Math.random() * 1e6)) {
  return { slope, length, seed };
}

export const mountainLength = (m) => (m.profile ? (m.profile.length - 1) * PROFILE_STEP : (LENGTHS.find((l) => l.id === m.length) || LENGTHS[1]).m);

// The descent seen from the side: elevations every PROFILE_STEP metres. An old drawn run
// (m.profile) is used as it is.
export function mountainProfile(m) {
  if (Array.isArray(m.profile) && m.profile.length > 1) return m.profile;
  const deg = (SLOPES.find((s) => s.id === m.slope) || SLOPES[1]).deg;
  const L = Math.min(MAX_LENGTH, mountainLength(m));
  const n = Math.round(L / PROFILE_STEP) + 1;
  const r = rng(m.seed * 13 + 7);
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  const noise = makeValueNoise(m.seed + 5);
  const t = Math.tan((deg * Math.PI) / 180);
  const e = new Array(n);
  e[0] = 0;
  for (let i = 1; i < n; i++) {
    const u = i * PROFILE_STEP;
    let k = 1 + 0.2 * Math.sin((2 * Math.PI * u) / 310 + p1) + 0.12 * Math.sin((2 * Math.PI * u) / 127 + p2) + 0.08 * noise(u * 0.02, 3.7);
    // easier at the top, a run-out at the bottom
    k *= 0.55 + 0.45 * smoothstep(0, 70, u);
    k *= 1 - 0.55 * smoothstep(L - 90, L, u);
    e[i] = e[i - 1] - t * k * PROFILE_STEP;
  }
  return e;
}

// the groomed piste: a gentle meander down the mountain, 50 m wide (every PROFILE_STEP m)
export function mountainLane(m, n) {
  const r = rng(m.seed * 31 + 3);
  const phase = r() * 6.28;
  const amp = m.profile ? 0 : 14 + r() * 16;
  const wl = 420 + r() * 260;
  const xc = new Float64Array(n);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = i * PROFILE_STEP;
    xc[i] = amp * (Math.sin((2 * Math.PI * u) / wl + phase) - Math.sin(phase)) * smoothstep(0, 90, u);
    w[i] = 50 + 6 * Math.sin((2 * Math.PI * u) / 230 + phase * 2);
  }
  return { xc, w };
}

export function sampleAt(arr, u) {
  const f = u / PROFILE_STEP;
  if (f <= 0) return arr[0];
  const n = arr.length;
  if (f >= n - 1) return arr[n - 1];
  const i = Math.floor(f);
  return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
}

/**
 * Resize hf (and surf) to the mountain and fill them with its base: snow heights, the
 * groomed piste, and the forest beside it. Returns the base, kept to rebuild the pieces
 * on: { e, L, lane, start, finishX, h, g, forest }.
 */
export function buildBase(hf, surf, m) {
  const e = mountainProfile(m);
  const L = (e.length - 1) * PROFILE_STEP;
  const { sizeX, sizeZ, cell } = pisteDims(L);
  hf.resize(sizeX, sizeZ, cell);
  surf.resize(hf);
  const lane = mountainLane(m, e.length);
  const noise = makeValueNoise(4242);
  const macro = makeValueNoise((m.seed % 9973) + 17);
  const pillowN = makeValueNoise(777);
  let minE = 0;
  for (const v of e) minE = Math.min(minE, v);
  const lift = 66 - minE;
  // ease from the flat start area into the slope with one gentle constant curve
  const ua = -START_MARGIN;
  const ub = Math.min(40, L * 0.25);
  const mm = (profileAt(e, ub + 1) - profileAt(e, ub - 1)) / 2;
  const h0 = profileAt(e, ub) - (mm * (ub - ua)) / 2;
  const half = hf.halfX;
  for (let j = 0; j < hf.nz; j++) {
    const u = j * hf.cell - START_MARGIN;
    const z = j * hf.cell - hf.halfZ;
    const base = (u < ub ? h0 + (mm / (2 * (ub - ua))) * (u - ua) * (u - ua) : profileAt(e, u)) + lift;
    const uc = Math.min(L, Math.max(0, u));
    const xc = sampleAt(lane.xc, uc);
    const pw = sampleAt(lane.w, uc) / 2;
    const row = j * hf.nx;
    for (let i = 0; i < hf.nx; i++) {
      const x = i * hf.cell - half;
      const d = x - xc;
      const ad = Math.abs(d);
      const g = 1 - smoothstep(pw - 1.5, pw + 2.5, ad);
      const dish = 6 * (d / half) * (d / half);
      const lips = 14 * smoothstep(half - 40, half - 2, Math.abs(x));
      // broad natural shapes: shallow ridges and hollows across the mountain, calmer on the piste
      const swell = 4.5 * macro(x * 0.007, u * 0.006) * (0.35 + 0.65 * smoothstep(pw, pw + 40, ad));
      const broad = 0.7 * noise(x * 0.025, z * 0.025);
      const fine = 0.25 * noise(x * 0.08 + 7, z * 0.08);
      const pn = pillowN(x * 0.15, z * 0.15);
      const pillows = 0.42 * Math.pow(Math.max(0, pn), 1.5) + 0.12 * pn;
      const er = ad - pw - 1.8;
      const windrow = 0.32 * Math.exp(-(er * er) / 2.2);
      hf.h[row + i] = base + dish + lips + swell + broad + (1 - g) * (fine + pillows) + windrow;
      surf.g[row + i] = Math.round(g * 255);
    }
  }
  const forest = scatterForest(hf, lane, L, m.seed);
  surf.version++;
  return {
    e,
    L,
    lane,
    start: { x: sampleAt(lane.xc, 0), z: hf.startZ },
    finishX: sampleAt(lane.xc, L),
    h: hf.copy(),
    g: surf.g.slice(),
    forest,
  };
}

/**
 * Forest beside the piste: woods in patches with glades between them, thinning out next to
 * the piste so the powder there is rideable, thicker towards the far edges, rocks on the
 * steep bits. The piste, the start and the finish stay clear.
 */
export function scatterForest(hf, lane, L, seed = 1) {
  const out = [];
  const n1 = makeValueNoise(11 + (seed % 101));
  const n2 = makeValueNoise(23);
  const n3 = makeValueNoise(37);
  const rand = rng(seed * 7919 + 1);
  const step = 10;
  const half = hf.halfX - 6;
  const finishU = hf.finishZ - hf.startZ;
  const x0 = sampleAt(lane.xc, 0);
  const xF = sampleAt(lane.xc, L);
  for (let u = 0; u < L; u += step) {
    for (let x = -half; x < half; x += step) {
      const px = x + rand() * step;
      const pu = u + rand() * step;
      const roll = rand();
      const size = rand();
      const rot = rand() * 6.283;
      if (pu > finishU - 10) continue;
      if (pu < 60 && Math.abs(px - x0) < 70) continue;
      if (pu > finishU - 50 && Math.abs(px - xF) < 40) continue;
      const off = Math.abs(px - sampleAt(lane.xc, pu)) - sampleAt(lane.w, pu) / 2;
      if (off < 3) continue;
      const z = hf.startZ + pu;
      const near = smoothstep(3, 26, off);
      const patch = 0.7 * n1(px * 0.007, pu * 0.007) + 0.3 * n3(px * 0.03 + 9, pu * 0.03);
      const woods = smoothstep(0.32, 0.54, patch) * 0.62;
      const edge = smoothstep(170, 232, Math.abs(px)) * 0.36;
      const pTree = Math.min(0.85, (woods + 0.045 + edge) * near);
      const nrm = hf.normalAt(px, z);
      const steep = smoothstep(0.3, 0.55, 1 - nrm[1]);
      const pRock = (0.02 + 0.2 * steep + 0.06 * Math.max(0, n2(px * 0.03, pu * 0.03) - 0.4)) * (0.35 + 0.65 * near);
      if (roll < pTree) out.push({ k: TREE, u: pu, x: px, s: 0.75 + size * 0.7, r: rot });
      else if (roll < pTree + pRock) out.push({ k: ROCK, u: pu, x: px, s: 0.7 + size * size * 2.2, r: rot });
    }
  }
  return out;
}
