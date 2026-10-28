// The tiles you've changed, and the actions that change them. You select hexagon tiles
// (see hex.js), then act on the selection; every action is stored on the tiles, and the
// snow is rebuilt from the bare slope and the tiles every time (terrain.js), so actions
// mix, undo and save cleanly.
//
// A tile record (only changed tiles are kept):
//   { i, j,            hexagon column and row (see hex.js)
//     lift,            metres raised (+) or lowered (-)                        Raise / Lower
//     pitch,           -3..3: the slope eased (-) or steepened (+)              Ease / Steepen
//     flat,            0, or a group id: the group is levelled to one height    Flatten
//     smooth,          0..3: rolls and lumps smoothed away                      Smooth
//     feat,            '' | 'jump' | 'drop' | 'rocks'                           Jump / Drop / Rocks
//     dir, g,          a jump or drop: the way it faces (degrees, 0 = down the map, 90 = +x)
//                      and its group (the tiles of one jump make one kicker)
//     trees,           0..3: planted trees, sparse to dense                     Trees
//     clear,           true: no trees here, not even the natural forest          Clear
//     snow,            '' | 'powder' | 'ice'                                    Powder / Ice
//     gate }           0, or a group id: the tiles of one tap make one gate       Gate
//                      to ski through (course.js), on top of anything else

import { toAxial, fromAxial } from './hex.js';

export const LIFT_STEP = 1.5; // metres per Raise / Lower
export const LIFT_MAX = 15;

const BLANK = { lift: 0, pitch: 0, flat: 0, smooth: 0, feat: '', dir: 0, g: 0, trees: 0, clear: false, snow: '', gate: 0 };
export const blankTile = (i, j) => ({ i, j, ...BLANK });

export const tileKey = (i, j) => `${i},${j}`;

// nothing changed on this tile any more: drop it
export const isBlank = (t) => !t.lift && !t.pitch && !t.flat && !t.smooth && !t.feat && !t.trees && !t.clear && !t.snow && !t.gate;

// What each action does, for the build bar (group, label, hint)
export const ACTIONS = {
  raise: { tab: 'shape', label: 'Raise', hint: 'Lifts the snow a little more each tap.' },
  lower: { tab: 'shape', label: 'Lower', hint: 'Digs the snow a little more each tap.' },
  flatten: { tab: 'shape', label: 'Flatten', hint: 'Levels the tiles to one height: a shelf or a terrace.' },
  smooth: { tab: 'shape', label: 'Smooth', hint: 'Smooths away rolls and lumps (tap again for more).' },
  steepen: { tab: 'shape', label: 'Steepen', hint: 'A steeper pitch (tap again for more).' },
  ease: { tab: 'shape', label: 'Ease', hint: 'A gentler pitch (tap again for more).' },
  jump: { tab: 'features', label: 'Jump', hint: 'A kicker facing down the slope. More tiles, bigger jump.' },
  drop: { tab: 'features', label: 'Drop', hint: 'A sharp step to drop off, with a landing below.' },
  rocks: { tab: 'features', label: 'Rocks', hint: 'A band of bare rock: a cliff across the slope.' },
  gate: { tab: 'features', label: 'Gate', hint: 'A gate to ski through, as wide as the tiles: a run counts only through every gate.' },
  trees: { tab: 'nature', label: 'Trees', hint: 'Plants pines, denser each tap.' },
  clear: { tab: 'nature', label: 'Clear', hint: 'No trees on these tiles.' },
  powder: { tab: 'nature', label: 'Powder', hint: 'Deep untouched snow: slow and soft.' },
  ice: { tab: 'nature', label: 'Ice', hint: 'Hard, fast and slippery: the edges barely hold.' },
  copy: { tab: 'tools', label: 'Copy', hint: 'Copies the selected tiles and what is on them.' },
  paste: { tab: 'tools', label: 'Paste', hint: 'Puts the copied tiles down where you tap.' },
  rotate: { tab: 'tools', label: 'Rotate', hint: 'Turns jumps and drops (and what you paste).' },
  erase: { tab: 'tools', label: 'Erase', hint: 'Back to the bare slope on these tiles.' },
};
export const TABS = [
  { id: 'shape', label: 'Shape' },
  { id: 'features', label: 'Features' },
  { id: 'nature', label: 'Nature' },
  { id: 'tools', label: 'Tools' },
];

