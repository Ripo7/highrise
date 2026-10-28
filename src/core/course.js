// The course: gates to ski through, made with the Gate action on the tiles (tiles.js). The
// tiles of one tap make one gate: two poles across the fall line, as far apart as the tiles
// are wide, at the middle of the tiles. Gates are numbered down the mountain (by how far
// down they are), and the ones above the start gate don't count (you can't ride up to them).
//
// A run is valid when it went through every gate: between the poles, going down the way the
// gate faces (in the air over it counts too). Crossing a gate's line outside its poles is a
// miss (you can still come back to it, if you can climb). Plain data and pure functions.

import { fallLine } from './world.js';
import { tileCenter } from './terrain.js';
import { HEX_W } from './hex.js';
import { tileKey } from './tiles.js';

export const GATE_MARGIN = 0.5; // metres inside a tile's edge for the poles
const MISS_REACH = 60; // a crossing this far from a gate's middle, outside its poles: a miss

/**
 * The gates on the tiles: [{ n, key, x, z, dir: [dx, dz], across: [ax, az], half, behind }]
 * n: 1, 2, 3... down the mountain (0 for the ones above the start); half: from the middle to
 * a pole; key: which tiles make it (the same tiles, the same gate).
 */
export function buildGates(hf, tiles, start = null) {
  const groups = new Map();
  for (const t of tiles) {
    if (!t.gate) continue;
    if (!groups.has(t.gate)) groups.set(t.gate, []);
    groups.get(t.gate).push(t);
  }
  const gates = [];
  for (const list of groups.values()) {
    const cs = list.map((t) => tileCenter(hf, t.i, t.j));
    const cx = cs.reduce((s, c) => s + c.x, 0) / cs.length;
    const cz = cs.reduce((s, c) => s + c.z, 0) / cs.length;
    const dir = fallLine(hf, cx, cz, 10);
    const across = [dir[1], -dir[0]];
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of cs) {
      const a = (c.x - cx) * across[0] + (c.z - cz) * across[1];
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
    const mid = (lo + hi) / 2;
    gates.push({
      n: 0,
      key: list
        .map((t) => tileKey(t.i, t.j))
        .sort()
        .join(' '),
      x: cx + across[0] * mid,
      z: cz + across[1] * mid,
      dir,
      across,
      half: (hi - lo) / 2 + HEX_W / 2 - GATE_MARGIN,
      behind: !!start && cz < start.z - 1,
    });
  }
  gates.sort((a, b) => a.z - b.z || a.x - b.x);
  let n = 0;
  for (const g of gates) if (!g.behind) g.n = ++n;
  return gates;
}

// what makes the course: its gates (the tiles of each), the ones that count
export const courseKey = (gates) =>
  gates
    .filter((g) => !g.behind)
    .map((g) => g.key)
    .join('|');

/**
 * Follows one run through the gates. step() with the skier's last and new position (x, z)
 * returns what happened: { type: 'gate', n, count, total, t } through one, { type: 'miss',
 * n, t } past one. passed[k] / missed[k] per gate (in course order), splits: the time at
 * each gate passed.
 */
export class CourseRun {
  constructor(gates) {
    this.gates = gates.filter((g) => !g.behind);
    this.total = this.gates.length;
    this.passed = this.gates.map(() => false);
    this.missed = this.gates.map(() => false);
    this.splits = this.gates.map(() => null);
    this.count = 0;
  }

  get complete() {
    return this.count === this.total;
  }

  // the gates still to go through (their numbers)
  get missing() {
    return this.gates.filter((g, k) => !this.passed[k]).map((g) => g.n);
  }

  step(ox, oz, x, z, t, out = []) {
    for (let k = 0; k < this.total; k++) {
      if (this.passed[k]) continue;
      const g = this.gates[k];
      const s0 = (ox - g.x) * g.dir[0] + (oz - g.z) * g.dir[1];
      const s1 = (x - g.x) * g.dir[0] + (z - g.z) * g.dir[1];
      if (!(s0 < 0 && s1 >= 0)) continue;
      const f = -s0 / (s1 - s0);
      const qx = ox + (x - ox) * f;
      const qz = oz + (z - oz) * f;
      const a = Math.abs((qx - g.x) * g.across[0] + (qz - g.z) * g.across[1]);
      if (a <= g.half) {
        this.passed[k] = true;
        this.count++;
        this.splits[k] = t;
        out.push({ type: 'gate', n: g.n, count: this.count, total: this.total, t });
      } else if (a < g.half + MISS_REACH && !this.missed[k]) {
        this.missed[k] = true;
        out.push({ type: 'miss', n: g.n, t });
      }
    }
    return out;
  }

  // carry on a paused run on a course that may have changed meanwhile: the gates that are
  // still there keep what happened to them
  carryTo(gates) {
    const next = new CourseRun(gates);
    const was = new Map(this.gates.map((g, k) => [g.key, k]));
    next.gates.forEach((g, k) => {
      const o = was.get(g.key);
      if (o === undefined) return;
      next.passed[k] = this.passed[o];
      next.missed[k] = this.missed[o];
      next.splits[k] = this.splits[o];
    });
    next.count = next.passed.filter(Boolean).length;
    return next;
  }
}
