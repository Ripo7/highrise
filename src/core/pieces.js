// Building pieces, placed on the mountain's 10 m grid (like building in Fortnite): pick a
// piece, it snaps to the tiles under your finger, and pieces next to each other join up.
//
// Each piece sits on one layer, so a tile can hold one of each: terrain (shapes the snow),
// surface (groomed or powder) and object (jumps, trees, rails, buildings...).
//
// How neighbours join (`merge`):
//   field   any shape blends into one: mounds make a ridge, trees a forest, groom a piste
//   across  side by side in a row: kickers make one wide kicker, bridges a longer span
//   along   end to end down the slope: rails make one long rail
//   rect    a filled rectangle becomes one: a bigger chalet, a longer and wider half-pipe
//   none    each stays on its own
//
// Pieces are stored as { k, i, j, r }: kind, column (0 = far left), row (0 = start line,
// down the run), rotation (nets only: 0 down the slope, 1 across).

import { smoothstep, MIN_H, MAX_H } from './heightfield.js';
import { TREE, ROCK, rng } from './props.js';
import { stampShape } from './stamps.js';
import { difficulty } from './profile.js';
import { TILE, GRID_COLS, GRID_X0, sampleAt } from './mountain.js';

export const CATEGORIES = [
  { id: 'terrain', label: 'Terrain' },
  { id: 'jumps', label: 'Jumps' },
  { id: 'nature', label: 'Nature' },
  { id: 'park', label: 'Park' },
  { id: 'resort', label: 'Resort' },
];

export const PIECES = {
  mound: { cat: 'terrain', layer: 't', label: 'Mound', merge: 'field', hint: 'A rounded hump. Side by side they make a ridge or a hill.' },
  hollow: { cat: 'terrain', layer: 't', label: 'Hollow', merge: 'field', hint: 'A dip. Together they make a bowl or a trench.' },
  flat: { cat: 'terrain', layer: 't', label: 'Flat', merge: 'field', hint: 'A level shelf. Its downhill edge is a lip to pop off.' },
  steep: { cat: 'terrain', layer: 't', label: 'Steeper', merge: 'field', hint: 'A steeper pitch. A row across makes a full-width face.' },
  drop: { cat: 'terrain', layer: 't', label: 'Drop', merge: 'rect', hint: 'A rock step to drop off. Wider and longer make it bigger.' },
  groom: { cat: 'terrain', layer: 's', label: 'Groom', merge: 'field', hint: 'Groomed piste: fast and grippy.' },
  powder: { cat: 'terrain', layer: 's', label: 'Powder', merge: 'field', hint: 'Deep untouched snow: slower, soft landings, big spray.' },
  kicker: { cat: 'jumps', label: 'Kicker', h: 2, merge: 'across', line: true, gap: 3, hint: 'Side by side they make one wide kicker.' },
  table: { cat: 'jumps', label: 'Table', h: 3, merge: 'across', line: true, gap: 3, hint: 'A jump with a flat top. Side by side they get wider.' },
  berm: { cat: 'jumps', label: 'Wall', h: 2, merge: 'rect', line: true, hint: 'A banked wall to carve against. End to end it gets longer.' },
  rollers: { cat: 'jumps', label: 'Rollers', h: 2, merge: 'rect', line: true, hint: 'Whoops to pump or pop. End to end the line gets longer.' },
  trees: { cat: 'nature', label: 'Trees', merge: 'field', hint: 'Pines. Paint an area for a forest.' },
  rock: { cat: 'nature', label: 'Rock', merge: 'none', hint: 'A boulder. Jump it or go around.' },
  moguls: { cat: 'nature', label: 'Moguls', merge: 'field', hint: 'A field of bumps. Paint as big as you like.' },
  gully: { cat: 'nature', label: 'Gully', h: 2, merge: 'rect', line: true, hint: 'A natural trench. End to end it runs on, side by side it widens.' },
  cornice: { cat: 'nature', label: 'Cornice', merge: 'across', line: true, gap: 2, hint: 'A wind lip. A row across makes one long lip.' },
  lake: { cat: 'nature', layer: 't', label: 'Frozen lake', merge: 'field', hint: 'A flat sheet of ice: fast and slippery.' },
  rail: { cat: 'park', label: 'Rail', merge: 'along', line: true, hint: 'Ride up its ramp lined up with it to grind. End to end: one long rail.' },
  box: { cat: 'park', label: 'Box', merge: 'along', line: true, hint: 'A wide, low box: easier than a rail. End to end: one long box.' },
  pipe: { cat: 'park', label: 'Half-pipe', w: 2, h: 2, merge: 'rect', line: true, hint: 'Ride up its walls and air out. End to end it gets longer.' },
  chalet: { cat: 'resort', label: 'Chalet', merge: 'rect', line: true, hint: 'A building. Fill a rectangle for a bigger one.' },
  lift: { cat: 'resort', label: 'Lift pylon', merge: 'none', line: true, gap: 8, hint: 'Pylons in the same column are joined by a chairlift.' },
  bridge: { cat: 'resort', label: 'Bridge', merge: 'across', line: true, hint: 'A footbridge across the run. A row makes a longer span.' },
  tunnel: { cat: 'resort', label: 'Tunnel', merge: 'rect', line: true, hint: 'A snow tunnel. End to end it gets longer, side by side wider.' },
  net: { cat: 'resort', label: 'Safety net', merge: 'along', line: true, rotates: true, hint: 'Orange netting that catches you. Rotate to run it across.' },
  poles: { cat: 'resort', label: 'Piste poles', merge: 'none', line: true, gap: 1, hint: 'Marker poles in the colour of the slope.' },
  gate: { cat: 'resort', label: 'Slalom gate', merge: 'none', line: true, gap: 3, hint: 'Ride between the poles for points.' },
  cannon: { cat: 'resort', label: 'Snow cannon', merge: 'none', line: true, gap: 4, hint: 'Blows a plume of snow over the piste.' },
};