const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// a fresh group id (for Flatten, Jump, Drop, Gate): one more than any in use
export function newGroup(tiles) {
  let m = 0;
  for (const t of tiles) m = Math.max(m, t.g, t.flat, t.gate || 0);
  return m + 1;
}

/**
 * Apply an action to the selected tiles. sel: [[i, j], ...] (inside the grid), opts:
 * { dir } the facing for a new jump or drop (degrees). Returns a new list, or the same one
 * when nothing changed.
 */
export function applyAction(tiles, sel, action, opts = {}) {
  if (!sel.length) return tiles;
  const by = new Map(tiles.map((t) => [tileKey(t.i, t.j), t]));
  const picked = sel.map(([i, j]) => by.get(tileKey(i, j)) || blankTile(i, j));
  const all = (f) => picked.every(f);
  let edit; // tile => changed copy
  switch (action) {
    case 'raise':
    case 'lower': {
      const d = action === 'raise' ? LIFT_STEP : -LIFT_STEP;
      edit = (t) => ({ ...t, lift: r1(clamp(t.lift + d, -LIFT_MAX, LIFT_MAX)) });
      break;
    }
    case 'flatten': {
      // one level for all of them; keep the selection as high as it was on average
      const g = newGroup(tiles);
      const lift = r1(picked.reduce((s, t) => s + t.lift, 0) / picked.length);
      edit = (t) => ({ ...t, flat: g, lift, pitch: 0 });
      break;
    }
    case 'smooth':
      edit = (t) => ({ ...t, smooth: Math.min(3, t.smooth + 1) });
      break;
    case 'steepen':
    case 'ease': {
      const d = action === 'steepen' ? 1 : -1;
      edit = (t) => ({ ...t, pitch: clamp(t.pitch + d, -3, 3) });
      break;
    }
    case 'jump':
    case 'drop': {
      // tapping it again on the same feature takes it away
      if (all((t) => t.feat === action)) edit = (t) => ({ ...t, feat: '', g: 0, dir: 0 });
      else {
        const g = newGroup(tiles);
        const dir = Math.round(((opts.dir ?? 0) % 360) + 360) % 360;
        edit = (t) => ({ ...t, feat: action, g, dir });
      }
      break;
    }
    case 'rocks':
      edit = all((t) => t.feat === 'rocks') ? (t) => ({ ...t, feat: '' }) : (t) => ({ ...t, feat: 'rocks', g: 0, dir: 0 });
      break;
    case 'gate': {
      // one gate for the whole selection; tapped again on a gate, it goes
      if (all((t) => t.gate > 0)) edit = (t) => ({ ...t, gate: 0 });
      else {
        const g = newGroup(tiles);
        edit = (t) => ({ ...t, gate: g });
      }
      break;
    }
    case 'trees':
      edit = (t) => ({ ...t, trees: Math.min(3, t.trees + 1), clear: false });
      break;
    case 'clear':
      edit = all((t) => t.clear) ? (t) => ({ ...t, clear: false }) : (t) => ({ ...t, clear: true, trees: 0 });
      break;
    case 'powder':
    case 'ice':
      edit = all((t) => t.snow === action) ? (t) => ({ ...t, snow: '' }) : (t) => ({ ...t, snow: action });
      break;
    case 'erase':
      edit = () => null;
      break;
    case 'rotate': {
      // turn every jump and drop the selection touches, all of its tiles
      const groups = new Set(picked.filter((t) => t.g && (t.feat === 'jump' || t.feat === 'drop')).map((t) => t.g));
      if (!groups.size) return tiles;
      // a twelfth of a turn clockwise (seen from above, downhill at the bottom), like a copy
      return tiles.map((t) => (groups.has(t.g) && t.feat ? { ...t, dir: (t.dir + 330) % 360 } : t));
    }
    default:
      return tiles;
  }
  const out = new Map(by);
  let changed = false;
  for (const t of picked) {
    const k = tileKey(t.i, t.j);
    const n = edit(t);
    if (!n || isBlank(n)) {
      if (out.delete(k)) changed = true;
    } else if (!same(n, by.get(k))) {
      out.set(k, n);
      changed = true;
    }
  }
  return changed ? [...out.values()] : tiles;
}

