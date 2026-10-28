// The mountain as you ride it: the wild base (wild.js) with your tiles on top (tiles.js,
// terrain.js). Then the snow (packed, powder and ice where you put them, bare rock on the
// cliffs, the rock bands and any face too steep to hold snow, but never on a kicker) and
// the trees and boulders: the natural forest less your clearings, plus the trees you
// planted, none on the rock, on a jump or a drop, or right on the start gate.

import { applyTerrain } from './terrain.js';
import { smoothstep } from './heightfield.js';
import { TREE } from './props.js';
import { steepness } from './wild.js';

let rockBuf = null;
const scratchRock = (n) => (rockBuf && rockBuf.length === n ? rockBuf : (rockBuf = new Uint8Array(n)));

// a stable 0..1 number per prop, so clearing thins the same trees every time
const hash01 = (p) => (((Math.round(p.x * 10) * 73856093) ^ (Math.round(p.u * 10) * 19349663)) >>> 0) / 4294967296;

export const GATE_CLEAR = 7; // metres kept clear around the start gate

/**
 * Reset hf and surf to the base and build the tiles on it.
 * start: { x, z } of the start gate (nothing grows on it), or null.
 * Returns { props }.
 */
export function buildWorld(hf, surf, base, { tiles = [], start = null } = {}) {
  hf.h.set(base.h);
  const T = applyTerrain(hf, tiles);
  const { nx, nz } = hf;
  const n = nx * nz;
  const rockF = T.rock;
  // bare rock: the mountain's rock bands, and any face too steep to hold snow (a kicker's
  // back is steep, but it's snow)
  const steep = steepness(hf, scratchRock(n));
  for (const K of T.kickers) {
    for (let jj = 0; jj < K.h; jj++) {
      for (let ii = 0; ii < K.w; ii++) {
        const k = K.f[jj * K.w + ii];
        if (k) {
          const q = (K.j0 + jj) * nx + K.i0 + ii;
          steep[q] = Math.round(steep[q] * (1 - k));
        }
      }
    }
  }
  for (let q = 0; q < n; q++) {
    surf.g[q] = 0;
    surf.ice[q] = 0;
    surf.pow[q] = 0;
    surf.rock[q] = Math.max(base.rock[q], steep[q]);
  }
  // powder and ice where you put them
  const paint = (F, arr) => {
    if (!F) return;
    for (let jj = 0; jj < F.h; jj++) {
      for (let ii = 0; ii < F.w; ii++) {
        const q = (F.j0 + jj) * nx + F.i0 + ii;
        arr[q] = Math.round(255 * smoothstep(0.2, 0.6, F.f[jj * F.w + ii]));
      }
    }
  };
  paint(T.powder, surf.pow);
  paint(T.ice, surf.ice);
  if (rockF) {
    for (let jj = 0; jj < rockF.h; jj++) {
      for (let ii = 0; ii < rockF.w; ii++) {
        const v = smoothstep(0.35, 0.6, rockF.f[jj * rockF.w + ii]);
        if (!v) continue;
        const q = (rockF.j0 + jj) * nx + rockF.i0 + ii;
        surf.rock[q] = Math.max(surf.rock[q], Math.round(255 * v));
        surf.pow[q] = Math.round(surf.pow[q] * (1 - v));
        surf.ice[q] = Math.round(surf.ice[q] * (1 - v));
      }
    }
  }
  surf.version++;

  // trees and boulders: off the rock, the jumps and the drops, thinned by clearings, clear of
  // the start gate
  const cellOf = (p) => {
    const [gi, gj] = hf.toGrid(p.x, hf.startZ + p.u);
    const i = Math.round(gi);
    const j = Math.round(gj);
    return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i;
  };
  const su = start ? start.z - hf.startZ : 0;
  const keep = (p, natural) => {
    const q = cellOf(p);
    if (q < 0) return false;
    if (start && Math.hypot(p.x - start.x, p.u - su) < GATE_CLEAR + (p.k === TREE ? 0 : -3)) return false;
    if (rockF && T.fieldAt(rockF, q % nx, Math.floor(q / nx)) > 0.25) return false;
    if (T.noTrees && T.fieldAt(T.noTrees, q % nx, Math.floor(q / nx)) > 0.1) return false;
    if (natural && T.clearing) {
      const c = T.fieldAt(T.clearing, q % nx, Math.floor(q / nx));
      if (c > 0.15 + 0.6 * hash01(p)) return false;
    }
    return true;
  };
  const props = base.forest.filter((p) => keep(p, true)).concat(T.trees.filter((p) => keep(p, false)));
  return { props };
}

// The fall line around (x, z), averaged over a few metres: [dx, dz] (straight down the map
// on the flat)
export function fallLine(hf, x, z, r = 6) {
  const gx = hf.heightAt(x - r, z) - hf.heightAt(x + r, z);
  const gz = hf.heightAt(x, z - r) - hf.heightAt(x, z + r);
  const l = Math.hypot(gx, gz);
  return l > 0.05 ? [gx / l, gz / l] : [0, 1];
}

// A good spot for the start gate near the top: the most open snow near the middle
export function defaultStart(hf, base) {
  let best = null;
  for (let x = -120; x <= 120; x += 10) {
    const u = 28;
    const z = hf.startZ + u;
    const near = base.forest.filter((p) => Math.abs(p.x - x) < 12 && Math.abs(p.u - u) < 16).length;
    const cost = near * 3 + Math.abs(x) / 40;
    if (!best || cost < best.cost) best = { cost, x, z };
  }
  return { x: best.x, z: best.z };
}