export const pieceW = (k) => PIECES[k]?.w || 1;
export const pieceH = (k) => PIECES[k]?.h || 1;
export const pieceLayer = (k) => PIECES[k]?.layer || 'o';

export const tileX0 = (i) => GRID_X0 + i * TILE;
export const tileOf = (x, u) => ({ i: Math.floor((x - GRID_X0) / TILE), j: Math.floor(u / TILE) });
const key = (i, j) => `${i},${j}`;

export function gridRows(L) {
  return Math.max(1, Math.floor(L / TILE));
}

export function footprint(p) {
  const out = [];
  const w = pieceW(p.k);
  const h = pieceH(p.k);
  for (let dj = 0; dj < h; dj++) for (let di = 0; di < w; di++) out.push([p.i + di, p.j + dj]);
  return out;
}

export function inGrid(p, rows) {
  return p.i >= 0 && p.j >= 0 && p.i + pieceW(p.k) <= GRID_COLS && p.j + pieceH(p.k) <= rows;
}

// Add pieces; anything on the same layer under them is replaced. Returns a new list.
export function placePieces(pieces, add, rows) {
  const valid = add.filter((p) => PIECES[p.k] && inGrid(p, rows));
  if (!valid.length) return pieces;
  const taken = new Set();
  for (const p of valid) for (const [i, j] of footprint(p)) taken.add(`${pieceLayer(p.k)}:${key(i, j)}`);
  const kept = pieces.filter((p) => !footprint(p).some(([i, j]) => taken.has(`${pieceLayer(p.k)}:${key(i, j)}`)));
  // a new piece over another new one (a drag doubling back): keep the first
  const seen = new Set();
  const fresh = [];
  for (const p of valid) {
    const fp = footprint(p).map(([i, j]) => `${pieceLayer(p.k)}:${key(i, j)}`);
    if (fp.some((t) => seen.has(t))) continue;
    fp.forEach((t) => seen.add(t));
    fresh.push({ k: p.k, i: p.i, j: p.j, r: p.r || 0 });
  }
  return kept.concat(fresh);
}

// Remove every piece covering any of these tiles (all layers). Returns a new list.
export function erasePieces(pieces, tiles) {
  const t = new Set(tiles.map(([i, j]) => key(i, j)));
  return pieces.filter((p) => !footprint(p).some(([i, j]) => t.has(key(i, j))));
}

// the pieces covering a tile, top layer first
export function piecesAt(pieces, i, j) {
  const order = { o: 0, t: 1, s: 2 };
  return pieces.filter((p) => footprint(p).some(([a, b]) => a === i && b === j)).sort((a, b) => order[pieceLayer(a.k)] - order[pieceLayer(b.k)]);
}

// drop pieces that no longer fit the mountain (after a shorter one is picked)
export function trimPieces(pieces, rows) {
  return pieces.filter((p) => inGrid(p, rows));
}

/**
 * The pieces a drag from tile a to tile b would place. Painted pieces (1×1, no straight
 * row needed) follow the whole path; others make a straight row across or down the slope,
 * stepping by their size (plus a landing gap for jumps placed one below the other).
 */
export function rowPieces(k, a, b, r = 0) {
  const P = PIECES[k];
  const w = pieceW(k);
  const h = pieceH(k);
  const di = b.i - a.i;
  const dj = b.j - a.j;
  const out = [];
  if (Math.abs(di) >= Math.abs(dj)) {
    const n = Math.floor(Math.abs(di) / w);
    const s = Math.sign(di) || 1;
    for (let t = 0; t <= n; t++) out.push({ k, i: a.i + s * t * w, j: a.j, r });
  } else {
    const step = h + (P.gap || 0);
    const n = Math.floor(Math.abs(dj) / step);
    const s = Math.sign(dj) || 1;
    for (let t = 0; t <= n; t++) out.push({ k, i: a.i, j: a.j + s * t * step, r });
  }
  return out;
}