const same = (a, b) => !!b && Object.keys(BLANK).every((k) => a[k] === b[k]);

// ---------- what the selection holds (for the build bar) ----------

// averages and flags over the selected tiles: { lift, pitch, smooth, trees, feat, snow, clear }
export function describe(tiles, sel) {
  const by = new Map(tiles.map((t) => [tileKey(t.i, t.j), t]));
  const picked = sel.map(([i, j]) => by.get(tileKey(i, j)) || blankTile(i, j));
  const n = Math.max(1, picked.length);
  const avg = (f) => picked.reduce((s, t) => s + f(t), 0) / n;
  const every = (f) => picked.length > 0 && picked.every(f);
  return {
    n: picked.length,
    lift: r1(avg((t) => t.lift)),
    pitch: Math.round(avg((t) => t.pitch)),
    smooth: Math.round(avg((t) => t.smooth)),
    trees: Math.round(avg((t) => t.trees)),
    flat: every((t) => t.flat > 0),
    jump: every((t) => t.feat === 'jump'),
    drop: every((t) => t.feat === 'drop'),
    rocks: every((t) => t.feat === 'rocks'),
    clear: every((t) => t.clear),
    powder: every((t) => t.snow === 'powder'),
    ice: every((t) => t.snow === 'ice'),
    gate: every((t) => t.gate > 0),
    turnable: picked.some((t) => t.feat === 'jump' || t.feat === 'drop'),
  };
}

// ---------- copy and paste ----------

/**
 * Copy the selection: each tile as an axial step from the anchor (the first selected tile),
 * so the shape survives being put down on any row. Blank tiles are copied too (pasting
 * them clears what's there, so a copy is exactly what you saw).
 */
export function copyTiles(tiles, sel) {
  if (!sel.length) return null;
  const by = new Map(tiles.map((t) => [tileKey(t.i, t.j), t]));
  const [aq, ar] = toAxial(sel[0][0], sel[0][1]);
  return {
    cells: sel.map(([i, j]) => {
      const [q, r] = toAxial(i, j);
      const rec = { ...(by.get(tileKey(i, j)) || blankTile(i, j)) };
      delete rec.i;
      delete rec.j;
      return { dq: q - aq, dr: r - ar, rec };
    }),
  };
}

// turn a copy a sixth of a turn clockwise (seen from above, downhill at the bottom) about
// its anchor, jumps and drops with it
export function rotateCopy(clip) {
  return {
    cells: clip.cells.map(({ dq, dr, rec }) => ({
      dq: -dr,
      dr: dq + dr,
      rec: rec.feat === 'jump' || rec.feat === 'drop' ? { ...rec, dir: (rec.dir + 300) % 360 } : rec,
    })),
  };
}

// where the copy lands with its anchor on tile (i, j): [[i, j], ...] (some may be off the grid)
export function pasteCells(clip, i, j) {
  const [aq, ar] = toAxial(i, j);
  return clip.cells.map(({ dq, dr }) => fromAxial(aq + dq, ar + dr));
}

// Put the copy down with its anchor on (i, j). Groups get fresh ids, so a pasted jump is a
// jump of its own. Returns { tiles, placed: [[i, j], ...] }.
export function pasteTiles(tiles, clip, i, j, cols, rows) {
  const cells = pasteCells(clip, i, j);
  const out = new Map(tiles.map((t) => [tileKey(t.i, t.j), t]));
  let next = newGroup(tiles);
  const remap = new Map();
  const fresh = (id) => {
    if (!id) return 0;
    if (!remap.has(id)) remap.set(id, next++);
    return remap.get(id);
  };
  const placed = [];
  clip.cells.forEach(({ rec }, k) => {
    const [ci, cj] = cells[k];
    if (ci < 0 || cj < 0 || ci >= cols || cj >= rows) return;
    placed.push([ci, cj]);
    const t = { ...rec, i: ci, j: cj, g: fresh(rec.g), flat: fresh(rec.flat), gate: fresh(rec.gate) };
    if (isBlank(t)) out.delete(tileKey(ci, cj));
    else out.set(tileKey(ci, cj), t);
  });
  return { tiles: [...out.values()], placed };
}

