// The tutorial: thirteen short levels, one action (or two) at a time. Each level is a small
// slope of its own, maybe with tiles already on it, and a few steps to do in order. A step
// marks its goal tiles in gold on the snow and is done when its check passes.
//
//   level: { id, design, start: { x, u } | null, tiles(hf) => [...], steps: [step] }
//   step:  { id, goal: spec | null, tab, hint: action or tool to point at, ride: bool,
//            done(c) => bool }
//   spec:  { x, u, size }               the brush's tiles around (x, u)
//          { line: [[x, u], [x, u]], size }   the brush along a line
//
// x is metres across the slope (0 in the middle; looking down the slope, as the camera does,
// +x is on the left), u metres down from the start line. Texts
// are in tutorialText.js, keyed tut.<level>.<step>. Plain data and pure functions: no DOM,
// no Three.js, so the checks run in tests.

import { tileOf, brushTiles, lineTiles, gridCols, gridRows } from './terrain.js';
import { applyAction, blankTile, tileKey } from './tiles.js';

const S = (slope, length) => ({ slope, length });

// the tiles a spec covers, inside the grid, each once
export function resolveGoal(hf, spec) {
  if (!spec) return [];
  const at = (x, u) => tileOf(hf, x, hf.startZ + u);
  const centres = spec.line ? lineTiles(at(...spec.line[0]), at(...spec.line[1])).map(([i, j]) => ({ i, j })) : [at(spec.x, spec.u)];
  const cols = gridCols(hf);
  const rows = gridRows(hf);
  const seen = new Set();
  const out = [];
  for (const c of centres) {
    for (const [i, j] of brushTiles(c.i, c.j, spec.size || 1)) {
      const k = tileKey(i, j);
      if (seen.has(k) || i < 0 || j < 0 || i >= cols || j >= rows) continue;
      seen.add(k);
      out.push([i, j]);
    }
  }
  return out;
}

// how far a facing is from straight down the map, either way round (degrees)
const turned = (dir) => Math.min(dir % 360, 360 - (dir % 360));

const act = (hf, tiles, spec, ...names) => names.reduce((t, n) => applyAction(t, resolveGoal(hf, spec), n, { dir: 0 }), tiles);

// moguls: every other tile up, the rest down
function moguls(hf, spec) {
  let tiles = [];
  for (const [i, j] of resolveGoal(hf, spec)) {
    const up = (i + j) % 2 === 0;
    tiles = applyAction(tiles, [[i, j]], up ? 'raise' : 'lower');
    if (up) tiles = applyAction(tiles, [[i, j]], 'raise');
  }
  return tiles;
}