// tiles crossed by a straight line between two tiles (for painting)
export function lineTiles(a, b) {
  const out = [];
  const n = Math.max(Math.abs(b.i - a.i), Math.abs(b.j - a.j));
  for (let t = 0; t <= n; t++) {
    const f = n ? t / n : 0;
    out.push([Math.round(a.i + (b.i - a.i) * f), Math.round(a.j + (b.j - a.j) * f)]);
  }
  return out;
}

export const isPainted = (k) => k === 'erase' || (PIECES[k] && !PIECES[k].line && pieceW(k) === 1 && pieceH(k) === 1);

// ---------- saving ----------

const ORDER = Object.keys(PIECES);
export function packPieces(pieces) {
  const out = [];
  for (const p of pieces) out.push(ORDER.indexOf(p.k), p.i, p.j, p.r || 0);
  return out;
}

export function unpackPieces(a) {
  const out = [];
  if (!Array.isArray(a)) return out;
  for (let n = 0; n + 3 < a.length; n += 4) {
    const k = ORDER[a[n]];
    if (k) out.push({ k, i: a[n + 1] | 0, j: a[n + 2] | 0, r: a[n + 3] | 0 });
  }
  return out;
}

// ---------- building ----------

/**
 * Write every piece onto the mountain. hf and surf must hold the mountain's base (see
 * buildPieces in world.js). Returns { props, structs, clearTiles, clearBoxes }.
 */
export function applyPieces(hf, surf, base, pieces) {
  const ctx = {
    hf,
    surf,
    base,
    props: [],
    structs: [],
    clearTiles: new Set(), // base forest removed from these tiles
    clearBoxes: [], // ... and from these boxes (x0, x1, u0, u1): landings and margins
    rand: rng(1),
    prop(k, x, u, s) {
      if (Math.abs(x) > hf.halfX - 4 || u < -10) return;
      ctx.props.push({ k, u, x, s, r: ctx.rand() * 6.283 });
    },
  };
  // every tile with a piece clears the base forest
  for (const p of pieces) for (const [i, j] of footprint(p)) ctx.clearTiles.add(key(i, j));

  // terrain layer: shapes, then the surface layer, then objects (their snow first)
  const units = (layer) => groupUnits(pieces.filter((p) => pieceLayer(p.k) === layer));
  for (const u of units('t')) {
    ctx.rand = rng(seedOf(u));
    TERRAIN[u.k](ctx, u);
  }
  for (const u of units('s')) SURFACE[u.k](ctx, u);
  const objs = units('o');
  for (const u of objs) {
    ctx.rand = rng(seedOf(u));
    SHAPE[u.k]?.(ctx, u);
  }
  for (const u of objs) {
    ctx.rand = rng(seedOf(u) + 99);
    PLACE[u.k]?.(ctx, u);
  }
  // number the slalom gates down the run (alternating red / blue)
  ctx.structs
    .filter((s) => s.type === 'gate')
    .sort((a, b) => a.z - b.z)
    .forEach((g, n) => (g.order = n));
  return ctx;
}

const seedOf = (u) => (u.i0 * 7919 + u.j0 * 104729 + u.k.length * 31) >>> 0;

/**
 * Group pieces of each kind into build units following their merge rule.
 * A unit: { k, r, i0, i1, j0, j1, tiles (Set of "i,j"), cols, rows }.
 */
