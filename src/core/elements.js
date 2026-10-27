// Elements: what the player puts in the run editor's grid cells. Each one shapes the
// snow (kickers, cliffs, a half-pipe...), adds trees and rocks, or adds a structure
// (rails, chalets, lift pylons, nets...; see structures.js for how they collide).
//
// An element sits in one cell and is built down the run from there; big ones run over
// several rows (`rows`). Sizes are Small / Medium / Large. Everything is placed relative
// to the piste, so elements follow it when a section bends.

import { smoothstep, MIN_H, MAX_H } from './heightfield.js';
import { TREE, ROCK, rng } from './props.js';
import { stampShape } from './stamps.js';
import { CELL_M, GRID_COLS, sampleAt, laneDir, sectionRows, sectionDifficulty } from './run.js';

export const CATEGORIES = [
  { id: 'jumps', label: 'Jumps' },
  { id: 'nature', label: 'Nature' },
  { id: 'park', label: 'Park' },
  { id: 'resort', label: 'Resort' },
  { id: 'piste', label: 'Piste' },
];

export const SIZE_LABELS = ['Small', 'Medium', 'Large'];

// rows: how many grid rows the element covers (from its cell down), per size
export const ELEMENTS = {
  kicker: { cat: 'jumps', label: 'Kicker', rows: [1, 2, 2], hint: 'A jump. Hold Jump and release at the lip.' },
  table: { cat: 'jumps', label: 'Table', rows: [2, 3, 4], hint: 'A jump with a flat top and a landing slope.' },
  berm: { cat: 'jumps', label: 'Berm', rows: [2, 3, 4], hint: 'A banked wall to carve against.' },
  rollers: { cat: 'jumps', label: 'Rollers', rows: [2, 3, 4], hint: 'A line of whoops to pump or pop.' },
  trees: { cat: 'nature', label: 'Trees', rows: [1, 1, 1], hint: 'A few pines. More for a bigger size.' },
  rock: { cat: 'nature', label: 'Rock', rows: [1, 1, 1], hint: 'A boulder. Jump it or go around.' },
  cliff: { cat: 'nature', label: 'Cliff drop', rows: [1, 1, 1], hint: 'A rock band to drop off. Land on the slope below.' },
  moguls: { cat: 'nature', label: 'Moguls', rows: [1, 2, 3], hint: 'A field of bumps.' },
  gully: { cat: 'nature', label: 'Gully', rows: [2, 3, 5], hint: 'A natural trench to ride its walls.' },
  cornice: { cat: 'nature', label: 'Cornice', rows: [1, 1, 1], hint: 'A wind lip across the slope.' },
  lake: { cat: 'nature', label: 'Frozen lake', rows: [1, 2, 2], hint: 'A flat sheet of ice: fast and slippery.' },
  rail: { cat: 'park', label: 'Rail', rows: [1, 2, 2], hint: 'Ride up the ramp lined up with it to grind.' },
  box: { cat: 'park', label: 'Box', rows: [1, 1, 2], hint: 'A wide, low box: easier to grind than a rail.' },
  pipe: { cat: 'park', label: 'Half-pipe', rows: [3, 5, 7], hint: 'Ride up the walls and air out.' },
  chalet: { cat: 'resort', label: 'Chalet', rows: [1, 1, 1], sizes: ['Hut', 'Chalet', 'Lodge'], hint: 'A building. Ride around it.' },
  lift: { cat: 'resort', label: 'Lift pylon', rows: [1, 1, 1], hint: 'Pylons in the same column are joined by a chairlift.' },
  bridge: { cat: 'resort', label: 'Bridge', rows: [1, 1, 1], hint: 'A footbridge across the run. Ride under it.' },
  tunnel: { cat: 'resort', label: 'Tunnel', rows: [1, 2, 2], hint: 'A snow tunnel. Ride through it.' },
  net: { cat: 'piste', label: 'Safety net', rows: [1, 2, 3], hint: 'Orange netting along the run. It catches you.' },
  poles: { cat: 'piste', label: 'Piste poles', rows: [1, 2, 3], hint: 'Marker poles in the colour of the section.' },
  gate: { cat: 'piste', label: 'Slalom gate', rows: [1, 1, 1], hint: 'Ride between the poles for points.' },
  cannon: { cat: 'piste', label: 'Snow cannon', rows: [1, 1, 1], sizes: ['Fan gun', 'Tower', 'Big tower'], hint: 'Makes snow. Ride through the plume.' },
};

