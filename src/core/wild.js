// Wild mountains: a generated face of snow to shape and ride anywhere. Every mountain
// is different (a seed), you pick how big and how steep. It has the shapes of a real
// mountain: a summit shoulder at the top, steeper pitches and rolls on the way down, spurs
// and gullies running down the fall line, a couple of wide bowls (combes), knolls, bands
// of rock across the slope, and a run-out at the bottom. Forest grows below the treeline
// in woods with clearings, thicker on the spurs than in the gullies (avalanche paths stay
// open), never on the rock; boulders sit on the steep bits and below the cliffs.
//
// Everything is a pure function of the seed and the position, so the same mountain can be
// sampled at full resolution for the game or coarsely for a preview.
//
// Coordinates: x across (0 = middle), u = metres down from the top line (z = startZ + u).

import { makeValueNoise, smoothstep, START_MARGIN, FINISH_MARGIN } from './heightfield.js';
import { TREE, ROCK, rng } from './props.js';

export const SIZES = [
  { id: 'small', label: 'Small', W: 600, L: 700 },
  { id: 'medium', label: 'Medium', W: 720, L: 1100 },
  { id: 'large', label: 'Large', W: 840, L: 1600 },
];

export const STEEPNESS = [
  { id: 'gentle', label: 'Gentle', deg: 15, blurb: 'Rolling, open, easy to trace' },
  { id: 'medium', label: 'Medium', deg: 22, blurb: 'Spurs, gullies and a few cliffs' },
  { id: 'steep', label: 'Steep', deg: 29, blurb: 'Big faces, rock bands, couloirs' },
];

const VERTEX_BUDGET = 430000; // keep the terrain mesh light enough for phones

export function newWild(size = 'medium', steep = 'medium', seed = Math.floor(Math.random() * 1e6)) {
  return { size, steep, seed };
}

export const sizeOf = (m) => SIZES.find((s) => s.id === m.size) || SIZES[1];
export const steepOf = (m) => STEEPNESS.find((s) => s.id === m.steep) || STEEPNESS[1];

// Grid size for a mountain: 1.5 m cells, a little coarser on the big ones
export function wildDims(m) {
  const { W, L } = sizeOf(m);
  const sizeZ = START_MARGIN + L + FINISH_MARGIN;
  const cell = Math.min(2.5, Math.max(1.5, Math.sqrt((W * sizeZ) / VERTEX_BUDGET)));
  return { sizeX: W, sizeZ, cell: Math.round(cell * 20) / 20 };
}

/**
 * The mountain as functions of position: height(x, u), rock(x, u) (0..1, rock bands),
 * trees(x, u, slope) (0..1 forest density). Pure: no grid involved.
 */