// the ride steps read the run (see followRun): { air (the longest flight, s), cleanLand
// (landed after 0.4 s or more in the air, still up a second later), finished, hits: wipeouts
// by reason ({ tree: 1 }), wipeouts, u (how far down it got), status }
export const LEVELS = [
  {
    id: 'select',
    design: { width: 'narrow', sections: [S(14, 260)] },
    start: { x: 0, u: 14 },
    steps: [
      { id: 'pick', goal: { x: 0, u: 70, size: 2 }, hint: 'select', done: (c) => c.goalSelected() },
      { id: 'clear', goal: null, hint: 'chip', done: (c) => c.selCount === 0 },
      { id: 'big', goal: { x: -30, u: 110, size: 3 }, hint: 'size', done: (c) => c.goalSelected() },
    ],
  },
  {
    id: 'raise',
    design: { width: 'narrow', sections: [S(14, 260)] },
    start: { x: 0, u: 14 },
    steps: [
      { id: 'up', goal: { x: 28, u: 80, size: 2 }, tab: 'shape', hint: 'raise', done: (c) => c.allGoal((t) => t.lift >= 3) },
      { id: 'down', goal: { x: -28, u: 80, size: 2 }, tab: 'shape', hint: 'lower', done: (c) => c.allGoal((t) => t.lift <= -3) },
    ],
  },
  {
    id: 'flatten',
    design: { width: 'narrow', sections: [S(22, 280)] },
    start: { x: 0, u: 14 },
    steps: [
      { id: 'terrace', goal: { x: 0, u: 90, size: 3 }, tab: 'shape', hint: 'flatten', done: (c) => c.allGoal((t) => t.flat > 0) },
      { id: 'lift', goal: { x: 0, u: 90, size: 3 }, tab: 'shape', hint: 'raise', done: (c) => c.allGoal((t) => t.flat > 0 && t.lift >= 1.5) },
    ],
  },
  {
    id: 'smooth',
    design: { width: 'narrow', sections: [S(16, 260)] },
    start: { x: 0, u: 14 },
    tiles: (hf) => moguls(hf, { x: 0, u: 90, size: 3 }),
    steps: [{ id: 'bumps', goal: { x: 0, u: 90, size: 3 }, tab: 'shape', hint: 'smooth', done: (c) => c.allGoal((t) => t.smooth >= 3) }],
  },
  {
    id: 'pitch',
    design: { width: 'narrow', sections: [S(16, 260)] },
    start: { x: 0, u: 14 },
    steps: [
      { id: 'steeper', goal: { x: 28, u: 85, size: 2 }, tab: 'shape', hint: 'steepen', done: (c) => c.allGoal((t) => t.pitch >= 2) },
      { id: 'gentler', goal: { x: -28, u: 85, size: 2 }, tab: 'shape', hint: 'ease', done: (c) => c.allGoal((t) => t.pitch <= -2) },
    ],
  },
  {
    id: 'jump',
    design: { width: 'narrow', sections: [S(16, 300)] },
    start: { x: 40, u: 14 },
    steps: [
      { id: 'build', goal: { x: 0, u: 110, size: 2 }, tab: 'features', hint: 'jump', done: (c) => c.allGoal((t) => t.feat === 'jump') },
      { id: 'start', goal: { x: 0, u: 40, size: 1 }, hint: 'start', done: (c) => c.startOnGoal() },
      { id: 'fly', goal: null, ride: true, hint: 'ride', done: (c) => c.run.air >= 1 },
    ],
  },
  {
    id: 'drop',
    design: { width: 'narrow', sections: [S(14, 300)] },
    start: { x: 0, u: 30 },
    steps: [
      { id: 'build', goal: { x: 0, u: 100, size: 2 }, tab: 'features', hint: 'drop', done: (c) => c.allGoal((t) => t.feat === 'drop') },
      { id: 'land', goal: null, ride: true, hint: 'ride', done: (c) => c.run.cleanLand },
    ],
  },
  {
    id: 'rocks',
    design: { width: 'narrow', sections: [S(14, 260)] },
    start: { x: 0, u: 14 },
    steps: [
      { id: 'band', goal: { line: [[-50, 110], [50, 110]], size: 1 }, tab: 'features', hint: 'rocks', done: (c) => c.allGoal((t) => t.feat === 'rocks') },
      { id: 'over', goal: null, ride: true, hint: 'ride', done: (c) => c.run.cleanLand },
    ],
  },
  {
    id: 'gates',
    design: { width: 'narrow', sections: [S(14, 260)] },
    start: { x: 0, u: 14 },
    steps: [
      { id: 'one', goal: { x: 0, u: 80, size: 1 }, tab: 'features', hint: 'gate', done: (c) => c.allGoal((t) => t.gate > 0) },
      { id: 'wide', goal: { line: [[-5, 170], [5, 170]], size: 1 }, tab: 'features', hint: 'gate', done: (c) => c.allGoal((t) => t.gate > 0) && c.groups('gate') === 1 },
      { id: 'race', goal: null, ride: true, hint: 'ride', done: (c) => c.run.finished && c.run.gatesTotal >= 2 && c.run.gatesCount === c.run.gatesTotal },
    ],
  },
  {
    id: 'trees',
    design: { width: 'narrow', sections: [S(14, 260)] },
    start: { x: 0, u: 14 },
    steps: [
      { id: 'wood', goal: { x: 0, u: 100, size: 3 }, tab: 'nature', hint: 'trees', done: (c) => c.allGoal((t) => t.trees >= 2) },
      { id: 'lane', goal: { line: [[0, 64], [0, 136]], size: 2 }, tab: 'nature', hint: 'clear', done: (c) => c.allGoal((t) => t.clear) },
      { id: 'through', goal: null, ride: true, hint: 'ride', done: (c) => c.run.finished && !c.run.hits.tree },
    ],
  },
  {
    id: 'snow',
    design: { width: 'narrow', sections: [S(16, 300)] },
    start: { x: 0, u: 14 },
    steps: [
      { id: 'powder', goal: { x: 0, u: 80, size: 3 }, tab: 'nature', hint: 'powder', done: (c) => c.allGoal((t) => t.snow === 'powder') },
      { id: 'ice', goal: { x: 0, u: 170, size: 3 }, tab: 'nature', hint: 'ice', done: (c) => c.allGoal((t) => t.snow === 'ice') },
      { id: 'feel', goal: null, ride: true, hint: 'ride', done: (c) => c.run.u >= 210 && c.run.status !== 'aborted' },
    ],
  },
  {
    id: 'copy',
    design: { width: 'narrow', sections: [S(16, 280)] },
    start: { x: 0, u: 14 },
    tiles: (hf) => act(hf, [], { x: -30, u: 90, size: 2 }, 'jump'),
    steps: [
      { id: 'copy', goal: { x: -30, u: 90, size: 2 }, tab: 'tools', hint: 'copy', done: (c) => !!c.clip && c.clip.cells.some((x) => x.rec.feat === 'jump') },
      { id: 'paste', goal: { x: 30, u: 90, size: 2 }, tab: 'tools', hint: 'paste', done: (c) => c.countGoal((t) => t.feat === 'jump') >= 4 },
      { id: 'turn', goal: { x: 30, u: 90, size: 2 }, tab: 'tools', hint: 'rotate', done: (c) => c.countGoal((t) => t.feat === 'jump' && turned(t.dir) >= 25) >= 1 },
    ],
  },
  {
    id: 'erase',
    design: { width: 'narrow', sections: [S(16, 260)] },
    start: { x: 0, u: 14 },
    tiles: (hf) => {
      let t = act(hf, [], { x: -12, u: 90, size: 2 }, 'trees', 'trees');
      t = act(hf, t, { x: 14, u: 84, size: 2 }, 'raise', 'raise');
      t = act(hf, t, { x: 4, u: 112, size: 1 }, 'rocks');
      return act(hf, t, { x: 0, u: 70, size: 1 }, 'ice');
    },
    steps: [{ id: 'wipe', goal: { x: 0, u: 90, size: 3 }, tab: 'tools', hint: 'erase', done: (c) => c.allGoal((t) => !t.lift && !t.feat && !t.trees && !t.snow) }],
  },
];

