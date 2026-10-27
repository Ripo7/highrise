// The mountain as you ride it: the wild base (wild.js), the pistes carved into it
// (piste.js), then the terrain pieces on top (terrain.js), so a bump or a wall on a piste
// shapes the piste too. Then the snow (groomed on the pistes, powder elsewhere and where
// you painted it, bare rock on cliffs and rock bands) and the trees and boulders, kept off
// the pistes.

import { pisteCurves, carvePistes, pisteEnds } from './piste.js';
import { applyTerrain } from './terrain.js';
import { smoothstep } from './heightfield.js';
import { TREE } from './props.js';
import { steepness } from './wild.js';

let rockBuf = null;
const scratchRock = (n) => (rockBuf && rockBuf.length === n ? rockBuf : (rockBuf = new Uint8Array(n)));

// a stable 0..1 number per prop, so clearing thins the same trees every time
const hash01 = (p) => (((Math.round(p.x * 10) * 73856093) ^ (Math.round(p.u * 10) * 19349663)) >>> 0) / 4294967296;

/**
 * Reset hf and surf to the base and build the pistes and pieces on it.
 * Returns { props, curves, ends }.
 */
export function buildWorld(hf, surf, base, { pistes = [], pieces = [] } = {}) {
  hf.h.set(base.h);
  const curves = pisteCurves(pistes);
  const { groomed, edge, bank } = carvePistes(hf, curves);
  const T = applyTerrain(hf, pieces);
  const { nx, nz } = hf;
  const n = nx * nz;
  // the snow
  const rockF = T.rock;
  const powF = T.powder;
  // bare rock: the mountain's rock bands, and any face too steep to hold snow (the pistes
  // are groomed snow, whatever is under them)
  const steep = steepness(hf, scratchRock(n));
  for (let q = 0; q < n; q++) {
    surf.g[q] = Math.round(255 * groomed[q]);
    surf.ice[q] = 0;
    surf.rock[q] = bank[q] ? 0 : Math.max(base.rock[q], steep[q]);
  }
  if (powF) {
    for (let jj = 0; jj < powF.h; jj++) {
      for (let ii = 0; ii < powF.w; ii++) {
        const q = (powF.j0 + jj) * nx + powF.i0 + ii;
        surf.g[q] = Math.round(surf.g[q] * (1 - smoothstep(0.3, 0.7, powF.f[jj * powF.w + ii])));
      }
    }
  }
  if (rockF) {
    for (let jj = 0; jj < rockF.h; jj++) {
      for (let ii = 0; ii < rockF.w; ii++) {
        const v = smoothstep(0.35, 0.6, rockF.f[jj * rockF.w + ii]);
        if (!v) continue;
        const q = (rockF.j0 + jj) * nx + rockF.i0 + ii;
        surf.rock[q] = Math.max(surf.rock[q], Math.round(255 * v));
        surf.g[q] = Math.round(surf.g[q] * (1 - v));
      }
    }
  }
  surf.version++;

  // trees and boulders: off the pistes (a few metres into the bank), off the rock bands,
  // thinned by clearings
  const cellOf = (p) => {
    const [gi, gj] = hf.toGrid(p.x, hf.startZ + p.u);
    const i = Math.round(gi);
    const j = Math.round(gj);
    return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i;
  };
  const keep = (p, natural) => {
    const q = cellOf(p);
    if (q < 0) return false;
    const jitter = hash01(p) * 3;
    if (edge[q] < (p.k === TREE ? 3 : 1.5) + jitter) return false;
    if (rockF && T.fieldAt(rockF, q % nx, Math.floor(q / nx)) > 0.25) return false;
    if (natural && T.clearing) {
      const c = T.fieldAt(T.clearing, q % nx, Math.floor(q / nx));
      if (c > 0.15 + 0.6 * hash01(p)) return false;
    }
    return true;
  };
  const props = base.forest.filter((p) => keep(p, true)).concat(T.trees.filter((p) => keep(p, false)));
  return { props, curves, ends: pisteEnds(pistes, curves) };
}