export function groupUnits(pieces) {
  const out = [];
  const byKind = new Map();
  for (const p of pieces) {
    const g = `${p.k}:${PIECES[p.k].rotates ? p.r || 0 : 0}`;
    if (!byKind.has(g)) byKind.set(g, []);
    byKind.get(g).push(p);
  }
  for (const [g, list] of byKind) {
    const k = g.split(':')[0];
    const r = +g.split(':')[1];
    const mode = PIECES[k].merge === 'along' && r === 1 ? 'across' : PIECES[k].merge;
    const unitOf = (ps) => {
      let i0 = Infinity;
      let i1 = -Infinity;
      let j0 = Infinity;
      let j1 = -Infinity;
      const tiles = new Set();
      for (const p of ps) {
        for (const [i, j] of footprint(p)) {
          tiles.add(key(i, j));
          i0 = Math.min(i0, i);
          i1 = Math.max(i1, i);
          j0 = Math.min(j0, j);
          j1 = Math.max(j1, j);
        }
      }
      return { k, r, i0, i1, j0, j1, tiles, cols: i1 - i0 + 1, rows: j1 - j0 + 1, count: ps.length };
    };
    if (mode === 'none') {
      for (const p of list) out.push(unitOf([p]));
    } else if (mode === 'across' || mode === 'along') {
      // runs of pieces touching end to end in a row (across) or a column (along)
      const line = mode === 'across' ? (p) => `${p.j}` : (p) => `${p.i}`;
      const pos = mode === 'across' ? (p) => p.i : (p) => p.j;
      const step = mode === 'across' ? pieceW(k) : pieceH(k);
      const lines = new Map();
      for (const p of list) {
        if (!lines.has(line(p))) lines.set(line(p), []);
        lines.get(line(p)).push(p);
      }
      for (const ps of lines.values()) {
        ps.sort((a, b) => pos(a) - pos(b));
        let run = [ps[0]];
        for (let n = 1; n < ps.length; n++) {
          if (pos(ps[n]) === pos(ps[n - 1]) + step) run.push(ps[n]);
          else {
            out.push(unitOf(run));
            run = [ps[n]];
          }
        }
        out.push(unitOf(run));
      }
    } else {
      // connected groups of tiles
      for (const comp of components(list)) {
        const u = unitOf(comp);
        if (mode === 'field' || u.tiles.size === u.cols * u.rows) out.push(u);
        else for (const p of comp) out.push(unitOf([p]));
      }
    }
  }
  return out;
}

function components(list) {
  const owner = new Map();
  list.forEach((p, n) => {
    for (const [i, j] of footprint(p)) owner.set(key(i, j), n);
  });
  const seen = new Set();
  const out = [];
  list.forEach((p, n) => {
    if (seen.has(n)) return;
    const comp = [];
    const stack = [n];
    seen.add(n);
    while (stack.length) {
      const m = stack.pop();
      comp.push(list[m]);
      for (const [i, j] of footprint(list[m])) {
        for (const [a, b] of [
          [i + 1, j],
          [i - 1, j],
          [i, j + 1],
          [i, j - 1],
        ]) {
          const o = owner.get(key(a, b));
          if (o !== undefined && !seen.has(o)) {
            seen.add(o);
            stack.push(o);
          }
        }
      }
    }
    out.push(comp);
  });
  return out;
}

// world rectangle of a unit: x across, u down the run
const rectOf = (u) => ({ x0: tileX0(u.i0), x1: tileX0(u.i1 + 1), u0: u.j0 * TILE, u1: (u.j1 + 1) * TILE });

/**
 * Add fn(x, u, k, h) to every height in the box [x0, x1] × [u0, u1] (u: metres down the
 * run). k is the cell index (to paint the surface), h the current height.
 */
export function stampBox(hf, x0, x1, u0, u1, fn) {
  const z0 = hf.startZ + u0;
  const z1 = hf.startZ + u1;
  const i0 = Math.max(0, Math.floor((x0 + hf.halfX) / hf.cell));
  const i1 = Math.min(hf.nx - 1, Math.ceil((x1 + hf.halfX) / hf.cell));
  const j0 = Math.max(0, Math.floor((z0 + hf.halfZ) / hf.cell));
  const j1 = Math.min(hf.nz - 1, Math.ceil((z1 + hf.halfZ) / hf.cell));
  for (let j = j0; j <= j1; j++) {
    const u = j * hf.cell - hf.halfZ - hf.startZ;
    for (let i = i0; i <= i1; i++) {
      const x = i * hf.cell - hf.halfX;
      const k = j * hf.nx + i;
      const v = fn(x, u, k, hf.h[k]);
      if (v) {
        const h = hf.h[k] + v;
        hf.h[k] = h < MIN_H ? MIN_H : h > MAX_H ? MAX_H : h;
      }
    }
  }
}

// Signed distance from (x, u) to the edge of a group of tiles: + inside, − outside
// (looked for up to 2 tiles away, so it saturates at ±20 m).
function depthIn(tiles, x, u) {
  const ti = Math.floor((x - GRID_X0) / TILE);
  const tj = Math.floor(u / TILE);
  const inside = tiles.has(key(ti, tj));
  let best = 2 * TILE;
  for (let dj = -2; dj <= 2; dj++) {
    for (let di = -2; di <= 2; di++) {
      const a = ti + di;
      const b = tj + dj;
      if (tiles.has(key(a, b)) === inside) continue;
      // distance from the point to that tile's square
      const rx0 = tileX0(a);
      const ru0 = b * TILE;
      const dx = Math.max(rx0 - x, 0, x - (rx0 + TILE));
      const du = Math.max(ru0 - u, 0, u - (ru0 + TILE));
      const d = Math.hypot(dx, du);
      if (d < best) best = d;
    }
  }
  return inside ? best : -best;
}

