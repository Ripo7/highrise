import { makeValueNoise, smoothstep } from './heightfield.js';

// Trees and rocks on the piste. Each prop is stored in run coordinates so it stays put
// when the run is redrawn: u = metres down the run from the start line, x = metres across.
//   { k: TREE | ROCK, u, x, s (size), r (rotation) }
// They are obstacles: the skier collides with them (see Skier.collide).

export const TREE = 0;
export const ROCK = 1;

export const PROP_TOOLS = {
  tree: { label: 'Tree', hint: 'Tap the snow to plant a tree.' },
  rock: { label: 'Rock', hint: 'Tap the snow to drop a rock. Bigger Height, bigger rock.' },
  forest: { label: 'Forest', hint: 'Drag to paint trees. Width sets the brush.' },
  clear: { label: 'Clear', hint: 'Drag to remove trees and rocks. Width sets the brush.' },
};

// collision radius and height above the snow
export const propRadius = (p) => (p.k === TREE ? 0.9 * p.s : 1.6 * p.s);
export const propHeight = (p) => (p.k === TREE ? 10 * p.s : 1.0 * p.s);

const CELL = 16; // spatial index cell (m)

export class PropSet {
  constructor(hf) {
    this.hf = hf;
    this.list = [];
    this.grid = new Map();
    this.version = 0; // bumps on every change, for the renderer
  }

  worldZ(p) {
    return this.hf.startZ + p.u;
  }

  key(x, z) {
    return Math.floor((z + this.hf.halfZ) / CELL) * 64 + Math.floor((x + this.hf.halfX) / CELL);
  }

  reindex() {
    this.grid.clear();
    for (const p of this.list) this.insert(p);
    this.version++;
  }

  insert(p) {
    const k = this.key(p.x, this.worldZ(p));
    let cell = this.grid.get(k);
    if (!cell) this.grid.set(k, (cell = []));
    cell.push(p);
  }

  set(list) {
    this.list = list.map((p) => ({ ...p }));
    this.reindex();
  }

  clone() {
    return this.list.map((p) => ({ ...p }));
  }

  add(p) {
    this.list.push(p);
    this.insert(p);
    this.version++;
  }

  // props whose centre is within r of (x, z), world coordinates
  near(x, z, r) {
    const out = [];
    const { halfX, halfZ } = this.hf;
    const i0 = Math.floor((x - r + halfX) / CELL);
    const i1 = Math.floor((x + r + halfX) / CELL);
    const j0 = Math.floor((z - r + halfZ) / CELL);
    const j1 = Math.floor((z + r + halfZ) / CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = this.grid.get(j * 64 + i);
        if (!cell) continue;
        for (const p of cell) {
          if (Math.hypot(p.x - x, this.worldZ(p) - z) <= r) out.push(p);
        }
      }
    }
    return out;
  }

  removeWithin(x, z, r) {
    const gone = new Set(this.near(x, z, r));
    if (!gone.size) return 0;
    this.list = this.list.filter((p) => !gone.has(p));
    this.reindex();
    return gone.size;
  }

  // keep only props that still fit on the piste (after it is rebuilt shorter/narrower)
  trim(length) {
    const before = this.list.length;
    this.list = this.list.filter((p) => p.u > -15 && p.u < length + 10 && Math.abs(p.x) < this.hf.halfX - 4);
    this.reindex();
    return before - this.list.length;
  }
}

// Small deterministic RNG
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Natural scatter between u0 and u1 metres down the run, across the whole mountain: no
 * marked piste, no clear lane. Forest grows in patches with open glades between them
 * (large-scale noise), thickens towards the far edges, lone trees dot the open snow and
 * rocks sit on the steep bits. You pick your own line. The start and the finish arch are
 * kept clear so a run never begins or ends in a tree.
 */
export function scatterProps(hf, u0, u1, seed = 1) {
  const out = [];
  const rand = rng(seed * 7919 + Math.round(u0));
  const n1 = makeValueNoise(seed + 11);
  const n2 = makeValueNoise(seed + 23);
  const n3 = makeValueNoise(seed + 37);
  const step = 10;
  const half = hf.halfX - 6;
  const finishU = hf.finishZ - hf.startZ;
  for (let u = Math.max(0, u0); u < u1; u += step) {
    for (let x = -half; x < half; x += step) {
      const px = x + rand() * step;
      const pu = u + rand() * step;
      if (pu > finishU - 10) continue;
      const ax = Math.abs(px);
      if (pu < 60 && ax < 70) continue; // room around the start gate
      if (pu > finishU - 50 && ax < 40) continue; // and under the finish arch
      const z = hf.startZ + pu;
      // forest patches and glades: two octaves so the edges of the woods are ragged
      const patch = 0.7 * n1(px * 0.007, pu * 0.007) + 0.3 * n3(px * 0.03 + 9, pu * 0.03);
      const woods = smoothstep(0.5, 0.68, patch) * 0.78;
      const edge = smoothstep(170, 232, ax) * 0.45;
      const pTree = Math.min(0.85, woods + edge + 0.025);
      const nrm = hf.normalAt(px, z);
      const steep = smoothstep(0.3, 0.55, 1 - nrm[1]);
      const pRock = 0.025 + 0.22 * steep + 0.07 * Math.max(0, n2(px * 0.03, pu * 0.03) - 0.4);
      const roll = rand();
      if (roll < pTree) out.push({ k: TREE, u: pu, x: px, s: 0.75 + rand() * 0.7, r: rand() * 6.283 });
      else if (roll < pTree + pRock) out.push({ k: ROCK, u: pu, x: px, s: 0.7 + rand() * rand() * 2.2, r: rand() * 6.283 });
    }
  }
  return out;
}

// Save format: flat array of k, u, x, s, r
export function packProps(list) {
  const out = [];
  for (const p of list) {
    out.push(p.k, Math.round(p.u * 10) / 10, Math.round(p.x * 10) / 10, Math.round(p.s * 100) / 100, Math.round(p.r * 100) / 100);
  }
  return out;
}

export function unpackProps(a) {
  const out = [];
  if (!Array.isArray(a)) return out;
  for (let i = 0; i + 4 < a.length; i += 5) out.push({ k: a[i], u: a[i + 1], x: a[i + 2], s: a[i + 3], r: a[i + 4] });
  return out;
}
