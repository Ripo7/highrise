// Pistes traced through the wild. A piste is a list of waypoints you put down the mountain;
// a smooth curve passes through them (centripetal Catmull-Rom, so it never loops or
// overshoots), and the piste is carved into the snow along it: levelled across (a quarter
// of the natural tilt is kept so it still sits in the mountain), lightly smoothed along,
// graded where the mountain is too steep to ride (a cliff becomes a steep ramp, half cut
// and half filled), groomed, with soft banks on either side. Trees and boulders on it are
// cleared.
//
// A piste can start from another one (a branch) and end on another one (it joins it): the
// joined end follows that piste when it moves, and where two pistes meet their snow is
// blended into one surface, so they merge with no seam.
//
//   piste: { id, pts: [{ x, z, w }], from: { id, f } | null, to: { id, f } | null }
//   (w = width in metres; f = how far along the other piste, 0..1)

import { smoothstep } from './heightfield.js';

export const WIDTHS = [24, 36, 52]; // narrow, normal, wide
export const DEFAULT_WIDTH = 36;
export const SAMPLE = 2; // metres between samples along a curve
export const SHOULDER = 10; // the bank between the groomed piste and the wild snow (at least)
const MAX_SHOULDER = 34; // ... wider where the piste cuts across a steep slope
const MAX_GRADE = Math.tan((38 * Math.PI) / 180); // steepest a piste is graded to
const KEEP_TILT = 0.25;

export function newPiste(pistes, pts = [], from = null) {
  const id = pistes.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  return { id, pts, from, to: null };
}

export function clonePistes(pistes) {
  return pistes.map((p) => ({ id: p.id, pts: p.pts.map((q) => ({ ...q })), from: p.from && { ...p.from }, to: p.to && { ...p.to } }));
}

// ---------- curves ----------

// Centripetal Catmull-Rom through the control points, sampled about every SAMPLE metres.
// Widths ease from one waypoint to the next.
export function sampleCurve(P) {
  const n = P.length;
  if (n < 2) return null;
  const xs = [];
  const zs = [];
  const ws = [];
  const ext = (a, b) => ({ x: 2 * a.x - b.x, z: 2 * a.z - b.z, w: a.w });
  const get = (i) => (i < 0 ? ext(P[0], P[1]) : i >= n ? ext(P[n - 1], P[n - 2]) : P[i]);
  const knot = (a, b) => Math.max(1e-3, Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z)));
  const ck = []; // the sample index of every control point
  for (let i = 0; i < n - 1; i++) {
    ck.push(xs.length);
    const p0 = get(i - 1);
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = get(i + 2);
    const chord = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(1, Math.ceil(chord / SAMPLE));
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      // Barry-Goldman pyramid
      const l = (a, b, ta, tb) => {
        const f = (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      };
      const q0 = [p0.x, p0.z];
      const q1 = [p1.x, p1.z];
      const q2 = [p2.x, p2.z];
      const q3 = [p3.x, p3.z];
      const a1 = l(q0, q1, 0, t1);
      const a2 = l(q1, q2, t1, t2);
      const a3 = l(q2, q3, t2, t3);
      const b1 = l(a1, a2, 0, t2);
      const b2 = l(a2, a3, t1, t3);
      const c = l(b1, b2, t1, t2);
      xs.push(c[0]);
      zs.push(c[1]);
      const e = smoothstep(0, 1, k / steps);
      ws.push(p1.w + (p2.w - p1.w) * e);
    }
  }
  xs.push(P[n - 1].x);
  zs.push(P[n - 1].z);
  ws.push(P[n - 1].w);
  const m = xs.length;
  ck.push(m - 1);
  const s = new Float64Array(m);
  for (let k = 1; k < m; k++) s[k] = s[k - 1] + Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]);
  return { xs, zs, ws, s, L: s[m - 1], n: m, ck };
}

// position and width at fraction f (0..1) of the way along a curve
export function curveAt(c, f) {
  const target = Math.max(0, Math.min(1, f)) * c.L;
  let lo = 0;
  let hi = c.n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c.s[mid] <= target) lo = mid;
    else hi = mid;
  }
  const seg = c.s[hi] - c.s[lo];
  const t = seg > 1e-9 ? (target - c.s[lo]) / seg : 0;
  return { x: c.xs[lo] + (c.xs[hi] - c.xs[lo]) * t, z: c.zs[lo] + (c.zs[hi] - c.zs[lo]) * t, w: c.ws[lo] + (c.ws[hi] - c.ws[lo]) * t, k: t < 0.5 ? lo : hi };
}

