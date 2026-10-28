// The slope you design at the start: sections down the fall line, each with its pitch and
// its length, on a mountain as wide as you choose. That's the bare snow (no natural rolls,
// forest or rock: those are yours to add with the tiles); world.js builds the tiles on it.
//
//   design: { width: 'narrow' | 'medium' | 'wide', sections: [{ slope, length }, ...] }
//   slope in degrees (negative climbs), length in metres along the ground's map distance
//
// The joints between sections are eased over a few metres, so a change of pitch rolls over
// (a convex one) or scoops (a concave one) rather than kinking. Plain data and pure
// functions: no Three.js, so it runs in tests.

import { START_MARGIN, FINISH_MARGIN } from './heightfield.js';

export const LIMITS = {
  slope: { min: -15, max: 50, step: 1 },
  length: { min: 20, max: 400, step: 10 },
};
export const MAX_SECTIONS = 24;
export const MIN_LENGTH = 100;
export const MAX_LENGTH = 3000;
export const MIN_DROP = 20;
const VERTEX_BUDGET = 430000; // keep the terrain mesh light enough for phones
const EASE = 9; // metres either side of a joint

export const WIDTHS = [
  { id: 'narrow', label: 'Narrow', W: 360 },
  { id: 'medium', label: 'Medium', W: 540 },
  { id: 'wide', label: 'Wide', W: 720 },
];
export const widthOf = (d) => (WIDTHS.find((w) => w.id === d.width) || WIDTHS[1]).W;

// Piste difficulty colours by angle (European convention)
export function difficulty(deg) {
  if (deg < -1) return 'up';
  if (deg < 12) return 'green';
  if (deg < 22) return 'blue';
  if (deg < 32) return 'red';
  return 'black';
}

const S = (slope, length) => ({ slope, length });
export const TEMPLATES = [
  { id: 'classic', name: 'Classic', blurb: 'A red with a steep pitch in the middle', sections: [S(14, 100), S(22, 160), S(12, 80), S(28, 180), S(18, 140), S(8, 80)] },
  { id: 'cruiser', name: 'Cruiser', blurb: 'A long, easy blue', sections: [S(10, 80), S(16, 200), S(12, 120), S(18, 220), S(9, 120)] },
  { id: 'park', name: 'Park', blurb: 'Steady and even: room for jumps', sections: [S(10, 60), S(16, 360), S(10, 120)] },
  { id: 'big', name: 'Big mountain', blurb: 'Long, steep and committing', sections: [S(18, 120), S(30, 220), S(20, 120), S(36, 200), S(26, 260), S(12, 120)] },
];

export function templateDesign(id = 'classic', width = 'medium') {
  const t = TEMPLATES.find((x) => x.id === id) || TEMPLATES[0];
  return { width, sections: t.sections.map((s) => ({ ...s })) };
}

export const cloneDesign = (d) => ({ width: d.width, sections: d.sections.map((s) => ({ slope: s.slope, length: s.length })) });
export const sameDesign = (a, b) => !!a && !!b && a.width === b.width && a.sections.length === b.sections.length && a.sections.every((s, k) => s.slope === b.sections[k].slope && s.length === b.sections[k].length);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// every value on its step and inside its limits, a known width, at least one section
export function normalizeDesign(d) {
  const out = { width: WIDTHS.some((w) => w.id === d?.width) ? d.width : 'medium', sections: [] };
  const list = Array.isArray(d?.sections) ? d.sections.slice(0, MAX_SECTIONS) : [];
  for (const s of list) {
    const sec = {};
    for (const [k, lim] of Object.entries(LIMITS)) {
      const v = Number.isFinite(+s?.[k]) ? +s[k] : k === 'slope' ? 18 : 100;
      sec[k] = clamp(Math.round(v / lim.step) * lim.step, lim.min, lim.max);
    }
    out.sections.push(sec);
  }
  if (!out.sections.length) out.sections = templateDesign().sections;
  return out;
}

export function designLength(d) {
  return d.sections.reduce((s, x) => s + x.length, 0);
}

// where each section starts, metres down from the top line
export function sectionStarts(d) {
  const out = [];
  let u = 0;
  for (const s of d.sections) {
    out.push(u);
    u += s.length;
  }
  return out;
}

const grade = (deg) => Math.tan((deg * Math.PI) / 180);

/**
 * The slope seen from the side, every metre from the top line to the bottom:
 * e[k] = elevation at k metres down (0 at the top, negative going down). Pitches change
 * smoothly over about ±EASE metres at each joint.
 */