// ---------- the grid ----------

export function trimTiles(tiles, cols, rows) {
  return tiles.filter((t) => t.i >= 0 && t.j >= 0 && t.i < cols && t.j < rows);
}

// ---------- saving ----------

const FEATS = ['', 'jump', 'drop', 'rocks'];
const SNOWS = ['', 'powder', 'ice'];
// numbers per tile: 13 since gates (save v11), 12 before
export const PACKED = 13;

export function packTiles(tiles) {
  const out = [];
  for (const t of tiles) {
    out.push(t.i, t.j, Math.round(t.lift * 10), t.pitch, t.flat, t.smooth, FEATS.indexOf(t.feat), t.dir, t.g, t.trees, t.clear ? 1 : 0, SNOWS.indexOf(t.snow), t.gate || 0);
  }
  return out;
}

// n: numbers per tile (12 for saves from before gates)
export function unpackTiles(a, n = PACKED) {
  const out = [];
  if (!Array.isArray(a)) return out;
  const N = n === 12 ? 12 : PACKED;
  const int = (v, lo, hi) => (Number.isInteger(v) ? clamp(v, lo, hi) : 0);
  for (let q = 0; q + N - 1 < a.length; q += N) {
    if (!Number.isInteger(a[q]) || !Number.isInteger(a[q + 1])) continue;
    const t = {
      i: a[q],
      j: a[q + 1],
      lift: r1(int(a[q + 2], -LIFT_MAX * 10, LIFT_MAX * 10) / 10),
      pitch: int(a[q + 3], -3, 3),
      flat: int(a[q + 4], 0, 1e6),
      smooth: int(a[q + 5], 0, 3),
      feat: FEATS[int(a[q + 6], 0, 3)],
      dir: int(a[q + 7], 0, 359),
      g: int(a[q + 8], 0, 1e6),
      trees: int(a[q + 9], 0, 3),
      clear: a[q + 10] === 1,
      snow: SNOWS[int(a[q + 11], 0, 2)],
      gate: N > 12 ? int(a[q + 12], 0, 1e6) : 0,
    };
    if (!isBlank(t)) out.push(t);
  }
  return out;
}

// ---------- older saves ----------

// Before tiles had actions you painted pieces: { k, i, j }, one shape, one cover and powder
// per tile. Each becomes the actions that make about the same snow.
const PIECE_ORDER = ['bump', 'hollow', 'flat', 'wall', 'rocks', 'forest', 'clearing', 'powder'];

export function unpackPieces(a) {
  const out = [];
  if (!Array.isArray(a)) return out;
  for (let q = 0; q + 2 < a.length; q += 3) {
    const k = PIECE_ORDER[a[q]];
    if (k && Number.isInteger(a[q + 1]) && Number.isInteger(a[q + 2])) out.push({ k, i: a[q + 1], j: a[q + 2] });
  }
  return out;
}

export function fromPieces(pieces) {
  const by = new Map();
  for (const p of pieces) {
    const k = tileKey(p.i, p.j);
    const t = by.get(k) || blankTile(p.i, p.j);
    if (p.k === 'bump') t.lift = 3;
    else if (p.k === 'hollow') t.lift = -3;
    else if (p.k === 'flat') t.pitch = -3;
    else if (p.k === 'wall') t.pitch = 3;
    else if (p.k === 'rocks') t.feat = 'rocks';
    else if (p.k === 'forest') t.trees = 2;
    else if (p.k === 'clearing') t.clear = true;
    else if (p.k === 'powder') t.snow = 'powder';
    by.set(k, t);
  }
  return [...by.values()].filter((t) => !isBlank(t));
}