/**
 * What a check reads. game: { tiles, sel (Set of "i,j"), clip, start: { x, z } }, goal:
 * the step's tiles, run: what the ride did (see above).
 */
export function checkContext(hf, game, goal, run = emptyRun()) {
  const by = new Map(game.tiles.map((t) => [tileKey(t.i, t.j), t]));
  const rec = ([i, j]) => by.get(tileKey(i, j)) || blankTile(i, j);
  return {
    goal,
    selCount: game.sel.size,
    clip: game.clip,
    run,
    goalSelected: () => goal.length > 0 && goal.every(([i, j]) => game.sel.has(tileKey(i, j))),
    allGoal: (f) => goal.length > 0 && goal.every((g) => f(rec(g))),
    countGoal: (f) => goal.filter((g) => f(rec(g))).length,
    // how many groups (gates, jumps...) the goal's tiles make: field 'gate', 'g' or 'flat'
    groups: (field) => new Set(goal.map((g) => rec(g)[field]).filter(Boolean)).size,
    startOnGoal: () => {
      if (!game.start) return false;
      const t = tileOf(hf, game.start.x, game.start.z);
      return goal.some(([i, j]) => i === t.i && j === t.j);
    },
  };
}

export const emptyRun = () => ({ air: 0, cleanLand: false, landAt: -1, finished: false, hits: {}, wipeouts: 0, u: 0, status: 'idle', gatesCount: 0, gatesTotal: 0, seen: 0 });

// Follow a run for the ride steps: call with the skier after each frame (it reads the new
// events and the skier's state). startZ: the start line's z.
export function followRun(run, sk, startZ) {
  for (; run.seen < sk.events.length; run.seen++) {
    const ev = sk.events[run.seen];
    if (ev.type === 'land') {
      run.air = Math.max(run.air, ev.air);
      if (ev.air >= 0.4) run.landAt = ev.t;
    } else if (ev.type === 'wipeout') {
      run.hits[ev.reason] = (run.hits[ev.reason] || 0) + 1;
      run.landAt = -1;
    }
  }
  if (!sk.grounded) run.air = Math.max(run.air, sk.curAir);
  // landed, and still up a second later
  if (run.landAt >= 0 && sk.grounded && !(sk.wipeout > 0) && sk.time - run.landAt >= 1) run.cleanLand = true;
  run.wipeouts = sk.wipeouts;
  run.gatesCount = sk.course ? sk.course.count : 0;
  run.gatesTotal = sk.course ? sk.course.total : 0;
  run.u = Math.max(run.u, sk.pos[2] - startZ);
  run.status = sk.status;
  if (sk.status === 'finished') run.finished = true;
  return run;
}