export function profile(d) {
  const secs = d.sections;
  const L = Math.max(1, Math.round(designLength(d)));
  const starts = sectionStarts(d);
  const g = secs.map((s) => grade(s.slope));
  // the ease at each joint k (between section k-1 and k): never more than half a section
  const ease = secs.map((s, k) => (k === 0 ? 0 : Math.min(EASE, secs[k - 1].length / 2, s.length / 2)));
  const gradeAt = (u) => {
    let k = 0;
    while (k < secs.length - 1 && u >= starts[k + 1]) k++;
    let v = g[k];
    const a = u - starts[k];
    if (k > 0 && a < ease[k]) v = g[k - 1] + (g[k] - g[k - 1]) * smooth01((a + ease[k]) / (2 * ease[k]));
    const b = starts[k] + secs[k].length - u;
    if (k < secs.length - 1 && b < ease[k + 1]) v = g[k] + (g[k + 1] - g[k]) * smooth01((ease[k + 1] - b) / (2 * ease[k + 1]));
    return v;
  };
  const e = new Float32Array(L + 1);
  let prev = gradeAt(0);
  for (let k = 1; k <= L; k++) {
    const gk = gradeAt(k);
    e[k] = e[k - 1] - 0.5 * (prev + gk);
    prev = gk;
  }
  return { e, L };
}

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// elevation at u metres down from the top line, beyond the ends too: above the top the
// first pitch carries on at half its grade (a shoulder), below the bottom a gentle run-out
export function elevationAt(p, u, d) {
  const { e, L } = p;
  if (u <= 0) return -0.5 * Math.max(0, grade(d.sections[0].slope)) * u;
  if (u >= L) return e[L] - Math.min(0.08, Math.max(0, grade(d.sections[d.sections.length - 1].slope))) * (u - L);
  const i = Math.floor(u);
  const t = u - i;
  return e[i] + (e[Math.min(L, i + 1)] - e[i]) * t;
}

export function designStats(d) {
  const L = designLength(d);
  const p = profile(d);
  const drop = -p.e[p.L];
  let maxDeg = -90;
  let minDeg = 90;
  for (const s of d.sections) {
    maxDeg = Math.max(maxDeg, s.slope);
    minDeg = Math.min(minDeg, s.slope);
  }
  const avgDeg = L > 0 ? (Math.atan2(drop, L) * 180) / Math.PI : 0;
  let reason = '';
  if (L < MIN_LENGTH) reason = `Too short: make it at least ${MIN_LENGTH} m long.`;
  else if (L > MAX_LENGTH) reason = `Too long: ${MAX_LENGTH / 1000} km at most.`;
  else if (drop < MIN_DROP) reason = `Not enough drop: it has to go down at least ${MIN_DROP} m.`;
  return { length: L, drop, avgDeg, maxDeg, minDeg, ok: !reason, reason };
}

// Grid size for a design: 1.5 m cells, a little coarser on the big ones
export function designDims(d) {
  const W = widthOf(d);
  const sizeZ = START_MARGIN + Math.min(MAX_LENGTH, designLength(d)) + FINISH_MARGIN;
  const cell = Math.min(2.5, Math.max(1.5, Math.sqrt((W * sizeZ) / VERTEX_BUDGET)));
  return { sizeX: W, sizeZ, cell: Math.round(cell * 20) / 20 };
}

/**
 * Resize hf (and surf) to the design and fill it with the bare slope. Returns the base the
 * tiles are built on: { design, W, L, h, rock, forest } (no rock, no forest: all yours).
 */
export function buildSlope(hf, surf, design) {
  const d = normalizeDesign(design);
  const dims = designDims(d);
  hf.resize(dims.sizeX, dims.sizeZ, dims.cell);
  if (surf) surf.resize(hf);
  const p = profile(d);
  const top = 200 + Math.max(0, -p.e[p.L]); // keep every height comfortably above zero
  for (let j = 0; j < hf.nz; j++) {
    const u = j * hf.cell - hf.halfZ - hf.startZ;
    const y = top + elevationAt(p, u, d);
    hf.h.fill(y, j * hf.nx, (j + 1) * hf.nx);
  }
  return { design: d, W: dims.sizeX, L: p.L, h: hf.copy(), rock: new Uint8Array(hf.nx * hf.nz), forest: [] };
}

// Saves from the wild mountains (size, steepness, seed): about the same length, width and
// steepness, as sections with a steeper pitch or two
const WILD = {
  size: { small: { W: 'medium', L: 700 }, medium: { W: 'wide', L: 1100 }, large: { W: 'wide', L: 1600 } },
  steep: { gentle: 15, medium: 22, steep: 29 },
};
export function designFromWild(m) {
  const sz = WILD.size[m?.size] || WILD.size.medium;
  const deg = WILD.steep[m?.steep] || 22;
  const parts = [
    [0.15, -5],
    [0.3, 4],
    [0.15, -7],
    [0.25, 3],
    [0.15, -9],
  ];
  return normalizeDesign({ width: sz.W, sections: parts.map(([f, dd]) => ({ slope: deg + dd, length: Math.round((sz.L * f) / 10) * 10 })) });
}
