// The run: a stack of sections down the mountain, designed in the run editor.
//
// Each section sets its slope, its length, the width of the groomed piste, a bend (the
// piste drifts left or right by the end of the section), ups and downs (waves across the
// whole slope) and how much forest grows beside the piste. It also holds a grid of cells,
// CELL_M metres square, GRID_COLS across centred on the piste, one element per cell
// (see elements.js). Everything here is plain data and pure functions: no Three.js, so it
// runs in tests.

import { PROFILE_STEP, MAX_LENGTH, MIN_LENGTH, MIN_DROP, profileAt, profileStats, difficulty } from './profile.js';

export const CELL_M = 20; // grid cell, metres across and along
export const GRID_COLS = 7; // columns across, centred on the piste
export const GRID_HALF = (GRID_COLS * CELL_M) / 2;
export const MAX_SECTIONS = 40;
export const LANE_LIMIT = 150; // the piste centre stays within this of the middle, so the grid fits

export const LIMITS = {
  slope: { min: -20, max: 55, step: 1 }, // degrees, negative climbs
  length: { min: 20, max: 300, step: 20 }, // metres, whole grid rows
  width: { min: 20, max: 140, step: 10 }, // groomed piste
  bend: { min: -100, max: 100, step: 10 }, // where the piste centre ends up, relative to its start
};

// ups and downs: waves across the whole slope (amplitude and wavelength in metres)
export const WAVES = [
  { id: 'flat', label: 'Flat', amp: 0, wl: 40 },
  { id: 'gentle', label: 'Gentle', amp: 1.0, wl: 34 },
  { id: 'rolling', label: 'Rolling', amp: 2.2, wl: 44 },
  { id: 'big', label: 'Big', amp: 3.8, wl: 58 },
];

// forest beside the piste
export const FOREST = [
  { id: 'open', label: 'Open', d: 0.12 },
  { id: 'glades', label: 'Glades', d: 0.6 },
  { id: 'dense', label: 'Dense', d: 1 },
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export function newSection(o = {}) {
  return { id: uid(), slope: 18, length: 80, width: 60, bend: 0, waves: 0, forest: 1, cells: [], ...o };
}

export const sectionRows = (s) => Math.max(1, Math.round(s.length / CELL_M));

// keep every value on its step and inside its limits (and the run within 4 km)
export function normalizeSection(s) {
  for (const [k, lim] of Object.entries(LIMITS)) {
    const v = Number.isFinite(+s[k]) ? +s[k] : newSection()[k];
    s[k] = clamp(Math.round(v / lim.step) * lim.step, lim.min, lim.max);
  }
  s.waves = clamp(Math.round(+s.waves || 0), 0, WAVES.length - 1);
  s.forest = clamp(Math.round(Number.isFinite(+s.forest) ? +s.forest : 1), 0, FOREST.length - 1);
  if (!Array.isArray(s.cells)) s.cells = [];
  s.cells = s.cells.filter((c) => c && c.c >= 0 && c.c < GRID_COLS && c.r >= 0 && typeof c.k === 'string');
  for (const c of s.cells) c.s = clamp(Math.round(+c.s || 0), 0, 2);
  if (!s.id) s.id = uid();
  return s;
}

export function runLength(run) {
  let L = 0;
  for (const s of run.sections) L += s.length;
  return L;
}

export function sectionStarts(run) {
  const out = [];
  let u = 0;
  for (const s of run.sections) {
    out.push(u);
    u += s.length;
  }
  return out;
}

// index of the section at distance u down the run
export function sectionAt(run, u) {
  let acc = 0;
  for (let i = 0; i < run.sections.length; i++) {
    acc += run.sections[i].length;
    if (u < acc) return i;
  }
  return run.sections.length - 1;
}

export function cloneRun(run) {
  return { sections: run.sections.map((s) => ({ ...s, cells: s.cells.map((c) => ({ ...c })) })) };
}

/**
 * The run's shape, sampled every PROFILE_STEP metres down the run:
 *   e   centre-line elevation without waves (0 at the start, negative going down)
 *   xc  piste centre across the slope
 *   w   groomed piste width
 * Slope changes are eased over about ±10 m so section joints roll over instead of kinking.
 */
export function runGeometry(run) {
  const secs = run.sections;
  const L = Math.max(PROFILE_STEP, Math.min(MAX_LENGTH, runLength(run)));
  const n = Math.floor(L / PROFILE_STEP) + 1;
  const starts = sectionStarts(run);
  const secOf = new Int16Array(n);
  const raw = new Float64Array(n);
  const wRaw = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const u = Math.min(L - 1e-6, i * PROFILE_STEP);
    while (k < secs.length - 1 && u >= starts[k] + secs[k].length) k++;
    secOf[i] = k;
    raw[i] = -Math.tan((secs[k].slope * Math.PI) / 180);
    wRaw[i] = secs[k].width;
  }
  const slope = boxSmooth(boxSmooth(raw, 2), 2);
  const w = boxSmooth(boxSmooth(wRaw, 2), 2);
  const e = new Float64Array(n);
  for (let i = 1; i < n; i++) e[i] = e[i - 1] + 0.5 * (slope[i - 1] + slope[i]) * PROFILE_STEP;
  // the piste centre eases from where it was to where the bend sends it, section by section
  const xc = new Float64Array(n);
  const c0 = [];
  let c = 0;
  for (const s of secs) {
    c0.push(c);
    c = clamp(c + s.bend, -LANE_LIMIT, LANE_LIMIT);
  }
  for (let i = 0; i < n; i++) {
    const j = secOf[i];
    const s = secs[j];
    const t = (i * PROFILE_STEP - starts[j]) / s.length;
    const end = j + 1 < c0.length ? c0[j + 1] : c;
    xc[i] = c0[j] + (end - c0[j]) * smooth01(t);
  }
  return { e: Array.from(e), xc, w, secOf, starts, L, n };
}