export const ELEMENT_ORDER = Object.keys(ELEMENTS);

export const sizeLabels = (k) => ELEMENTS[k]?.sizes || SIZE_LABELS;

// ---------- placing ----------

// Where a cell's element goes. at(along, across) gives a world point `along` metres down the
// piste from the top of the cell and `across` metres to the side (+x side).
function placement(hf, geo, starts, si, cell) {
  const uTop = starts[si] + cell.r * CELL_M;
  const off = (cell.c - (GRID_COLS - 1) / 2) * CELL_M;
  const dir = laneDir(geo, uTop + CELL_M / 2);
  const ax = sampleAt(geo.xc, uTop) + off;
  const az = hf.startZ + uTop;
  return {
    kind: cell.k,
    size: cell.s,
    si,
    r: cell.r,
    c: cell.c,
    uTop,
    off,
    dir,
    ax,
    az,
    at(along, across = 0) {
      return { x: ax + dir[0] * along + dir[1] * across, z: az + dir[1] * along - dir[0] * across };
    },
  };
}

/**
 * Add fn(along, across, k, h) to every height inside an oriented box: `along` in [a0, a1]
 * from point A in direction dir, `across` within ±hw. k is the cell index (for painting the
 * surface), h the current height. Returns the dirty rect.
 */
