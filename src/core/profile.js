import { Heightfield, makeValueNoise, smoothstep, START_MARGIN, FINISH_MARGIN, SIZE_X } from './heightfield.js';

// A run profile is the descent seen from the side: elevations (metres, 0 at the start,
// negative going down) sampled every PROFILE_STEP metres of horizontal distance.
// The player draws it; buildFromProfile turns it into the 3D piste.

export const PROFILE_STEP = 4; // metres between profile samples
export const MIN_LENGTH = 150;
export const MAX_LENGTH = 4000;
export const MIN_DROP = 30;
export const MAX_DOWN_DEG = 70; // steepest descent you can draw
export const MAX_UP_DEG = 25; // steepest climb you can draw
const VERTEX_BUDGET = 420000; // keep the mesh light enough for phones

// Piste difficulty colours by angle (European convention)
export function difficulty(deg) {
  if (deg < -1) return 'up';
  if (deg < 12) return 'green';
  if (deg < 22) return 'blue';
  if (deg < 32) return 'red';
  return 'black';
}

export function profileLength(e) {
  return (e.length - 1) * PROFILE_STEP;
}

// Elevation at distance u (Catmull-Rom between samples, flat before the start,
// a gentle run-out after the end)
export function profileAt(e, u) {
  const n = e.length;
  if (n < 2) return 0;
  const L = (n - 1) * PROFILE_STEP;
  if (u <= 0) return e[0];
  if (u >= L) return e[n - 1] - (u - L) * 0.06;
  const f = u / PROFILE_STEP;
  const i = Math.floor(f);
  const t = f - i;
  const p0 = e[Math.max(0, i - 1)];
  const p1 = e[i];
  const p2 = e[Math.min(n - 1, i + 1)];
  const p3 = e[Math.min(n - 1, i + 2)];
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// Resample drawn points [[u, e], ...] (u increasing) onto the PROFILE_STEP grid
export function resample(points) {
  if (points.length < 2) return [0];
  const L = Math.min(MAX_LENGTH, points[points.length - 1][0]);
  const n = Math.max(2, Math.floor(L / PROFILE_STEP) + 1);
  const out = new Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const u = i * PROFILE_STEP;
    while (k < points.length - 2 && points[k + 1][0] < u) k++;
    const [u0, e0] = points[k];
    const [u1, e1] = points[k + 1];
    const t = u1 > u0 ? Math.min(1, Math.max(0, (u - u0) / (u1 - u0))) : 0;
    out[i] = e0 + (e1 - e0) * t;
  }
  out[0] = 0;
  return out;
}

// Light [1 2 1] smoothing from index `from` onwards (the start stays at 0)
export function smooth(e, passes = 1, from = 1) {
  const a = e.slice();
  for (let p = 0; p < passes; p++) {
    const b = a.slice();
    for (let i = Math.max(1, from); i < a.length - 1; i++) b[i] = (a[i - 1] + 2 * a[i] + a[i + 1]) / 4;
    for (let i = Math.max(1, from); i < a.length - 1; i++) a[i] = b[i];
  }
  a[0] = 0;
  return a;
}

// Clamp every step to the drawable angle range
export function clampSlopes(e) {
  const a = e.slice();
  const down = Math.tan((MAX_DOWN_DEG * Math.PI) / 180) * PROFILE_STEP;
  const up = Math.tan((MAX_UP_DEG * Math.PI) / 180) * PROFILE_STEP;
  for (let i = 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    if (d < -down) a[i] = a[i - 1] - down;
    else if (d > up) a[i] = a[i - 1] + up;
  }
  return a;
}

export function profileStats(e) {
  const L = profileLength(e);
  let maxDeg = 0;
  let maxUp = 0;
  let minE = 0;
  // steepest angle over 20 m windows (single 4 m steps are too twitchy to report)
  const w = Math.max(1, Math.round(20 / PROFILE_STEP));
  for (let i = 0; i + w < e.length; i++) {
    const deg = (Math.atan2(e[i] - e[i + w], w * PROFILE_STEP) * 180) / Math.PI;
    maxDeg = Math.max(maxDeg, deg);
    maxUp = Math.max(maxUp, -deg);
  }
  for (const v of e) minE = Math.min(minE, v);
  const drop = e[0] - e[e.length - 1];
  return {
    length: L,
    drop,
    lowest: -minE,
    avgDeg: L > 0 ? (Math.atan2(drop, L) * 180) / Math.PI : 0,
    maxDeg,
    maxUpDeg: maxUp,
    ok: L >= MIN_LENGTH && drop >= MIN_DROP,
  };
}