// unit direction of travel at sample k
export function curveDir(c, k) {
  const a = Math.max(0, k - 2);
  const b = Math.min(c.n - 1, k + 2);
  const dx = c.xs[b] - c.xs[a];
  const dz = c.zs[b] - c.zs[a];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

/**
 * Every piste's curve, by id. A joined end is put on the piste it joins (which must come
 * earlier in the list, so there are no loops). Pistes with fewer than two points have no
 * curve.
 */
export function pisteCurves(pistes) {
  const out = new Map();
  for (const p of pistes) {
    const ctrl = [];
    const par = p.from && out.get(p.from.id);
    const end = p.to && out.get(p.to.id);
    if (par) {
      const a = curveAt(par, p.from.f);
      ctrl.push({ x: a.x, z: a.z, w: p.pts[0]?.w ?? a.w });
    }
    for (const q of p.pts) ctrl.push(q);
    if (end) {
      const a = curveAt(end, p.to.f);
      ctrl.push({ x: a.x, z: a.z, w: p.pts[p.pts.length - 1]?.w ?? a.w });
    }
    // drop control points on top of each other (a tap twice in the same place)
    const clean = ctrl.filter((q, i) => i === 0 || Math.hypot(q.x - ctrl[i - 1].x, q.z - ctrl[i - 1].z) > 0.5);
    const c = sampleCurve(clean);
    if (!c) continue;
    c.id = p.id;
    c.ctrl = clean;
    c.lead = par ? 1 : 0; // control points before the first waypoint (the joined start)
    c.from = par ? { id: p.from.id, f: p.from.f } : null;
    c.to = end ? { id: p.to.id, f: p.to.f } : null;
    out.set(p.id, c);
  }
  return out;
}

// the nearest point on any curve: { id, k, d, f, x, z, w } (null if there are no curves)
export function nearestOnCurves(curves, x, z, skip = null) {
  let best = null;
  for (const c of curves.values()) {
    if (c.id === skip) continue;
    for (let k = 0; k < c.n; k++) {
      const d = Math.hypot(c.xs[k] - x, c.zs[k] - z);
      if (!best || d < best.d) best = { id: c.id, k, d, c };
    }
  }
  if (!best) return null;
  const c = best.c;
  return { id: best.id, k: best.k, d: best.d, f: c.L > 0 ? c.s[best.k] / c.L : 0, x: c.xs[best.k], z: c.zs[best.k], w: c.ws[best.k] };
}

/**
 * Where a run starts and where it ends: the start of the first piste, heading down it; a
 * finish line at the end of every piste that doesn't join another one.
 */
export function pisteEnds(pistes, curves) {
  let start = null;
  const finishes = [];
  for (const p of pistes) {
    const c = curves.get(p.id);
    if (!c) continue;
    if (!start && !c.from) {
      const k = Math.min(c.n - 1, 2);
      const [dx, dz] = curveDir(c, 0);
      start = { x: c.xs[k], z: c.zs[k], dir: [dx, dz], id: p.id };
    }
    if (!c.to) {
      const k = c.n - 1;
      const [dx, dz] = curveDir(c, k);
      finishes.push({ x: c.xs[k], z: c.zs[k], dir: [dx, dz], w: c.ws[k] + 10, id: p.id });
    }
  }
  return { start, finishes };
}

// ---------- carving ----------

let scratch = null;
function buffers(n) {
  if (!scratch || scratch.n !== n) {
    scratch = {
      n,
      d: new Float32Array(n).fill(Infinity),
      t: new Float32Array(n),
      c: new Float32Array(n),
      hw: new Float32Array(n),
      sh: new Float32Array(n),
      W: new Float32Array(n),
      T: new Float32Array(n),
    };
  }
  return scratch;
}

// the height the piste is carved to along a curve: the snow under it, smoothed, graded.
// And how wide its banks are: on a traverse the levelled piste cuts into the slope above
// and builds out over the slope below, so the bank widens to keep that gentle.
function profileOf(hf, c) {
  const raw = new Float32Array(c.n);
  const sh = new Float32Array(c.n);
  for (let k = 0; k < c.n; k++) {
    const x = c.xs[k];
    const z = c.zs[k];
    raw[k] = hf.heightAt(x, z);
    const [dx, dz] = curveDir(c, k);
    const hw = c.ws[k] / 2;
    // the fall of the snow across the piste, from one edge to the other
    const across = Math.abs(hf.heightAt(x - dz * hw, z + dx * hw) - hf.heightAt(x + dz * hw, z - dx * hw)) / 2;
    sh[k] = Math.min(MAX_SHOULDER, Math.max(SHOULDER, across * (1 - KEEP_TILT) * 1.6));
  }
  const avg = (a, r) => {
    const out = new Float32Array(a.length);
    for (let k = 0; k < a.length; k++) {
      let s = 0;
      let m = 0;
      for (let q = Math.max(0, k - r); q <= Math.min(a.length - 1, k + r); q++) {
        s += a[q];
        m++;
      }
      out[k] = s / m;
    }
    return out;
  };
  const sm = avg(raw, 3);
  // grading: no drop steeper than MAX_GRADE, half by filling below, half by cutting above
  const fill = new Float32Array(c.n);
  const cut = new Float32Array(c.n);
  fill[0] = sm[0];
  for (let k = 1; k < c.n; k++) fill[k] = Math.max(sm[k], fill[k - 1] - MAX_GRADE * (c.s[k] - c.s[k - 1]));
  cut[c.n - 1] = sm[c.n - 1];
  for (let k = c.n - 2; k >= 0; k--) cut[k] = Math.min(sm[k], cut[k + 1] + MAX_GRADE * (c.s[k + 1] - c.s[k]));
  const graded = new Float32Array(c.n);
  for (let k = 0; k < c.n; k++) graded[k] = (fill[k] + cut[k]) / 2;
  return { raw, t: avg(graded, 2), sh: avg(sh, 6) };
}

/**
 * Carve the pistes into hf. Returns { groomed, edge, bank }: groomed 0..1 per cell, the
 * distance from each cell to the nearest piste edge (negative on the piste, Infinity far
 * away) for clearing trees, and 1 on the pistes' banks (they stay snow, never bare rock).
 */
export function carvePistes(hf, curves) {
  const n = hf.nx * hf.nz;
  const B = buffers(n);
  const groomed = new Float32Array(n);
  const edge = new Float32Array(n).fill(Infinity);
  const bank = new Uint8Array(n);
  if (!curves.size) return { groomed, edge, bank };
  B.W.fill(0);
  B.T.fill(0);
  // the profiles first, all on the untouched snow; a joined end takes the height of the
  // piste it joins, eased in over its first (or last) 20 m, so the two meet level
  const prof = new Map();
  for (const c of curves.values()) {
    const p = profileOf(hf, c);
    const easeJoin = (join, atStart) => {
      const pc = join && curves.get(join.id);
      const pp = pc && prof.get(join.id);
      if (!pp) return;
      const a = curveAt(pc, join.f);
      const target = pp.t[a.k];
      for (let k = 0; k < c.n; k++) {
        const dist = atStart ? c.s[k] : c.L - c.s[k];
        if (dist > 20) continue;
        const e = smoothstep(0, 20, dist);
        p.t[k] = target + (p.t[k] - target) * e;
      }
    };
    easeJoin(c.from, true);
    easeJoin(c.to, false);
    prof.set(c.id, p);
  }
  const { cell, halfX, halfZ, nx, nz, h } = hf;
  for (const c of curves.values()) {
    const { t, raw, sh } = prof.get(c.id);
    // nearest point of this curve for every cell around it
    let bi0 = nx;
    let bi1 = -1;
    let bj0 = nz;
    let bj1 = -1;
    for (let k = 0; k < c.n - 1; k++) {
      const ax = c.xs[k];
      const az = c.zs[k];
      const bx = c.xs[k + 1];
      const bz = c.zs[k + 1];
      const R = Math.max(c.ws[k], c.ws[k + 1]) / 2 + Math.max(sh[k], sh[k + 1]) + 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + halfX) / cell));
      const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + R + halfX) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R + halfZ) / cell));
      const j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz) + R + halfZ) / cell));
      if (i0 < bi0) bi0 = i0;
      if (i1 > bi1) bi1 = i1;
      if (j0 < bj0) bj0 = j0;
      if (j1 > bj1) bj1 = j1;
      const dx = bx - ax;
      const dz = bz - az;
      const L2 = dx * dx + dz * dz || 1e-9;
      for (let j = j0; j <= j1; j++) {
        const z = j * cell - halfZ;
        const row = j * nx;
        for (let i = i0; i <= i1; i++) {
          const x = i * cell - halfX;
          let f = ((x - ax) * dx + (z - az) * dz) / L2;
          f = f < 0 ? 0 : f > 1 ? 1 : f;
          const px = ax + dx * f - x;
          const pz = az + dz * f - z;
          const d = Math.sqrt(px * px + pz * pz);
          const q = row + i;
          if (d < B.d[q]) {
            B.d[q] = d;
            B.t[q] = t[k] + (t[k + 1] - t[k]) * f;
            B.c[q] = raw[k] + (raw[k + 1] - raw[k]) * f;
            B.hw[q] = (c.ws[k] + (c.ws[k + 1] - c.ws[k]) * f) / 2;
            B.sh[q] = sh[k] + (sh[k + 1] - sh[k]) * f;
          }
        }
      }
    }
    // this piste's levelling weight, target height and groomed snow, added to the others
    for (let j = bj0; j <= bj1; j++) {
      const row = j * nx;
      for (let i = bi0; i <= bi1; i++) {
        const q = row + i;
        const d = B.d[q];
        if (d === Infinity) continue;
        const hw = B.hw[q];
        B.d[q] = Infinity;
        const w = 1 - smoothstep(hw, hw + B.sh[q], d);
        if (d - hw < edge[q]) edge[q] = d - hw;
        if (w <= 0) continue;
        bank[q] = 1;
        const target = B.t[q] + KEEP_TILT * (h[q] - B.c[q]);
        B.W[q] += w;
        B.T[q] += w * target;
        const g = 1 - smoothstep(hw - 1, hw + 1.5, d);
        if (g > groomed[q]) groomed[q] = g;
      }
    }
  }
  for (let q = 0; q < n; q++) {
    const W = B.W[q];
    if (W <= 0) continue;
    const a = W > 1 ? 1 : W;
    h[q] += (B.T[q] / W - h[q]) * a;
  }
  return { groomed, edge, bank };
}