export function stamp(hf, A, dir, a0, a1, hw, fn) {
  const [dx, dz] = dir;
  const px = dz;
  const pz = -dx;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const a of [a0, a1]) {
    for (const b of [-hw, hw]) {
      const x = A.x + dx * a + px * b;
      const z = A.z + dz * a + pz * b;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  const i0 = Math.max(0, Math.floor((minX + hf.halfX) / hf.cell));
  const i1 = Math.min(hf.nx - 1, Math.ceil((maxX + hf.halfX) / hf.cell));
  const j0 = Math.max(0, Math.floor((minZ + hf.halfZ) / hf.cell));
  const j1 = Math.min(hf.nz - 1, Math.ceil((maxZ + hf.halfZ) / hf.cell));
  if (i0 > i1 || j0 > j1) return null;
  for (let j = j0; j <= j1; j++) {
    const z = j * hf.cell - hf.halfZ;
    for (let i = i0; i <= i1; i++) {
      const x = i * hf.cell - hf.halfX;
      const rx = x - A.x;
      const rz = z - A.z;
      const along = rx * dx + rz * dz;
      if (along < a0 || along > a1) continue;
      const across = rx * px + rz * pz;
      if (across < -hw || across > hw) continue;
      const k = j * hf.nx + i;
      const v = fn(along, across, k, hf.h[k]);
      if (v) {
        const h = hf.h[k] + v;
        hf.h[k] = h < MIN_H ? MIN_H : h > MAX_H ? MAX_H : h;
      }
    }
  }
  return { i0, i1, j0, j1 };
}

const pick = (arr, s) => arr[Math.max(0, Math.min(arr.length - 1, s))];
const abs = Math.abs;

// ---------- pass 1: shape the snow ----------

const TERRAIN = {
  kicker(ctx, p) {
    const L = pick([16, 22, 30], p.size);
    const W = pick([10, 14, 18], p.size);
    const H = pick([1.7, 2.8, 4.4], p.size);
    const A = p.at(1);
    stamp(ctx.hf, A, p.dir, -2, L + 3, W / 2 + 1.5, (al, ac, k) => {
      const v = stampShape('kicker', al, ac, L, W, H);
      if (v > 0.05) ctx.groom(k);
      return v;
    });
    ctx.keepClear(A, p.dir, -10, L + 50, W / 2 + 6);
  },
  table(ctx, p) {
    const L = pick([36, 46, 60], p.size);
    const W = pick([14, 18, 22], p.size);
    const H = pick([2, 3, 4.5], p.size);
    const A = p.at(1);
    stamp(ctx.hf, A, p.dir, -2, L + 2, W / 2 + 2, (al, ac, k) => {
      const v = stampShape('table', al, ac, L, W, H);
      if (v > 0.05) ctx.groom(k);
      return v;
    });
    ctx.keepClear(A, p.dir, -10, L + 30, W / 2 + 6);
  },
  berm(ctx, p) {
    const L = pick([40, 60, 80], p.size);
    const W = pick([16, 20, 26], p.size);
    const H = pick([3, 5, 8], p.size);
    const A = p.at(8);
    stamp(ctx.hf, A, p.dir, -8, L + 8, W / 2, (al, ac, k) => {
      const v = stampShape('berm', al, ac, L, W, H);
      if (v > 0.05) ctx.groom(k);
      return v;
    });
    ctx.keepClear(A, p.dir, -12, L + 12, W / 2 + 6);
  },
  rollers(ctx, p) {
    const L = pick([40, 60, 80], p.size);
    const W = pick([16, 18, 22], p.size);
    const H = pick([1.0, 1.5, 2.2], p.size);
    const A = p.at(0);
    stamp(ctx.hf, A, p.dir, -2, L + 2, W / 2 + 2, (al, ac, k) => {
      const v = stampShape('rollers', al, ac, L, W, H);
      if (v > 0.05) ctx.groom(k);
      return v;
    });
    ctx.keepClear(A, p.dir, -6, L + 10, W / 2 + 5);
  },
  cliff(ctx, p) {
    const H = pick([4, 7, 11], p.size);
    const W = pick([16, 20, 26], p.size);
    const lip = 15;
    const A = p.at(0);
    // the slope above eases off into a shelf, then drops away in a rock wall
    stamp(ctx.hf, A, p.dir, lip - 32, lip + 2, W / 2, (al, ac) => {
      const side = 1 - smoothstep(W / 2 - 3, W / 2, abs(ac));
      const v = al <= lip ? H * smoothstep(lip - 30, lip - 4, al) : H * (1 - smoothstep(lip, lip + 1.5, al));
      return v * side;
    });
    p.lip = lip;
    p.W = W;
    ctx.keepClear(A, p.dir, lip - 30, lip + 40, W / 2 + 6);
  },
  moguls(ctx, p) {
    const L = pick([20, 40, 60], p.size);
    const W = pick([20, 28, 36], p.size);
    const Hb = pick([0.9, 1.2, 1.5], p.size);
    const sa = 7.5;
    const sc = 6.5;
    const R = 3.5;
    const A = p.at(0);
    stamp(ctx.hf, A, p.dir, 0, L, W / 2, (al, ac) => {
      const fade = smoothstep(0, 4, al) * (1 - smoothstep(L - 4, L, al)) * (1 - smoothstep(W / 2 - 4, W / 2, abs(ac)));
      if (fade <= 0) return 0;
      let best = 0;
      const r0 = Math.round(al / sa);
      for (let r = r0 - 1; r <= r0 + 1; r++) {
        const shift = (r & 1) * (sc / 2);
        const c0 = Math.round((ac - shift) / sc);
        for (let c = c0 - 1; c <= c0 + 1; c++) {
          const hsh = hash2(r, c);
          const d = Math.hypot(al - (r * sa + (hsh - 0.5) * 1.4), ac - (c * sc + shift + (hash2(c, r + 7) - 0.5) * 1.2));
          if (d < R) {
            const q = Math.cos((Math.PI * d) / (2 * R));
            best = Math.max(best, q * q * (0.8 + 0.4 * hsh));
          }
        }
      }
      return Hb * best * fade;
    });
    ctx.keepClear(A, p.dir, -4, L + 4, W / 2 + 3);
  },
  gully(ctx, p) {
    const L = pick([40, 60, 100], p.size);
    const hw = pick([8, 9, 11], p.size);
    const D = pick([3, 4.5, 6], p.size);
    const A = p.at(0);
    stamp(ctx.hf, A, p.dir, 0, L, hw, (al, ac, k) => {
      const ends = smoothstep(0, 12, al) * (1 - smoothstep(L - 12, L, al));
      const v = -D * 0.5 * (1 + Math.cos((Math.PI * ac) / hw)) * ends;
      if (v < -0.4) ctx.powder(k); // wild snow in the gully
      return v;
    });
    ctx.keepClear(A, p.dir, -4, L + 4, hw + 4);
  },
  cornice(ctx, p) {
    const W = pick([30, 40, 56], p.size);
    const H = pick([2, 3, 4.5], p.size);
    const A = p.at(0);
    stamp(ctx.hf, A, p.dir, 0, 20, W / 2, (al, ac) => {
      const side = 1 - smoothstep(W / 2 - 8, W / 2, abs(ac));
      const v = al < 15 ? Math.pow(al / 15, 1.6) : al < 17 ? 1 : 1 - smoothstep(17, 19.5, al);
      return H * v * side;
    });
    ctx.keepClear(A, p.dir, -4, 50, W / 2 + 4);
  },
  lake(ctx, p) {
    const R = pick([10, 15, 20], p.size);
    const C = p.at(R);
    const target = ctx.hf.heightAt(C.x, C.z);
    const surf = ctx.surf;
    stamp(ctx.hf, C, p.dir, -(R + 8), R + 8, R + 8, (al, ac, k, h) => {
      const r = Math.hypot(al, ac);
      const kf = 1 - smoothstep(R - 2, R + 7, r);
      if (kf <= 0) return 0;
      const ice = 1 - smoothstep(R - 2.5, R - 0.5, r);
      if (ice > 0) {
        surf.ice[k] = Math.max(surf.ice[k], Math.round(ice * 255));
        surf.g[k] = Math.min(surf.g[k], Math.round((1 - ice) * 255));
      }
      return (target - h) * kf;
    });
    ctx.keepClear(C, p.dir, -(R + 6), R + 6, R + 6);
  },
  rail(ctx, p) {
    railTerrain(ctx, p, false);
  },
  box(ctx, p) {
    railTerrain(ctx, p, true);
  },
  pipe(ctx, p) {
    const L = pick([60, 100, 140], p.size);
    const W = pick([18, 22, 26], p.size);
    const H = pick([3.5, 4.5, 5.5], p.size);
    const R = H;
    const tEnd = 0.97 * R;
    const lipW = 0.8;
    const F = W - 2 * (tEnd + lipW);
    const yEnd = -H + R - Math.sqrt(R * R - tEnd * tEnd);
    const A = p.at(1);
    stamp(ctx.hf, A, p.dir, 0, L, W / 2, (al, ac, k) => {
      const f = smoothstep(0, 18, al) * (1 - smoothstep(L - 18, L, al));
      if (f <= 0) return 0;
      const t = abs(ac) - F / 2;
      let y;
      if (t <= 0) y = -H;
      else if (t <= tEnd) y = -H + (R - Math.sqrt(R * R - t * t));
      else y = yEnd * (1 - smoothstep(tEnd, tEnd + lipW, t));
      ctx.groom(k);
      return y * f;
    });
    ctx.keepClear(A, p.dir, -8, L + 10, W / 2 + 8);
  },
  chalet(ctx, p) {
    const [w, d] = pick(CHALET_DIMS, p.size);
    const C = p.at(10);
    const target = ctx.hf.heightAt(C.x, C.z);
    const hx = w / 2 + 1;
    const hz = d / 2 + 1;
    // a level pad of trodden snow around the building
    stamp(ctx.hf, C, p.dir, -(hz + 6), hz + 6, hx + 6, (al, ac, k, h) => {
      const dd = Math.hypot(Math.max(0, abs(ac) - hx), Math.max(0, abs(al) - hz));
      const kf = 1 - smoothstep(0, 6, dd);
      if (kf > 0.5) ctx.groom(k);
      return (target - h) * kf * 0.9;
    });
    ctx.keepClear(C, p.dir, -(hz + 5), hz + 5, hx + 5);
  },
  tunnel(ctx, p) {
    const L = pick(TUNNEL_LEN, p.size);
    const hw = pick([4.5, 5.5, 6.5], p.size);
    const A = p.at(0);
    stamp(ctx.hf, A, p.dir, -4, L + 4, hw + 1, (al, ac, k) => {
      ctx.groom(k);
      return 0;
    });
    ctx.keepClear(A, p.dir, -8, L + 8, hw + 6);
  },
  lift(ctx, p) {
    ctx.keepClear(p.at(10), p.dir, -5, 5, 5);
  },
  bridge(ctx, p) {
    const span = pick([30, 50, 70], p.size);
    ctx.keepClear(p.at(10), p.dir, -8, 8, span / 2 + 4);
  },
  net(ctx, p) {
    ctx.keepClear(p.at(0), p.dir, 0, pick([20, 40, 60], p.size), 3);
  },
  gate(ctx, p) {
    const gw = pick([5, 7, 9], p.size);
    ctx.keepClear(p.at(10), p.dir, -10, 10, gw / 2 + 4);
  },
  cannon(ctx, p) {
    ctx.keepClear(p.at(10), p.dir, -5, 5, 5);
  },
};

const CHALET_DIMS = [
  [7, 6],
  [11, 9],
  [17, 12],
];
const TUNNEL_LEN = [20, 30, 40];

function railTerrain(ctx, p, isBox) {
  const Lr = isBox ? pick([8, 12, 16], p.size) : pick([10, 14, 18], p.size);
  const hr = isBox ? 0.6 : 1.0;
  const ramp = isBox ? 5 : 7;
  const A = p.at(1);
  // the rail runs parallel to the snow as it was, before its ramp went in
  const P0 = p.at(1 + ramp);
  const P1 = p.at(1 + ramp + Lr);
  const hf = ctx.hf;
  p.rail = {
    x0: P0.x,
    z0: P0.z,
    y0: hf.heightAt(P0.x, P0.z) + hr,
    x1: P1.x,
    z1: P1.z,
    y1: hf.heightAt(P1.x, P1.z) + hr,
    hr,
    box: isBox,
  };
  stamp(hf, A, p.dir, -1, ramp + 2.5, 2.4, (al, ac, k) => {
    const side = 1 - smoothstep(1.3, 2.4, abs(ac));
    const up = al <= ramp ? smoothstep(0, ramp, al) : 1 - smoothstep(ramp, ramp + 2.5, al);
    const v = (hr - 0.1) * up * side;
    if (v > 0.02) ctx.groom(k);
    return v;
  });
  stamp(hf, A, p.dir, ramp, ramp + Lr + 8, 2.5, (al, ac, k) => {
    ctx.groom(k);
    return 0;
  });
  ctx.keepClear(A, p.dir, -8, ramp + Lr + 25, 7);
}

// ---------- pass 2: trees, rocks and structures, on the finished snow ----------

const PLACE = {
  trees(ctx, p) {
    const n = pick([2, 4, 7], p.size);
    const pts = [];
    for (let t = 0; t < 40 && pts.length < n; t++) {
      const along = 2 + ctx.rand() * (CELL_M - 4);
      const across = (ctx.rand() - 0.5) * (CELL_M - 4);
      if (pts.some((q) => Math.hypot(q[0] - along, q[1] - across) < 4.2)) continue;
      pts.push([along, across]);
    }
    for (const [al, ac] of pts) {
      const w = p.at(al, ac);
      ctx.prop(TREE, w.x, w.z, 0.75 + ctx.rand() * 0.6);
    }
  },
  rock(ctx, p) {
    const w = p.at(CELL_M / 2 + (ctx.rand() - 0.5) * 4, (ctx.rand() - 0.5) * 4);
    ctx.prop(ROCK, w.x, w.z, pick([0.9, 1.6, 2.6], p.size));
  },
  cliff(ctx, p) {
    // boulders at both ends of the lip and a couple at the foot of the wall
    for (const side of [-1, 1]) {
      const w = p.at(p.lip - 1, side * (p.W / 2 + 0.5));
      ctx.prop(ROCK, w.x, w.z, 1.3 + ctx.rand() * 0.9);
      const f = p.at(p.lip + 3 + ctx.rand() * 2, side * (p.W / 2 - 1 - ctx.rand() * 3));
      ctx.prop(ROCK, f.x, f.z, 0.7 + ctx.rand() * 0.5);
    }
  },
  rail(ctx, p) {
    ctx.struct({ type: 'rail', ...p.rail });
  },
  box(ctx, p) {
    ctx.struct({ type: 'rail', ...p.rail });
  },
  chalet(ctx, p) {
    const [w, d] = pick(CHALET_DIMS, p.size);
    const C = p.at(10);
    ctx.struct({ type: 'chalet', x: C.x, z: C.z, dir: p.dir, w, d, size: p.size, seed: Math.floor(ctx.rand() * 1e6) });
  },
  lift(ctx, p) {
    const C = p.at(10);
    ctx.struct({ type: 'pylon', x: C.x, z: C.z, dir: p.dir, h: pick([10, 13, 16], p.size), col: p.c, u: p.uTop + 10 });
  },
  bridge(ctx, p) {
    const C = p.at(10);
    const clear = pick([6, 7, 8], p.size);
    const span = pick([30, 50, 70], p.size);
    // the deck sits `clear` metres over the highest snow under it
    let top = -Infinity;
    for (let s = -span / 2; s <= span / 2; s += 2) {
      const q = p.at(10, s);
      top = Math.max(top, ctx.hf.heightAt(q.x, q.z));
    }
    const mid = ctx.hf.heightAt(C.x, C.z);
    ctx.struct({ type: 'bridge', x: C.x, z: C.z, dir: p.dir, span, deckY: Math.max(mid + clear, top + 3.2) });
  },
  tunnel(ctx, p) {
    const A = p.at(0);
    ctx.struct({ type: 'tunnel', x: A.x, z: A.z, dir: p.dir, L: pick(TUNNEL_LEN, p.size), hw: pick([4.5, 5.5, 6.5], p.size), ht: pick([5, 6, 7], p.size) });
  },
  net(ctx, p) {
    const A = p.at(0);
    ctx.struct({ type: 'net', x: A.x, z: A.z, dir: p.dir, L: pick([20, 40, 60], p.size), h: 2.2 });
  },
  poles(ctx, p) {
    const n = pick([2, 4, 6], p.size);
    const color = sectionDifficulty(ctx.run.sections[p.si]);
    for (let i = 0; i < n; i++) {
      const w = p.at(5 + i * 10);
      ctx.struct({ type: 'pole', x: w.x, z: w.z, color });
    }
  },
  gate(ctx, p) {
    const C = p.at(10);
    ctx.struct({ type: 'gate', x: C.x, z: C.z, dir: p.dir, gw: pick([5, 7, 9], p.size) });
  },
  cannon(ctx, p) {
    const C = p.at(10);
    // aim across towards the middle of the piste and a little down the hill
    const side = p.off > 0 ? -1 : p.off < 0 ? 1 : ctx.rand() < 0.5 ? -1 : 1;
    const ax = p.dir[1] * side + p.dir[0] * 0.5;
    const az = -p.dir[0] * side + p.dir[1] * 0.5;
    const l = Math.hypot(ax, az);
    ctx.struct({ type: 'cannon', x: C.x, z: C.z, size: p.size, aim: [ax / l, az / l] });
  },
};

/**
 * Build every element of the run onto the generated mountain: shape the snow first (all
 * of it), then put trees, rocks and structures on the finished surface.
 * Returns { props, structs, clear } where `clear` lists the boxes the forest keeps out of.
 */
export function buildElements(hf, surf, run, geo) {
  const props = [];
  const structs = [];
  const clear = [];
  const ctx = {
    hf,
    surf,
    run,
    geo,
    rand: rng(1),
    groom(k) {
      surf.g[k] = 255;
      surf.ice[k] = 0;
    },
    powder(k) {
      surf.g[k] = 0;
    },
    keepClear(A, dir, a0, a1, hw) {
      clear.push({ x: A.x, z: A.z, dx: dir[0], dz: dir[1], a0, a1, hw, zMin: A.z + Math.min(a0, a1) - hw, zMax: A.z + Math.max(a0, a1) + hw });
    },
    prop(k, x, z, s) {
      if (!hf.inside(x, z) || Math.abs(x) > hf.halfX - 4) return;
      props.push({ k, u: z - hf.startZ, x, s, r: ctx.rand() * 6.283 });
    },
    struct(o) {
      structs.push(o);
    },
  };
  const list = [];
  run.sections.forEach((s, si) => {
    const rows = sectionRows(s);
    for (const c of s.cells) {
      if (c.r >= rows || !ELEMENTS[c.k]) continue;
      list.push(placement(hf, geo, geo.starts, si, c));
    }
  });
  for (const p of list) {
    ctx.rand = rng(hashStr(`${run.sections[p.si].id}:${p.r}:${p.c}:${p.kind}`));
    TERRAIN[p.kind]?.(ctx, p);
  }
  for (const p of list) {
    ctx.rand = rng(hashStr(`${run.sections[p.si].id}:${p.r}:${p.c}:${p.kind}:place`));
    PLACE[p.kind]?.(ctx, p);
  }
  // number the slalom gates down the run (alternating red / blue)
  structs
    .filter((s) => s.type === 'gate')
    .sort((a, b) => a.z - b.z)
    .forEach((g, i) => (g.order = i));
  return { props, structs, clear };
}

export function insideClear(clear, x, z) {
  for (const c of clear) {
    if (z < c.zMin || z > c.zMax) continue;
    const rx = x - c.x;
    const rz = z - c.z;
    const along = rx * c.dx + rz * c.dz;
    if (along < c.a0 || along > c.a1) continue;
    const across = rx * c.dz - rz * c.dx;
    if (across >= -c.hw && across <= c.hw) return true;
  }
  return false;
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

function hash2(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