// run fn over a unit's tiles and `pad` metres around them, with the signed depth
function overField(ctx, u, pad, fn) {
  const r = rectOf(u);
  stampBox(ctx.hf, r.x0 - pad, r.x1 + pad, r.u0 - pad, r.u1 + pad, (x, uu, k, h) => fn(depthIn(u.tiles, x, uu), x, uu, k, h));
}

// mean snow height at the centres of a unit's tiles
function meanHeight(ctx, u) {
  let s = 0;
  let n = 0;
  for (const t of u.tiles) {
    const [i, j] = t.split(',').map(Number);
    s += ctx.hf.heightAt(tileX0(i) + TILE / 2, ctx.hf.startZ + (j + 0.5) * TILE);
    n++;
  }
  return s / Math.max(1, n);
}

const groom = (ctx, k) => {
  ctx.surf.g[k] = 255;
  ctx.surf.ice[k] = 0;
};

// ---------- terrain layer ----------

const TERRAIN = {
  mound(ctx, u) {
    overField(ctx, u, 8, (d) => {
      const q = smoothstep(-7, 6, d);
      return 2.4 * (1 + 0.5 * smoothstep(5, 20, d)) * q * q;
    });
  },
  hollow(ctx, u) {
    overField(ctx, u, 8, (d) => {
      const q = smoothstep(-7, 6, d);
      return -2.4 * (1 + 0.5 * smoothstep(5, 20, d)) * q * q;
    });
  },
  flat(ctx, u) {
    const plane = meanHeight(ctx, u);
    overField(ctx, u, 7, (d, x, uu, k, h) => (plane - h) * smoothstep(-6, 2, d));
  },
  lake(ctx, u) {
    const plane = meanHeight(ctx, u);
    const surf = ctx.surf;
    overField(ctx, u, 8, (d, x, uu, k, h) => {
      const ice = smoothstep(0, 1.5, d);
      if (ice > 0) {
        surf.ice[k] = Math.max(surf.ice[k], Math.round(ice * 255));
        surf.g[k] = Math.min(surf.g[k], Math.round((1 - ice) * 255));
      }
      return (plane - h) * smoothstep(-7, 1, d);
    });
  },
  steep(ctx, u) {
    // the slope gets steeper over the tiles: a little higher at the top, lower at the bottom
    const r = rectOf(u);
    const A = Math.tan((15 * Math.PI) / 180) * (r.u1 - r.u0);
    overField(ctx, u, 9, (d, x, uu) => A * (0.5 - smoothstep(r.u0, r.u1, uu)) * smoothstep(-8, 3, d));
  },
  drop(ctx, u) {
    // a shelf eases out of the slope above, then a rock wall drops at the bottom edge
    const r = rectOf(u);
    const H = Math.min(12, 2.5 + 1.6 * u.rows + 0.4 * u.cols);
    const lip = r.u1 - 1;
    const half = (r.x1 - r.x0) / 2;
    const xc = (r.x0 + r.x1) / 2;
    stampBox(ctx.hf, r.x0, r.x1, lip - 30, lip + 2, (x, uu) => {
      const side = 1 - smoothstep(half - 3, half, Math.abs(x - xc));
      const v = uu <= lip ? H * smoothstep(lip - 30, Math.max(lip - 28, r.u0 + 2), uu) : H * (1 - smoothstep(lip, lip + 1.5, uu));
      return v * side;
    });
    for (const s of [-1, 1]) {
      ctx.prop(ROCK, xc + s * (half + 0.4), lip - 1, 1.3 + ctx.rand() * 0.8);
      ctx.prop(ROCK, xc + s * (half - 2 - ctx.rand() * 3), lip + 3 + ctx.rand() * 2, 0.7 + ctx.rand() * 0.5);
    }
    ctx.clearBoxes.push({ x0: r.x0 - 4, x1: r.x1 + 4, u0: lip - 30, u1: lip + 35 });
  },
};

// ---------- surface layer ----------

const SURFACE = {
  groom(ctx, u) {
    const g = ctx.surf.g;
    overField(ctx, u, 2, (d, x, uu, k) => {
      const v = Math.round(255 * smoothstep(-1.5, 0.5, d));
      if (v > g[k]) {
        g[k] = v;
        ctx.surf.ice[k] = 0;
      }
      return 0;
    });
  },
  powder(ctx, u) {
    const g = ctx.surf.g;
    overField(ctx, u, 2, (d, x, uu, k) => {
      g[k] = Math.min(g[k], Math.round(255 * (1 - smoothstep(-1.5, 0.5, d))));
      return 0;
    });
  },
};

// ---------- objects: their snow ----------

