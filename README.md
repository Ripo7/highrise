# Highrise

Shape a wild mountain on its hexagon tiles, start anywhere, ride it, build some more, ride on. A browser 3D game where making the mountain is the gameplay.

This is **Phase 0**: a grey-box prototype to prove the core loop is fun before any art investment.

**Shape → ride → pause → build → ride on → repeat.**

## Play

**Shape** a wild mountain, **ride** it from wherever you like, and score on **style**. No pistes: the whole mountain is yours, terrain and nature.

### A wild mountain

Every mountain is generated (a seed): a summit shoulder at the top, steeper pitches and rolls on the way down, spurs and gullies running down the fall line, a couple of wide bowls, knolls, bands of rock across the slope on the steeper ones, and a run-out at the bottom. Forest grows below the treeline in woods with clearings, thicker on the spurs than in the gullies (avalanche paths stay open), never on the rock; boulders sit on the steep bits and below the cliffs.

Pick how steep (**Gentle** about 15°, **Medium** 22°, **Steep** 29°) and how big (**Small** 600 × 700 m, **Medium** 720 m × 1.1 km, **Large** 840 m × 1.6 km). The chooser shows the mountain from above; **Another one** rolls a new one with the same settings. **New mountain** (`N`, ••• menu) brings the chooser back.

### Start anywhere, pause, ride on

1. **Start** (`G`): tap or drag on the snow to put the start gate anywhere. It faces down the fall line, and the trees around it make room.
2. **Ride** (`Space`): the skier sets off from the gate. The run ends at the bottom of the mountain (a finish line runs right across it), or when he stops or wipes out for good.
3. **Build** (`Esc`, `B` or `Tab` while riding) **pauses the run**: the skier waits where he is, marked by a ring, and the camera looks down on him and the snow ahead. Build anything, anywhere (right in front of him if you like).
4. **Ride on** (`Space`) carries on with the same run, from the same place, at the same speed, on the snow as it is now. **From the start** (`Shift`+`Space`, or `R` while riding) begins a new run at the gate.

### Shaping the snow

The mountain is covered in **hexagon tiles** (about 10 m across, in rows across the slope; the grid shows on the snow while you paint). **Terrain** and **Nature** pieces are painted onto them with a brush of 1, 7 or 19 tiles (`[` `]`): the tile under your finger, with its six neighbours, or two rings round it.

| Piece | What it does |
| --- | --- |
| Bump / Hollow | Raises or digs the snow. Side by side they make a ridge, a hill, a bowl or a gully; bigger areas grow higher or deeper in the middle. |
| Flat | The slope eases off: a shelf, with a lip at its lower edge to pop off. |
| Wall | A steeper pitch, easing back below. |
| Rocks | A band of rock across the slope: a cliff face to drop, a run-out below. |
| Forest / Clearing | Plants trees (they join the woods around) or opens up the natural forest. |
| Powder | Deep untouched snow. |

**Everything merges.** Pieces don't stamp a shape per tile: all the tiles of one kind make one mask, blurred into a smooth field that shapes the snow, so neighbours are one shape with no seam, step or edge (no hexagon corners either), and a bump beside a hollow rolls into it. A tile holds one shape, one cover and powder or not (three layers), so trees can grow on a bump. **Erase** (`X`) clears tiles.

### Snow

- **Packed snow** everywhere by default: firm and quick, the edges bite.
- **Powder** where you paint it: slower (the skis plough), they sink, turns are softer and skid more, landings are more forgiving and the spray turns into clouds.
- **Bare rock** on cliffs, rock bands and any face too steep to hold snow (about 45°) rides like hard snow.
- **Ski tracks stay in the snow** run after run: two thin grooves when you carve, a trench in powder, a wide smear where you skid. They start right at the skis. **Fresh snow** (••• menu) covers them. They're saved in the browser.