function boxSmooth(a, r) {
  const n = a.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let m = 0;
    for (let d = -r; d <= r; d++) {
      const j = i + d;
      if (j < 0 || j >= n) continue;
      s += a[j];
      m++;
    }
    out[i] = s / m;
  }
  return out;
}

// linear lookup into a per-sample array at distance u
export function sampleAt(arr, u) {
  const f = u / PROFILE_STEP;
  if (f <= 0) return arr[0];
  const n = arr.length;
  if (f >= n - 1) return arr[n - 1];
  const i = Math.floor(f);
  const t = f - i;
  return arr[i] + (arr[i + 1] - arr[i]) * t;
}

// unit direction of the piste at u, in (x, z): mostly straight down the run
export function laneDir(geo, u) {
  const d = (sampleAt(geo.xc, u + 4) - sampleAt(geo.xc, u - 4)) / 8;
  const l = Math.hypot(d, 1);
  return [d / l, 1 / l];
}

// Ups and downs at distance u, `across` metres from the piste centre. The crests curve a
// little across the slope so they read as natural swells, and fade in and out at the ends
// of their section.
export function waveParams(run, geo, u) {
  const j = sectionAt(run, u);
  const s = run.sections[j];
  const W = WAVES[s.waves] || WAVES[0];
  if (!W.amp) return null;
  const u0 = geo.starts[j];
  const u1 = u0 + s.length;
  const fade = Math.min(12, s.length / 3);
  const win = smooth01((u - u0) / fade) * (1 - smooth01((u - (u1 - fade)) / fade));
  if (win <= 0) return null;
  return { a: W.amp * win, wl: W.wl, u0 };
}

export function waveAt(p, u, across) {
  if (!p) return 0;
  const off = u - p.u0 + 5 * Math.sin(across / 70);
  return p.a * Math.sin((2 * Math.PI * off) / p.wl);
}

// centre-line profile including the waves: what the side view draws and the stats read
export function runProfile(run, geo = runGeometry(run)) {
  const out = new Array(geo.n);
  for (let i = 0; i < geo.n; i++) {
    const u = i * PROFILE_STEP;
    out[i] = geo.e[i] + waveAt(waveParams(run, geo, u), u, 0);
  }
  return out;
}

export function runStats(run, geo = runGeometry(run)) {
  const p = runProfile(run, geo);
  const st = profileStats(p);
  const tooLong = runLength(run) > MAX_LENGTH;
  st.tooLong = tooLong;
  st.ok = st.ok && !tooLong;
  st.reason = tooLong
    ? `Too long: the run can be ${MAX_LENGTH / 1000} km at most`
    : st.length < MIN_LENGTH
      ? `Too short: make the run at least ${MIN_LENGTH} m long`
      : st.drop < MIN_DROP
        ? `Too flat: the run needs at least ${MIN_DROP} m of drop`
        : '';
  return st;
}

export function sectionDifficulty(s) {
  return difficulty(s.slope < 0 ? -2 : s.slope);
}

// ---------- saving ----------

export function packRun(run) {
  return run.sections.map((s) => [s.id, s.slope, s.length, s.width, s.bend, s.waves, s.forest, s.cells.map((c) => [c.r, c.c, c.k, c.s])]);
}

export function unpackRun(a) {
  if (!Array.isArray(a) || !a.length) return null;
  const sections = a.slice(0, MAX_SECTIONS).map((r) =>
    normalizeSection({
      id: String(r[0] || uid()),
      slope: r[1],
      length: r[2],
      width: r[3],
      bend: r[4],
      waves: r[5],
      forest: r[6],
      cells: Array.isArray(r[7]) ? r[7].map((c) => ({ r: c[0], c: c[1], k: c[2], s: c[3] })) : [],
    })
  );
  return { sections };
}

