// The mountain as you ride it: its base (mountain.js) with your pieces built on top
// (pieces.js), and the base forest kept out of their way.

import { applyPieces, tileOf } from './pieces.js';
import { TILE, GRID_COLS, sampleAt } from './mountain.js';

/**
 * Reset hf and surf to the mountain's base and build the pieces on it.
 * Returns { props, structs }: trees and rocks (run coordinates), structures (world).
 */
export function buildWorld(hf, surf, base, pieces) {
  hf.h.set(base.h);
  surf.g.set(base.g);
  surf.ice.fill(0);
  const ctx = applyPieces(hf, surf, base, pieces);
  const forest = base.forest.filter((p) => {
    const t = tileOf(p.x, p.u);
    if (ctx.clearTiles.has(`${t.i},${t.j}`)) return false;
    for (const b of ctx.clearBoxes) if (p.x > b.x0 && p.x < b.x1 && p.u > b.u0 && p.u < b.u1) return false;
    return true;
  });
  surf.version++;
  return { props: forest.concat(ctx.props), structs: ctx.structs };
}

// A few pieces to start with, along the piste: something to jump, grind and ride through
export function starterPieces(base) {
  const L = base.L;
  const col = (u, off = 0) => Math.max(0, Math.min(GRID_COLS - 1, Math.floor((sampleAt(base.lane.xc, u) + off + GRID_COLS * TILE * 0.5) / TILE)));
  const row = (u) => Math.floor(u / TILE);
  const out = [];
  const at = (k, u, off = 0, c = col(u, off)) => {
    if (u > L - 60) return;
    out.push({ k, i: c, j: row(u), r: 0 });
  };
  // a two-wide kicker, a box, a gate, a table, trees and a cannon by the start
  at('cannon', 40, 32);
  at('kicker', 120, 0, col(120, -5));
  at('kicker', 120, 0, col(120, -5) + 1);
  at('trees', 160, 0, col(165, 34));
  at('trees', 170, 0, col(165, 34));
  at('trees', 170, 0, col(165, 34) + 1);
  at('box', 230, 0, col(235));
  at('box', 240, 0, col(235));
  at('gate', 300, 0);
  at('mound', 350, -25, col(355, -25));
  at('mound', 360, -25, col(355, -25));
  at('table', 400, 0);
  at('gate', 470, 0);
  at('poles', 520, 0, col(530, 26));
  at('poles', 540, 0, col(530, 26));
  at('kicker', 620, 0);
  at('chalet', 700, 0, col(700, 40));
  at('chalet', 700, 0, col(700, 40) + 1);
  return out;
}