const SHAPE = {
  kicker(ctx, u) {
    const r = rectOf(u);
    const L = r.u1 - r.u0 - 4;
    const W = r.x1 - r.x0 - 2;
    const H = Math.max(1.6, Math.min(4.5, 0.15 * L));
    stampAlong(ctx, r, 1, -2, L + 3, W / 2 + 1.5, (al, ac) => stampShape('kicker', al, ac, L, W, H));
    ctx.clearBoxes.push({ x0: r.x0 - 4, x1: r.x1 + 4, u0: r.u0 - 8, u1: r.u1 + 45 });
  },
  table(ctx, u) {
    const r = rectOf(u);
    const L = r.u1 - r.u0 - 2;
    const W = r.x1 - r.x0 - 2;
    stampAlong(ctx, r, 1, -2, L + 2, W / 2 + 2, (al, ac) => stampShape('table', al, ac, L, W, 2.7));
    ctx.clearBoxes.push({ x0: r.x0 - 4, x1: r.x1 + 4, u0: r.u0 - 8, u1: r.u1 + 30 });
  },
  berm(ctx, u) {
    const r = rectOf(u);
    const L = r.u1 - r.u0 - 8;
    const W = r.x1 - r.x0;
    const H = Math.min(9, 3.2 + 1.6 * (u.cols - 1));
    stampAlong(ctx, r, 4, -8, L + 8, W / 2, (al, ac) => stampShape('berm', al, ac, L, W, H));
  },
  rollers(ctx, u) {
    const r = rectOf(u);
    const L = r.u1 - r.u0 - 2;
    const W = r.x1 - r.x0 - 2;
    stampAlong(ctx, r, 1, -2, L + 2, W / 2 + 2, (al, ac) => stampShape('rollers', al, ac, L, W, 1.35));
  },
  moguls(ctx, u) {
    overField(ctx, u, 2, (d, x, uu) => {
      const fade = smoothstep(-1, 3, d);
      if (fade <= 0) return 0;
      return 1.25 * moguls(x, uu) * fade;
    });
  },
  gully(ctx, u) {
    const r = rectOf(u);
    const hw = (r.x1 - r.x0) / 2;
    const D = Math.min(7, 2.6 + 0.9 * u.cols);
    const xc = (r.x0 + r.x1) / 2;
    stampBox(ctx.hf, r.x0, r.x1, r.u0, r.u1, (x, uu, k) => {
      const ends = smoothstep(r.u0, r.u0 + 10, uu) * (1 - smoothstep(r.u1 - 10, r.u1, uu));
      const v = -D * 0.5 * (1 + Math.cos((Math.PI * (x - xc)) / hw)) * ends;
      if (v < -0.4) ctx.surf.g[k] = 0;
      return v;
    });
  },
  cornice(ctx, u) {
    const r = rectOf(u);
    const len = r.u1 - r.u0;
    const half = (r.x1 - r.x0) / 2;
    const xc = (r.x0 + r.x1) / 2;
    const H = 2.4;
    stampBox(ctx.hf, r.x0, r.x1, r.u0, r.u1, (x, uu) => {
      const al = uu - r.u0;
      const side = 1 - smoothstep(half - 6, half, Math.abs(x - xc));
      const v = al < len - 5 ? Math.pow(al / (len - 5), 1.6) : al < len - 3 ? 1 : 1 - smoothstep(len - 3, len - 0.5, al);
      return H * v * side;
    });
    ctx.clearBoxes.push({ x0: r.x0 - 3, x1: r.x1 + 3, u0: r.u0, u1: r.u1 + 30 });
  },
  rail(ctx, u) {
    railShape(ctx, u, false);
  },
  box(ctx, u) {
    railShape(ctx, u, true);
  },
  pipe(ctx, u) {
    const r = rectOf(u);
    const W = r.x1 - r.x0;
    const H = Math.min(6, 2.8 + 0.06 * W);
    const R = H;
    const tEnd = 0.97 * R;
    const lipW = 0.8;
    const F = W - 2 * (tEnd + lipW);
    const yEnd = -H + R - Math.sqrt(R * R - tEnd * tEnd);
    const xc = (r.x0 + r.x1) / 2;
    stampBox(ctx.hf, r.x0, r.x1, r.u0, r.u1, (x, uu, k) => {
      const f = smoothstep(r.u0, r.u0 + 16, uu) * (1 - smoothstep(r.u1 - 16, r.u1, uu));
      if (f <= 0) return 0;
      const t = Math.abs(x - xc) - F / 2;
      let y;
      if (t <= 0) y = -H;
      else if (t <= tEnd) y = -H + (R - Math.sqrt(R * R - t * t));
      else y = yEnd * (1 - smoothstep(tEnd, tEnd + lipW, t));
      groom(ctx, k);
      return y * f;
    });
  },
  chalet(ctx, u) {
    const r = rectOf(u);
    const C = { x: (r.x0 + r.x1) / 2, u: (r.u0 + r.u1) / 2 };
    const target = ctx.hf.heightAt(C.x, ctx.hf.startZ + C.u);
    const hx = (r.x1 - r.x0) / 2 - 0.5;
    const hz = (r.u1 - r.u0) / 2 - 0.5;
    stampBox(ctx.hf, r.x0 - 6, r.x1 + 6, r.u0 - 6, r.u1 + 6, (x, uu, k, h) => {
      const dd = Math.hypot(Math.max(0, Math.abs(x - C.x) - hx), Math.max(0, Math.abs(uu - C.u) - hz));
      const kf = 1 - smoothstep(0, 6, dd);
      if (kf > 0.5) groom(ctx, k);
      return (target - h) * kf * 0.9;
    });
  },
  tunnel(ctx, u) {
    const r = rectOf(u);
    stampBox(ctx.hf, r.x0, r.x1, r.u0 - 4, r.u1 + 4, (x, uu, k) => {
      groom(ctx, k);
      return 0;
    });
    ctx.clearBoxes.push({ x0: r.x0 - 5, x1: r.x1 + 5, u0: r.u0 - 8, u1: r.u1 + 8 });
  },
};