export function makeWild(m) {
  const { W, L } = sizeOf(m);
  const st = steepOf(m);
  const half = W / 2;
  const seed = (m.seed >>> 0) % 1000003;
  const r = rng(seed * 2654435761 + 12345);
  const k = (st.deg - 8) / 14; // 0.5 gentle, 1 medium, 1.5 steep: how wild the shapes get
  const n1 = makeValueNoise(seed + 1);
  const n2 = makeValueNoise(seed + 2);
  const n3 = makeValueNoise(seed + 3);
  const n4 = makeValueNoise(seed + 4);
  const n5 = makeValueNoise(seed + 5);
  const nf = makeValueNoise(4242);
  const np = makeValueNoise(777);

  // the descent seen from the side, every 2 m: easier at the top, pitches and rolls, a
  // run-out at the bottom (the slope also eases off a little as you go down)
  const STEP = 2;
  const nProf = Math.ceil((L + 200) / STEP) + 1;
  const prof = new Float64Array(nProf);
  const t0 = Math.tan((st.deg * Math.PI) / 180);
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  const l1 = 260 + r() * 160;
  const l2 = 110 + r() * 60;
  for (let i = 1; i < nProf; i++) {
    const u = (i - 0.5) * STEP;
    let s = 1 + 0.17 * Math.sin((2 * Math.PI * u) / l1 + p1) + 0.1 * Math.sin((2 * Math.PI * u) / l2 + p2) + 0.08 * n5(u * 0.013, 1.7);
    s *= 0.45 + 0.55 * smoothstep(0, 110, u); // the summit shoulder
    s *= 1.12 - 0.24 * Math.min(1, u / L);
    s *= 1 - 0.7 * smoothstep(L - 120, L + 10, u); // run-out
    prof[i] = prof[i - 1] - t0 * Math.max(0.05, s) * STEP;
  }
  const profAt = (u) => {
    if (u <= 0) return -u * 0.08; // flat-ish above the top line
    const f = u / STEP;
    const i = Math.min(nProf - 2, Math.floor(f));
    const t = Math.min(1, f - i);
    return prof[i] + (prof[i + 1] - prof[i]) * t;
  };

  // the face leans a little left or right, more in some places than others
  const tiltA = (r() - 0.5) * 0.09;
  const tiltB = (r() - 0.5) * 0.06;
  const tiltL = 500 + r() * 400;

  // bowls (combes) and knolls
  const bowls = [];
  for (let i = 0, n = 1 + Math.floor(r() * 2.5); i < n; i++) {
    bowls.push({ x: (r() - 0.5) * W * 0.6, u: L * (0.12 + r() * 0.5), R: 80 + r() * 70, d: (9 + r() * 8) * (0.6 + 0.4 * k) });
  }
  const knolls = [];
  for (let i = 0, n = 3 + Math.floor(r() * 4); i < n; i++) {
    knolls.push({ x: (r() - 0.5) * W * 0.8, u: L * (0.1 + r() * 0.8), R: 25 + r() * 30, h: (4 + r() * 6) * (0.6 + 0.4 * k) });
  }
  // rock bands across the slope: a face a few metres high, the slope below easing back
  const bands = [];
  const nBands = st.id === 'gentle' ? 1 : st.id === 'medium' ? 2 + Math.floor(r() * 2) : 3 + Math.floor(r() * 2);
  for (let i = 0; i < nBands; i++) {
    bands.push({
      u: L * (0.18 + r() * 0.62),
      x: (r() - 0.5) * W * 0.75,
      len: 45 + r() * 110, // half length
      d: (4 + r() * 5) * (0.7 + 0.3 * k),
      ph: r() * 6.28,
      wl: 30 + r() * 30,
    });
  }

  let lift = 0;
  for (let i = 0; i < nProf; i++) lift = Math.min(lift, prof[i]);
  lift = 70 - lift;

  // spurs and gullies: ridged noise stretched down the fall line, gently meandering
  // (rounded: a skier can ride over a spur and down a gully, no knife edges)
  const soft = (v) => 1 - Math.sqrt(v * v + 0.03);
  const ridges = (x, u) => {
    const wx = x + 70 * n4(x * 0.0035, u * 0.0028) + 30 * n4(x * 0.01 + 5, u * 0.008);
    const wu = u + 40 * n5(x * 0.004 + 3, u * 0.004);
    const a = soft(n1(wx / 105, wu / 270));
    const b = soft(n1(wx / 52 + 11, wu / 140 + 3));
    return Math.max(0, Math.min(1, (a * 0.7 + b * 0.3 - 0.3) / 0.5)); // 0 in the gullies .. 1 on the spurs
  };

  const bandAt = (x, u) => {
    let drop = 0;
    let rock = 0;
    for (const b of bands) {
      const dx = Math.abs(x - b.x);
      if (dx > b.len) continue;
      const taper = smoothstep(b.len, b.len - 30, dx);
      const ub = b.u + 10 * Math.sin((x - b.x) / b.wl + b.ph);
      const du = u - ub;
      if (du < -6 || du > 90) continue;
      // the face (6 m), then the slope below eases back to the mountain over 80 m
      drop += b.d * taper * (smoothstep(-3, 3, du) - smoothstep(3, 85, du));
      rock = Math.max(rock, taper * (1 - smoothstep(2.5, 4.5, Math.abs(du - 0.3))));
    }
    return { drop, rock };
  };

  const height = (x, u) => {
    const ax = Math.abs(x);
    let h = profAt(u) + lift;
    h += x * (tiltA + tiltB * Math.sin((2 * Math.PI * u) / tiltL)) * smoothstep(-10, 120, u);
    // spurs and gullies, calmer on the summit shoulder and in the run-out
    const amp = (6 + 9 * k) * (0.35 + 0.65 * smoothstep(20, 220, u)) * (1 - 0.6 * smoothstep(L - 220, L, u));
    h += amp * (ridges(x, u) - 0.6);
    for (const b of bowls) {
      const d2 = ((x - b.x) ** 2 + ((u - b.u) * 0.8) ** 2) / (b.R * b.R);
      if (d2 < 9) h -= b.d * Math.exp(-2 * d2);
    }
    for (const q of knolls) {
      const d2 = ((x - q.x) ** 2 + (u - q.u) ** 2) / (q.R * q.R);
      if (d2 < 9) h += q.h * Math.exp(-2.2 * d2);
    }
    h -= bandAt(x, u).drop;
    // rolls and texture
    h += 2.4 * n2(x / 60, u / 60) + 0.9 * n3(x / 24 + 7, u / 24);
    h += 0.7 * nf(x * 0.025, u * 0.025);
    const pn = np(x * 0.15, u * 0.15);
    h += 0.42 * Math.pow(Math.max(0, pn), 1.5) + 0.12 * pn + 0.22 * nf(x * 0.08 + 7, u * 0.08);
    // the diorama's raised rim
    h += 14 * smoothstep(half - 40, half - 2, ax);
    return h;
  };

  const forestN = makeValueNoise(seed + 11);
  const forestN2 = makeValueNoise(seed + 37);
  const treeline = L * (0.18 + r() * 0.14);
  // forest density 0..1 at a point (slope: 0 flat .. 1 vertical, from the terrain normal)
  const trees = (x, u, slope) => {
    const patch = 0.7 * forestN(x * 0.0065, u * 0.0065) + 0.3 * forestN2(x * 0.03 + 9, u * 0.03);
    const woods = smoothstep(-0.12, 0.2, patch);
    const line = smoothstep(treeline - 60, treeline + 120, u); // few trees up high
    const spur = 0.45 + 0.55 * smoothstep(0.3, 0.7, ridges(x, u)); // gullies stay more open
    const steep = 1 - smoothstep(0.2, 0.34, slope);
    const rim = smoothstep(half - 90, half - 30, Math.abs(x)) * 0.5;
    return Math.min(1, (woods * spur + 0.035) * (0.1 + 0.9 * line) * steep + rim * steep * line);
  };

  return { m, W, L, deg: st.deg, height, rock: (x, u) => bandAt(x, u).rock, trees, bands, treeline };
}