### The camera (drone view)

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Orbit | Right-drag, or pick Look (`V`) and left-drag | Pick Look, then one finger |
| Pan / zoom | Middle-drag / scroll | Two fingers / pinch |
| Reset the view | `R` | ••• menu |
| Relief view | `T` | Relief button |

### Riding

| Action | Keyboard | Touch |
| --- | --- | --- |
| Carve (a little), skid (all the way) | `←` `→` or `A` `D` | Left thumb: slide left/right |
| Hockey stop (fast), snowplough (slow) | `↓` / `S` | Left thumb: drag down |
| Tuck (slow: push with the poles) | `↑` / `W` | Left thumb: drag up |
| Spin / flip in the air | `←` `→` / `↑` front flip, `↓` backflip | Left thumb in the air |
| Crouch, then jump | Hold `Space`, release | Hold Jump, release |
| Absorb a big landing | Hold `Space` before touchdown | Hold Jump before touchdown |
| From the start / camera / pause and build | `R` / `C` / `Esc` | Buttons top left |
| Sound | `M` | ••• menu |

**How the skis feel.** The skier is a point mass with real numbers: air drag for a skier standing (CdA ≈ 0.55 m²) or tucked (≈ 0.23 m²), snow friction that grows with the load in a turn, and skis that grip up to about 2.3 g on packed snow. A light touch on the stick **carves**: the skis bend into an arc and hold it, with almost no slip and no speed lost (about 7 m radius at 30 km/h, 20 m at 55, 60 m at 110, tighter is not possible at speed). All the way over, the tails break loose and the skis **skid**: a sharper turn that scrubs speed. Pull back and they swing across into a **hockey stop** (50 → 0 km/h in about 2.5 s on a medium slope); slow, it's a snowplough. Hands off, the skis follow where you're going and drift towards the fall line. The skier **leans into the turn** by the actual forces (up to 62°), angulating at the hips. Top speeds: about 85 / 130 km/h (standing / tucked) on a gentle mountain, 105 / 160 on a medium one, 120 / 185 on a steep one.