// a stamp running down the slope from `start` metres below the top of the rect, centred
function stampAlong(ctx, r, start, a0, a1, hw, fn) {
  const xc = (r.x0 + r.x1) / 2;
  const ua = r.u0 + start;
  stampBox(ctx.hf, xc - hw, xc + hw, ua + a0, ua + a1, (x, uu, k) => {
    const v = fn(uu - ua, x - xc);
    if (v > 0.05) groom(ctx, k);
    return v;
  });
}

function railShape(ctx, u, isBox) {
  const r = rectOf(u);
  const hr = isBox ? 0.6 : 1.0;
  const ramp = isBox ? 5 : 7;
  const xc = (r.x0 + r.x1) / 2;
  const ua = r.u0 + 1; // the rail starts just inside its first tile; the ramp leads in from above
  const ub = r.u1 - 1;
  const hf = ctx.hf;
  u.rail = {
    x0: xc,
    z0: hf.startZ + ua,
    y0: hf.heightAt(xc, hf.startZ + ua) + hr,
    x1: xc,
    z1: hf.startZ + ub,
    y1: hf.heightAt(xc, hf.startZ + ub) + hr,
    hr,
    box: isBox,
  };
  stampBox(hf, xc - 2.4, xc + 2.4, ua - ramp - 1, ua + 2.5, (x, uu, k) => {
    const side = 1 - smoothstep(1.3, 2.4, Math.abs(x - xc));
    const al = uu - (ua - ramp);
    const up = al <= ramp ? smoothstep(0, ramp, al) : 1 - smoothstep(ramp, ramp + 2.5, al);
    const v = (hr - 0.1) * up * side;
    if (v > 0.02) groom(ctx, k);
    return v;
  });
  stampBox(hf, xc - 2.5, xc + 2.5, ua, ub + 6, (x, uu, k) => {
    groom(ctx, k);
    return 0;
  });
  ctx.clearBoxes.push({ x0: xc - 7, x1: xc + 7, u0: ua - ramp - 6, u1: ub + 20 });
}

// a staggered lattice of bumps, in world coordinates so painted fields join seamlessly
function moguls(x, u) {
  const sa = 7.5;
  const sc = 6.5;
  const R = 3.5;
  let best = 0;
  const r0 = Math.round(u / sa);
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    const shift = (r & 1) * (sc / 2);
    const c0 = Math.round((x - shift) / sc);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      const hsh = hash2(r, c);
      const d = Math.hypot(u - (r * sa + (hsh - 0.5) * 1.4), x - (c * sc + shift + (hash2(c, r + 7) - 0.5) * 1.2));
      if (d < R) {
        const q = Math.cos((Math.PI * d) / (2 * R));
        best = Math.max(best, q * q * (0.8 + 0.4 * hsh));
      }
    }
  }
  return best;
}