// An old drawn profile (elevations every 4 m) becomes sections: the average slope over
// 40 m windows, neighbours within 3 degrees merged.
export function profileToRun(e) {
  const L = (e.length - 1) * PROFILE_STEP;
  const win = 40;
  const parts = [];
  for (let u = 0; u < L - 1; u += win) {
    const len = Math.min(win, L - u);
    if (len < 10) break;
    const deg = (Math.atan2(profileAt(e, u) - profileAt(e, u + len), len) * 180) / Math.PI;
    const last = parts[parts.length - 1];
    if (last && Math.abs(last.deg - deg) < 3 && last.len + len <= LIMITS.length.max) {
      last.deg = (last.deg * last.len + deg * len) / (last.len + len);
      last.len += len;
    } else parts.push({ deg, len });
  }
  const sections = parts.map((p) =>
    normalizeSection(newSection({ slope: Math.round(p.deg), length: Math.max(LIMITS.length.min, Math.round(p.len / CELL_M) * CELL_M) }))
  );
  return { sections: sections.length ? sections : [newSection({ length: 200 })] };
}

// ---------- ready-made runs ----------

const cell = (r, c, k, s = 1) => ({ r, c, k, s });

export const TEMPLATES = [
  {
    id: 'starter',
    name: 'Blue cruiser',
    blurb: 'A friendly blue with a kicker, rollers and a table',
    make: () => ({
      sections: [
        newSection({ slope: 12, length: 60, width: 70, forest: 1 }),
        newSection({
          slope: 20,
          length: 140,
          width: 60,
          waves: 1,
          cells: [cell(2, 3, 'kicker', 1), cell(0, 0, 'trees', 1), cell(4, 6, 'trees', 2), cell(5, 1, 'rock', 1)],
        }),
        newSection({ slope: 26, length: 100, width: 50, bend: -40, cells: [cell(1, 3, 'rollers', 1), cell(0, 5, 'poles', 2)] }),
        newSection({ slope: 17, length: 140, width: 70, bend: 40, waves: 2, cells: [cell(2, 3, 'table', 1), cell(1, 6, 'chalet', 1), cell(4, 0, 'cannon', 1)] }),
        newSection({ slope: 11, length: 80, width: 80, cells: [cell(1, 3, 'gate', 2), cell(2, 1, 'trees', 2)] }),
      ],
    }),
  },
  {
    id: 'park',
    name: 'Park lap',
    blurb: 'Kickers, rails, boxes and a half-pipe on a wide groomed run',
    make: () => ({
      sections: [
        newSection({ slope: 14, length: 60, width: 100, forest: 0, cells: [cell(1, 0, 'cannon', 2), cell(1, 6, 'cannon', 2)] }),
        newSection({
          slope: 19,
          length: 120,
          width: 100,
          forest: 0,
          cells: [cell(1, 3, 'kicker', 1), cell(4, 3, 'kicker', 2), cell(2, 1, 'box', 1), cell(2, 5, 'rail', 1), cell(0, 0, 'net', 2), cell(0, 6, 'net', 2)],
        }),
        newSection({ slope: 16, length: 100, width: 100, forest: 0, cells: [cell(1, 3, 'box', 2), cell(1, 1, 'rail', 2), cell(1, 5, 'table', 1)] }),
        newSection({ slope: 17, length: 140, width: 90, forest: 1, cells: [cell(0, 3, 'pipe', 1), cell(2, 0, 'lift', 1), cell(5, 0, 'lift', 1)] }),
        newSection({ slope: 12, length: 80, width: 90, forest: 1, cells: [cell(1, 3, 'gate', 2)] }),
      ],
    }),
  },
  {
    id: 'freeride',
    name: 'Backcountry',
    blurb: 'Steep, narrow and wild: cliffs, cornices and deep powder',
    make: () => ({
      sections: [
        newSection({ slope: 16, length: 60, width: 30, forest: 0, cells: [cell(1, 5, 'cornice', 1)] }),
        newSection({ slope: 32, length: 120, width: 30, bend: 60, forest: 1, cells: [cell(2, 1, 'cliff', 1), cell(4, 5, 'moguls', 1), cell(1, 6, 'rock', 2)] }),
        newSection({ slope: 38, length: 100, width: 30, waves: 2, forest: 2, cells: [cell(2, 2, 'gully', 1), cell(1, 5, 'rock', 2)] }),
        newSection({ slope: 27, length: 140, width: 30, bend: -80, forest: 2, cells: [cell(3, 4, 'cliff', 2), cell(1, 2, 'trees', 2)] }),
        newSection({ slope: 14, length: 100, width: 40, forest: 1, cells: [cell(2, 3, 'lake', 1), cell(1, 6, 'chalet', 0)] }),
      ],
    }),
  },
  {
    id: 'blank',
    name: 'Blank',
    blurb: 'One even slope, nothing on it',
    make: () => ({ sections: [newSection({ slope: 18, length: 240, width: 60 })] }),
  },
];

export function templateRun(id) {
  const t = TEMPLATES.find((x) => x.id === id) || TEMPLATES[0];
  const run = t.make();
  run.sections.forEach(normalizeSection);
  return run;
}