Hold to load a jump (the ring fills) and release at a lip (a bump's crest, the edge of a flat, a cliff) to fly higher. Land with the skis straight and upright: clean landings score full points, sketchy ones half and cost speed, and only a really bad one is a wipeout (you lose the combo, tumble, get up and carry on). Let go of the stick in the air and the skier straightens up and finishes a nearly-complete flip by himself. Hitting the edge of the mountain just bumps you back.

**Speed bonus:** above 100 km/h a speed streak builds (40 points a second at 100 km/h, +3 per extra km/h: about 170/s at 145 km/h). It's banked once you've been back under 100 for 0.8 s, or at the finish, and lost on a wipeout. Tricks landed within 2.6 s of each other chain into a combo (×1.5, ×2, … up to ×5). A see-through ghost replays your best run.

Your mountain (its seed), pieces, start gate, best score, ghost and ski tracks autosave in the browser. Saves with pistes keep their mountain, and their pieces move from the old squares onto the hexagons (the pistes are dropped). Saves from before wild mountains are kept aside, untouched, and you start on a new mountain.

## How the mountain is built

- `src/core/wild.js` generates the mountain from its seed as pure functions of position (height, rock bands, forest density), so it can be sampled at full resolution for the game or coarsely for the chooser's preview (`src/mountainPreview.js`). Its heights, rock and natural forest are computed once and kept as the base.
- `src/core/hex.js` is the grid: pointy-top hexagons in rows across the slope (odd rows shifted half a tile), which tile a point is in, a tile's centre and corners, brushes (1, 7, 19 tiles) and lines of tiles (a fast drag leaves no gaps).
- `src/core/terrain.js` holds the pieces and their fields: per kind, the painted tiles become a mask and three box blurs make it a near-gaussian field; bumps and hollows add a tight and a wide field (so big areas dome); flats, walls and rock bands change the slope along the fall line, column by column, then ease back to the mountain below.
- `src/core/world.js` puts it together on every edit: base, pieces, then the snow (packed / powder / rock in `src/core/surface.js`) and the trees and boulders, kept off the rock and clear of the start gate. A rebuild takes about 20 ms, so the snow follows a paint stroke or a dragged gate live.
- The hexagon grid, the painted tiles, the brush preview, the start ring and the finish line are drawn by the terrain shader (`src/render/terrainMesh.js`); `src/buildBar.js` is the bar at the bottom.

## Trees and rocks

They're obstacles: brushing one is a bump that costs a little speed, hitting one head-on (over ~40 km/h straight into it) is a wipeout. Rocks can be jumped. They're drawn as instanced meshes, so thousands cost a few draw calls.

## What's in the prototype

- **Heightfield terrain**: as big as the mountain (1.5 m cells, 1.8 m on the large one), kept under about 430,000 vertices for phones.
- **Skier physics** (`src/core/skier.js`): a point mass with gravity, load-dependent snow friction and air drag; carving limited by ski grip and the shortest arc a ski can bend, skidding, hockey stops, snowplough and poling. Legs soak up small rolls; it leaves the ground when the slope falls away faster than gravity can follow, so bumps, lips and cliffs create real jumps. Landings are judged by impact speed into the slope: soft, rough (speed loss) or crash.
- **Tricks and style**: crouch-and-pop jumps with a short grace window after the lip, spins and front/back flips in the air, landings judged on impact, ski angle and balance, named tricks ("Switch Double Backflip 540"), combos, a results card and a ghost of your best run (`src/core/score.js`, tested).
- **Ride mode**: the camera drops low behind the life-size skier (chase cam, which ducks under the trees rather than through them, or helmet cam) and you carve, skid, stop and tuck. Speed shows: the lens widens, the camera rumbles, snow sprays off the ski tails (more the harder you skid, bursts on landing) and the screen edges streak. Land with the skis sideways and you crash.
- **Run outcomes**: finish (the bottom of the mountain), stopped (not enough slope), too slow. A run can be paused to build and picked up again.
- **Relief view** (Relief button or `T`): colours every point by how far it sits above or below its surroundings (a ~50 m blur) — crests warm orange, hollows cool blue — with low two-sun shading and 2 m / 10 m contours, so bumps, hollows and cliffs read at any distance.
- **Feedback**: live trail, the previous run as a dashed blue ghost line, topographic contours (2 m / 10 m), run stats and personal best.
- **Diorama look**: the mountain is a block with stratified sides on a base slab.

## Exit test for Phase 0

Hand it to a few people. Do they say "one more tweak" and keep going? If not, fix the feel before moving to Phase 1.

## Develop

```bash
npm install
npm run dev      # local dev server
npm test         # physics, scoring, mountains, the hexagon grid and pieces (Node, no browser needed)
npm run build    # production build into dist/
npm run smoke    # browser smoke test on the build: pick a mountain, move the start, paint bumps, undo, ride, pause and build, ride on, start again (needs Chromium: npx playwright install chromium)
```

Add `?debug` to the URL for a frame-cost readout (fps, worst frame, draw calls, triangles). CI (`.github/workflows/ci.yml`) runs the tests, the build and the smoke test on every pull request.

The physics runs in fixed 1/240 s steps whatever the screen's refresh rate, so a run (and the ghost of your best one) plays out identically at 60 Hz and 165 Hz.

Stack: [Vite](https://vite.dev) + [Three.js](https://threejs.org). The simulation core in `src/core/` has no Three.js dependency, so it runs in tests and can later move to a worker.

```
src/
  core/        heightfield, wild mountains, hexagon grid, terrain pieces, skier physics, scoring (pure JS)
  render/      terrain mesh + shader, trees and rocks, start gate, skier, spray, ski tracks
  buildBar.js  the build bar
  ui.js        overlay controls
  main.js      scene, input, game loop
tests/         node:test suites
```

## Deploy

Vercel detects Vite automatically: import the repo, keep the defaults (build `npm run build`, output `dist`), deploy.