function hash2(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---------- objects: trees, rocks and structures on the finished snow ----------

const PLACE = {
  trees(ctx, u) {
    for (const t of u.tiles) {
      const [i, j] = t.split(',').map(Number);
      const inner = [key(i + 1, j), key(i - 1, j), key(i, j + 1), key(i, j - 1)].every((n) => u.tiles.has(n));
      const n = inner ? 4 : 2 + (ctx.rand() < 0.5 ? 1 : 0);
      const pts = [];
      for (let tries = 0; tries < 30 && pts.length < n; tries++) {
        const x = tileX0(i) + 1.5 + ctx.rand() * (TILE - 3);
        const uu = j * TILE + 1.5 + ctx.rand() * (TILE - 3);
        if (pts.some((q) => Math.hypot(q[0] - x, q[1] - uu) < 3.6)) continue;
        pts.push([x, uu]);
        ctx.prop(TREE, x, uu, 0.75 + ctx.rand() * 0.6);
      }
    }
  },
  rock(ctx, u) {
    const r = rectOf(u);
    ctx.prop(ROCK, (r.x0 + r.x1) / 2 + (ctx.rand() - 0.5) * 3, (r.u0 + r.u1) / 2 + (ctx.rand() - 0.5) * 3, 1.3 + ctx.rand() * 1.1);
  },
  rail(ctx, u) {
    ctx.structs.push({ type: 'rail', ...u.rail });
  },
  box(ctx, u) {
    ctx.structs.push({ type: 'rail', ...u.rail });
  },
  chalet(ctx, u) {
    const r = rectOf(u);
    const size = u.count >= 4 ? 2 : u.count >= 2 ? 1 : 0;
    ctx.structs.push({
      type: 'chalet',
      x: (r.x0 + r.x1) / 2,
      z: ctx.hf.startZ + (r.u0 + r.u1) / 2,
      dir: [0, 1],
      w: r.x1 - r.x0 - 3,
      d: r.u1 - r.u0 - 3,
      size,
      seed: seedOf(u),
    });
  },
  lift(ctx, u) {
    const r = rectOf(u);
    ctx.structs.push({ type: 'pylon', x: (r.x0 + r.x1) / 2, z: ctx.hf.startZ + (r.u0 + r.u1) / 2, dir: [0, 1], h: 12, col: u.i0, u: (r.u0 + r.u1) / 2 });
  },
  bridge(ctx, u) {
    const r = rectOf(u);
    const uc = (r.u0 + r.u1) / 2;
    const z = ctx.hf.startZ + uc;
    const xc = (r.x0 + r.x1) / 2;
    const span = r.x1 - r.x0;
    let top = -Infinity;
    for (let x = r.x0; x <= r.x1; x += 2) top = Math.max(top, ctx.hf.heightAt(x, z));
    const mid = ctx.hf.heightAt(xc, z);
    ctx.structs.push({ type: 'bridge', x: xc, z, dir: [0, 1], span: Math.max(10, span - 2), deckY: Math.max(mid + 7, top + 3.4) });
  },
  tunnel(ctx, u) {
    const r = rectOf(u);
    const W = r.x1 - r.x0;
    ctx.structs.push({
      type: 'tunnel',
      x: (r.x0 + r.x1) / 2,
      z: ctx.hf.startZ + r.u0,
      dir: [0, 1],
      L: r.u1 - r.u0,
      hw: W / 2 - 1,
      ht: Math.min(8, 4.6 + 0.8 * (u.cols - 1)),
    });
  },
  net(ctx, u) {
    const r = rectOf(u);
    if (u.r === 1) {
      ctx.structs.push({ type: 'net', x: r.x0 + 0.5, z: ctx.hf.startZ + (r.u0 + r.u1) / 2, dir: [1, 0], L: r.x1 - r.x0 - 1, h: 2.2 });
    } else {
      ctx.structs.push({ type: 'net', x: (r.x0 + r.x1) / 2, z: ctx.hf.startZ + r.u0 + 0.5, dir: [0, 1], L: r.u1 - r.u0 - 1, h: 2.2 });
    }
  },
  poles(ctx, u) {
    const r = rectOf(u);
    const x = (r.x0 + r.x1) / 2;
    const z = ctx.hf.startZ + (r.u0 + r.u1) / 2;
    const n = ctx.hf.normalAt(x, z);
    const deg = (Math.atan2(Math.hypot(n[0], n[2]), n[1]) * 180) / Math.PI;
    ctx.structs.push({ type: 'pole', x, z, color: difficulty(deg) });
  },
  gate(ctx, u) {
    const r = rectOf(u);
    ctx.structs.push({ type: 'gate', x: (r.x0 + r.x1) / 2, z: ctx.hf.startZ + (r.u0 + r.u1) / 2, dir: [0, 1], gw: 7 });
  },
  cannon(ctx, u) {
    const r = rectOf(u);
    const x = (r.x0 + r.x1) / 2;
    const uc = (r.u0 + r.u1) / 2;
    // aim across at the piste and a little down the hill
    const lane = sampleAt(ctx.base.lane.xc, uc);
    const side = lane > x ? 1 : -1;
    const l = Math.hypot(1, 0.5);
    ctx.structs.push({ type: 'cannon', x, z: ctx.hf.startZ + uc, size: 1, aim: [side / l, 0.5 / l] });
  },
};