/**
 * Resize hf (and surf) to the mountain and fill them: heights, the rock bands, the natural
 * forest and boulders. Returns the base the pieces are built on:
 * { m, W, L, gen, h, rock, forest } (rock: the bands; steep faces are found on the final
 * snow, see world.js).
 */
export function buildWild(hf, surf, m, cell = null) {
  const gen = makeWild(m);
  const d = wildDims(m);
  hf.resize(d.sizeX, d.sizeZ, cell || d.cell);
  if (surf) surf.resize(hf);
  const n = hf.nx * hf.nz;
  for (let j = 0; j < hf.nz; j++) {
    const u = j * hf.cell - hf.halfZ - hf.startZ;
    const row = j * hf.nx;
    for (let i = 0; i < hf.nx; i++) hf.h[row + i] = gen.height(i * hf.cell - hf.halfX, u);
  }
  // rock: the bands, and (to keep trees off them) the steepest faces
  const rock = new Uint8Array(n);
  const steepRock = steepness(hf);
  for (let j = 0; j < hf.nz; j++) {
    const u = j * hf.cell - hf.halfZ - hf.startZ;
    for (let i = 0; i < hf.nx; i++) if (gen.bands.length) rock[j * hf.nx + i] = Math.round(255 * gen.rock(i * hf.cell - hf.halfX, u));
  }
  for (let q = 0; q < n; q++) steepRock[q] = Math.max(steepRock[q], rock[q]);
  const forest = scatterWild(hf, gen, steepRock, m.seed);
  return { m, W: gen.W, L: gen.L, gen, h: hf.copy(), rock, forest };
}

// Bare rock where the snow can't hold: faces steeper than about 45 degrees (0..255 per cell)
export function steepness(hf, out = new Uint8Array(hf.nx * hf.nz)) {
  const { nx, nz, h } = hf;
  const c2 = 2 * hf.cell;
  for (let j = 0; j < nz; j++) {
    const jm = j > 0 ? j - 1 : 0;
    const jp = j < nz - 1 ? j + 1 : nz - 1;
    for (let i = 0; i < nx; i++) {
      const im = i > 0 ? i - 1 : 0;
      const ip = i < nx - 1 ? i + 1 : nx - 1;
      const gx = (h[j * nx + ip] - h[j * nx + im]) / c2;
      const gz = (h[jp * nx + i] - h[jm * nx + i]) / c2;
      const g2 = gx * gx + gz * gz;
      // smoothstep(1, 1.25, |g|) (45 to 51 degrees) without the square root
      out[j * nx + i] = g2 <= 1 ? 0 : g2 >= 1.5625 ? 255 : Math.round(255 * smoothstep(1, 1.25, Math.sqrt(g2)));
    }
  }
  return out;
}

// The natural forest and boulders, on a jittered 8 m grid
export function scatterWild(hf, gen, rock, seed = 1) {
  const out = [];
  const rand = rng(seed * 7919 + 1);
  const n2 = makeValueNoise(seed + 23);
  const step = 8;
  const half = hf.halfX - 6;
  const uMax = hf.finishZ - hf.startZ - 4;
  for (let u = -8; u < uMax; u += step) {
    for (let x = -half; x < half; x += step) {
      const px = x + rand() * step;
      const pu = u + rand() * step;
      const roll = rand();
      const size = rand();
      const rot = rand() * 6.283;
      if (pu > uMax || Math.abs(px) > half) continue;
      const z = hf.startZ + pu;
      const nrm = hf.normalAt(px, z);
      const slope = 1 - nrm[1];
      const [gi, gj] = hf.toGrid(px, z);
      const rk = rock[Math.min(hf.nz - 1, Math.round(gj)) * hf.nx + Math.min(hf.nx - 1, Math.round(gi))] / 255;
      const pTree = rk > 0.3 ? 0 : gen.trees(px, pu, slope) * 0.8;
      // boulders: on the steep bits, at the foot of the cliffs, a few anywhere
      const below = gen.bands.length ? gen.rock(px, pu - 9) : 0;
      const pRock = 0.006 + 0.16 * smoothstep(0.15, 0.4, slope) + 0.35 * below + 0.03 * Math.max(0, n2(px * 0.03, pu * 0.03) - 0.4);
      if (roll < pTree) out.push({ k: TREE, u: pu, x: px, s: 0.7 + size * 0.75, r: rot });
      else if (roll < pTree + pRock * (1 - 0.7 * rk)) out.push({ k: ROCK, u: pu, x: px, s: 0.6 + size * size * 2.3, r: rot });
    }
  }
  return out;
}