// ---------- a first piste, traced for you ----------

/**
 * A natural line from the top of the mountain to the bottom: waypoints every ~90 m,
 * each one picked among a fan of candidates for an even, rideable pitch that avoids rock,
 * forest and the edges, without zig-zagging.
 */
export function suggestPiste(hf, rock, gen, w = DEFAULT_WIDTH) {
  const half = hf.halfX - 60;
  const uEnd = hf.finishZ - hf.startZ - 30;
  const slopeAlong = (x0, u0, x1, u1) => (hf.heightAt(x0, hf.startZ + u0) - hf.heightAt(x1, hf.startZ + u1)) / Math.hypot(x1 - x0, u1 - u0);
  const rockOn = (x0, u0, x1, u1) => {
    let m = 0;
    for (let t = 0; t <= 1; t += 0.1) {
      const x = x0 + (x1 - x0) * t;
      const z = hf.startZ + u0 + (u1 - u0) * t;
      const [gi, gj] = hf.toGrid(x, z);
      const v = rock[Math.max(0, Math.min(hf.nz - 1, Math.round(gj))) * hf.nx + Math.max(0, Math.min(hf.nx - 1, Math.round(gi)))] / 255;
      m = Math.max(m, v);
    }
    return m;
  };
  const ideal = Math.tan((Math.min(24, gen.deg) * Math.PI) / 180);
  // start: the most open spot near the top middle
  let x = 0;
  let bestStart = Infinity;
  for (let cx = -120; cx <= 120; cx += 20) {
    const cost = gen.trees(cx, 30, 0.1) * 2 + Math.abs(cx) / 300;
    if (cost < bestStart) {
      bestStart = cost;
      x = cx;
    }
  }
  let u = 24;
  const pts = [{ x, z: hf.startZ + u, w }];
  let lastDx = 0;
  while (u < uEnd - 20) {
    const step = Math.min(90, uEnd - u);
    let best = null;
    for (let off = -70; off <= 70; off += 10) {
      const nx = Math.max(-half, Math.min(half, x + off));
      const nu = u + step;
      const sl = slopeAlong(x, u, nx, nu);
      const cost =
        Math.abs(sl - ideal) * 6 +
        (sl < 0.05 ? 3 : 0) +
        rockOn(x, u, nx, nu) * 12 +
        gen.trees(nx, nu, 0.1) * 1.2 +
        Math.abs(nx) / half +
        Math.abs(off - lastDx * 0.5) / 120;
      if (!best || cost < best.cost) best = { cost, x: nx, u: nu, off };
    }
    lastDx = best.off;
    x = best.x;
    u = best.u;
    pts.push({ x, z: hf.startZ + u, w });
  }
  return pts;
}

// Where a new waypoint goes in piste p if it's dropped near sample k of its curve: between
// the two waypoints around it (an index into p.pts)
export function insertIndex(p, c, k) {
  let i = 0;
  while (i < c.ck.length && c.ck[i] <= k) i++;
  return Math.max(0, Math.min(p.pts.length, i - c.lead));
}
