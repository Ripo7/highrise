// From a designed run to a mountain: the snow (heightfield), what it's like (surface map),
// the elements on it, and the forest beside the piste.
//
// The piste is a groomed lane down the run, `width` metres wide, following the bends.
// Outside it the snow is natural powder with soft pillows, and forest grows in patches
// with glades between them (more or less of it per section). A small ridge of snow marks
// the edge where the groomer passed.

import { makeValueNoise, smoothstep, START_MARGIN } from './heightfield.js';
import { profileAt, pisteDims } from './profile.js';
import { runGeometry, sampleAt, waveParams, waveAt, FOREST } from './run.js';
import { buildElements, insideClear, hashStr } from './elements.js';
import { TREE, ROCK, rng } from './props.js';

/**
 * Resize hf (and surf) to fit the run and fill them. Returns
 * { geo, start, finishX, props, structs }: the start gate position, the piste centre at
 * the finish, trees and rocks (in run coordinates) and structures (world coordinates).
 */
export function buildRun(hf, surf, run) {
  const geo = runGeometry(run);
  const L = geo.L;
  const { sizeX, sizeZ, cell } = pisteDims(L);
  hf.resize(sizeX, sizeZ, cell);
  surf.resize(hf);
  const noise = makeValueNoise(4242);
  const pillowN = makeValueNoise(777);
  const e = geo.e;
  let minE = 0;
  for (const v of e) minE = Math.min(minE, v);
  const lift = 66 - minE; // keep the lowest point (and its waves) well above zero
  // ease from the flat start area into the first slope with one gentle constant curve
  const ua = -START_MARGIN;
  const ub = Math.min(40, L * 0.25);
  const m = (profileAt(e, ub + 1) - profileAt(e, ub - 1)) / 2;
  const h0 = profileAt(e, ub) - (m * (ub - ua)) / 2;
  const half = hf.halfX;
  for (let j = 0; j < hf.nz; j++) {
    const u = j * hf.cell - START_MARGIN;
    const z = j * hf.cell - hf.halfZ;
    const base = (u < ub ? h0 + (m / (2 * (ub - ua))) * (u - ua) * (u - ua) : profileAt(e, u)) + lift;
    const uc = Math.min(L, Math.max(0, u));
    const xc = sampleAt(geo.xc, uc);
    const pw = sampleAt(geo.w, uc) / 2;
    const wp = u >= 0 && u <= L ? waveParams(run, geo, u) : null;
    const row = j * hf.nx;
    for (let i = 0; i < hf.nx; i++) {
      const x = i * hf.cell - half;
      const d = x - xc;
      const ad = Math.abs(d);
      const g = 1 - smoothstep(pw - 1.5, pw + 2.5, ad); // groomed
      const dish = 6 * (d / half) * (d / half);
      const lips = 14 * smoothstep(half - 40, half - 2, Math.abs(x));
      const broad = 0.7 * noise(x * 0.025, z * 0.025);
      const fine = 0.25 * noise(x * 0.08 + 7, z * 0.08);
      // soft pillows of untouched powder
      const pn = pillowN(x * 0.15, z * 0.15);
      const pillows = 0.42 * Math.pow(Math.max(0, pn), 1.5) + 0.12 * pn;
      // the groomer leaves a little ridge of snow along the edge of the piste
      const er = ad - pw - 1.8;
      const windrow = 0.32 * Math.exp(-(er * er) / 2.2);
      hf.h[row + i] = base + dish + lips + broad + (1 - g) * (fine + pillows) + windrow + waveAt(wp, u, d);
      surf.g[row + i] = Math.round(g * 255);
    }
  }
  const els = buildElements(hf, surf, run, geo);
  const forest = scatterForest(hf, run, geo, els.clear);
  surf.version++;
  return {
    geo,
    start: { x: sampleAt(geo.xc, 0), z: hf.startZ },
    finishX: sampleAt(geo.xc, L),
    props: els.props.concat(forest),
    structs: els.structs,
  };
}

/**
 * Forest beside the piste, section by section (each section's own density and seed, so
 * editing one section doesn't reshuffle the trees everywhere else). Woods grow in patches
 * with glades between them, thin out near the piste so the powder next to it is rideable,
 * thicken towards the far edges of the mountain, and stay out of every element's way.
 */
export function scatterForest(hf, run, geo, clear = []) {
  const out = [];
  const n1 = makeValueNoise(11);
  const n2 = makeValueNoise(23);
  const n3 = makeValueNoise(37);
  const step = 10;
  const half = hf.halfX - 6;
  const finishU = hf.finishZ - hf.startZ;
  const x0 = sampleAt(geo.xc, 0);
  const xF = sampleAt(geo.xc, geo.L);
  geo.starts.forEach((u0, si) => {
    const s = run.sections[si];
    const u1 = Math.min(geo.L, u0 + s.length);
    const dens = (FOREST[s.forest] || FOREST[1]).d;
    const rand = rng(hashStr(`${s.id}:forest`));
    for (let u = u0; u < u1; u += step) {
      for (let x = -half; x < half; x += step) {
        const px = x + rand() * step;
        const pu = u + rand() * step;
        const roll = rand();
        const size = rand();
        const rot = rand() * 6.283;
        if (pu >= u1 || pu > finishU - 10) continue;
        if (pu < 60 && Math.abs(px - x0) < 70) continue; // room around the start gate
        if (pu > finishU - 50 && Math.abs(px - xF) < 40) continue; // and under the finish arch
        const out_ = Math.abs(px - sampleAt(geo.xc, pu)) - sampleAt(geo.w, pu) / 2; // metres off the piste
        if (out_ < 3) continue;
        const z = hf.startZ + pu;
        if (insideClear(clear, px, z)) continue;
        const near = smoothstep(3, 24, out_);
        const patch = 0.7 * n1(px * 0.007, pu * 0.007) + 0.3 * n3(px * 0.03 + 9, pu * 0.03);
        const woods = smoothstep(0.62 - 0.5 * dens, 0.72 - 0.3 * dens, patch) * (0.25 + 0.6 * dens);
        const edge = smoothstep(170, 232, Math.abs(px)) * 0.45 * (0.4 + 0.6 * dens);
        const pTree = Math.min(0.85, (woods + 0.02 + 0.04 * dens + edge) * near);
        const nrm = hf.normalAt(px, z);
        const steep = smoothstep(0.3, 0.55, 1 - nrm[1]);
        const pRock = (0.02 + 0.2 * steep + 0.06 * Math.max(0, n2(px * 0.03, pu * 0.03) - 0.4)) * (0.35 + 0.65 * near);
        if (roll < pTree) out.push({ k: TREE, u: pu, x: px, s: 0.75 + size * 0.7, r: rot });
        else if (roll < pTree + pRock) out.push({ k: ROCK, u: pu, x: px, s: 0.7 + size * size * 2.2, r: rot });
      }
    }
  });
  return out;
}
