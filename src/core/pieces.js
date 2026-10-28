// What you built, piece by piece: for a tile, the pieces it's part of, so a double tap can
// select a whole one again (the jump, the gate, the terrace, the hill you raised, the
// wood...) and the next double tap the next one. A piece made in one tap (a gate, a jump,
// a drop, a terrace) is its group; the others are the connected tiles changed the same way
// (all raised, all in trees...). Last comes everything built that touches the tile.
// Pure functions on the tile records (tiles.js).

import { hexDisk } from './hex.js';
import { tileKey } from './tiles.js';

// in order: what you most likely mean first
const KINDS = [
  { kind: 'gate', has: (t) => t.gate > 0, group: (a, t) => t.gate === a.gate },
  { kind: 'jump', has: (t) => t.feat === 'jump', group: (a, t) => t.feat === 'jump' && t.g === a.g },
  { kind: 'drop', has: (t) => t.feat === 'drop', group: (a, t) => t.feat === 'drop' && t.g === a.g },
  { kind: 'rocks', has: (t) => t.feat === 'rocks', link: (t) => t.feat === 'rocks' },
  { kind: 'flatten', has: (t) => t.flat > 0, group: (a, t) => t.flat === a.flat },
  { kind: 'raise', has: (t) => t.lift > 0, link: (t) => t.lift > 0 },
  { kind: 'lower', has: (t) => t.lift < 0, link: (t) => t.lift < 0 },
  { kind: 'steepen', has: (t) => t.pitch > 0, link: (t) => t.pitch > 0 },
  { kind: 'ease', has: (t) => t.pitch < 0, link: (t) => t.pitch < 0 },
  { kind: 'smooth', has: (t) => t.smooth > 0, link: (t) => t.smooth > 0 },
  { kind: 'trees', has: (t) => t.trees > 0, link: (t) => t.trees > 0 },
  { kind: 'clear', has: (t) => t.clear, link: (t) => t.clear },
  { kind: 'powder', has: (t) => t.snow === 'powder', link: (t) => t.snow === 'powder' },
  { kind: 'ice', has: (t) => t.snow === 'ice', link: (t) => t.snow === 'ice' },
];

// the connected tiles from (i, j) that pass ok, as [[i, j], ...]
function flood(by, i, j, ok) {
  const seen = new Set([tileKey(i, j)]);
  const out = [];
  const todo = [[i, j]];
  while (todo.length) {
    const [a, b] = todo.pop();
    out.push([a, b]);
    for (const [c, d] of hexDisk(a, b, 1)) {
      const k = tileKey(c, d);
      if (seen.has(k)) continue;
      seen.add(k);
      const t = by.get(k);
      if (t && ok(t)) todo.push([c, d]);
    }
  }
  return out;
}

const sig = (list) =>
  list
    .map(([i, j]) => tileKey(i, j))
    .sort()
    .join(' ');

/**
 * The pieces tile (i, j) is part of: [{ kind, tiles: [[i, j], ...] }], most likely first,
 * each a different set of tiles. [] for a tile nothing was built on.
 */
export function pieceLayers(tiles, i, j) {
  const by = new Map(tiles.map((t) => [tileKey(t.i, t.j), t]));
  const t = by.get(tileKey(i, j));
  if (!t) return [];
  const out = [];
  const seen = new Set();
  const add = (kind, list) => {
    const s = sig(list);
    if (seen.has(s)) return;
    seen.add(s);
    out.push({ kind, tiles: list });
  };
  for (const k of KINDS) {
    if (!k.has(t)) continue;
    if (k.group) add(k.kind, tiles.filter((x) => k.group(t, x)).map((x) => [x.i, x.j]));
    else add(k.kind, flood(by, i, j, k.link));
  }
  add('built', flood(by, i, j, () => true));
  return out;
}

// every tile something was built on
export const allBuilt = (tiles) => tiles.map((t) => [t.i, t.j]);