// Grid size for a run of this length: 480 m wide, cells grow a little on very long runs
export function pisteDims(length) {
  const sizeZ = START_MARGIN + length + FINISH_MARGIN;
  const cell = Math.min(2.5, Math.max(1.5, Math.sqrt((SIZE_X * sizeZ) / VERTEX_BUDGET)));
  return { sizeX: SIZE_X, sizeZ, cell: Math.round(cell * 20) / 20 };
}

/**
 * Resize hf to fit the profile and fill it with the generated piste: the profile along
 * the run, a gently dished cross-section with raised edges, and a little natural texture.
 * Returns the start position.
 */
export function buildFromProfile(hf, e) {
  const L = profileLength(e);
  const { sizeX, sizeZ, cell } = pisteDims(L);
  hf.resize(sizeX, sizeZ, cell);
  const noise = makeValueNoise(4242);
  let minE = 0;
  for (const v of e) minE = Math.min(minE, v);
  const lift = 60 - minE; // keep the lowest point (and its run-out) well above zero
  const half = hf.halfX;
  const row = new Float64Array(hf.nz);
  // ease from the flat start area into the drawn slope with one gentle constant curve
  // (a sharp corner would launch the skier straight out of the gate)
  const ua = -START_MARGIN;
  const ub = Math.min(40, L * 0.25);
  const m = (profileAt(e, ub + 1) - profileAt(e, ub - 1)) / 2;
  const h0 = profileAt(e, ub) - (m * (ub - ua)) / 2;
  for (let j = 0; j < hf.nz; j++) {
    const u = j * hf.cell - START_MARGIN;
    const v = u < ub ? h0 + (m / (2 * (ub - ua))) * (u - ua) * (u - ua) : profileAt(e, u);
    row[j] = v + lift;
  }
  for (let j = 0; j < hf.nz; j++) {
    const z = j * hf.cell - hf.halfZ;
    const base = row[j];
    for (let i = 0; i < hf.nx; i++) {
      const x = i * hf.cell - half;
      const ax = Math.abs(x);
      const dish = 6 * (ax / half) * (ax / half);
      const lips = 14 * smoothstep(half - 40, half - 2, ax);
      const tex = 0.7 * noise(x * 0.025, z * 0.025) + 0.25 * noise(x * 0.08 + 7, z * 0.08);
      hf.h[j * hf.nx + i] = base + dish + lips + tex;
    }
  }
  return { x: 0, z: hf.startZ };
}

/**
 * Carry the player's sculpting from one piste to another: `delta` holds (height - generated
 * height) on the old grid; it is sampled at the same distance along the run and the same
 * offset across, and added onto the new generated heights in `hf`.
 */
export function addDelta(hf, delta, oldDims) {
  const old = new Heightfield(oldDims.sizeX, oldDims.sizeZ, oldDims.cell);
  old.h = delta;
  for (let j = 0; j < hf.nz; j++) {
    const u = j * hf.cell - START_MARGIN; // distance from the start
    const zOld = u + old.startZ;
    if (zOld < -old.halfZ || zOld > old.halfZ) continue;
    for (let i = 0; i < hf.nx; i++) {
      const x = i * hf.cell - hf.halfX;
      if (x < -old.halfX || x > old.halfX) continue;
      hf.h[j * hf.nx + i] += old.heightAt(x, zOld);
    }
  }
}

// A straight first run, used behind the editor before anything has been drawn
export function defaultProfile() {
  const n = Math.round(900 / PROFILE_STEP) + 1;
  const e = new Array(n);
  for (let i = 0; i < n; i++) e[i] = -Math.tan((18 * Math.PI) / 180) * i * PROFILE_STEP;
  return e;
}
