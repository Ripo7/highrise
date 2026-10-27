# Highrise

Trace your pistes through a wild mountain, shape the snow, send a skier, chase the perfect line. A browser 3D game where making the mountain is the gameplay.

This is **Phase 0**: a grey-box prototype to prove the core loop is fun before any art investment.

**Trace → shape → send → watch → tweak → repeat.**

## Play

**Trace** a piste through a wild mountain, **ride** it, and score on **style**.

### A wild mountain

Every mountain is generated (a seed): a summit shoulder at the top, steeper pitches and rolls on the way down, spurs and gullies running down the fall line, a couple of wide bowls, knolls, bands of rock across the slope on the steeper ones, and a run-out at the bottom. Forest grows below the treeline in woods with clearings, thicker on the spurs than in the gullies (avalanche paths stay open), never on the rock; boulders sit on the steep bits and below the cliffs.

Pick how steep (**Gentle** about 15°, **Medium** 22°, **Steep** 29°) and how big (**Small** 600 × 700 m, **Medium** 720 m × 1.1 km, **Large** 840 m × 1.6 km). The chooser shows the mountain from above; **Another one** rolls a new one with the same settings. **New mountain** (`N`, ••• menu) brings the chooser back.

### Tracing a piste

1. **Tap the snow near the top**: that's the start.
2. **Tap further down**, again and again: the piste follows your points as one smooth curve, carved into the mountain (levelled across, graded where the mountain is too steep, with soft snowy banks), groomed, and the trees on it cleared.
3. **Drag a point** to move it, **drag the piste** to put a new point in and bend it there. Tap a point to select it, then make the piste **Narrower** or **Wider** there (24, 36 or 52 m) or **Delete** the point (`Delete`).
4. **New piste** starts another one. Start it **on a piste** and it branches off there; end it **on a piste** and it joins it. Where pistes meet, their snow merges into one surface.

The run starts at the top of the first piste and ends at a finish line at the end of every piste that doesn't join another (or at the bottom of the mountain, if you go off into the powder). **Trace a piste for me** (••• menu, or ticked in the chooser) puts down a natural line from the top to the bottom to start from.

### Shaping the snow

**Terrain** and **Nature** pieces are painted on a 10 m grid (shown on the snow while you paint), with a brush 1, 2 or 3 tiles across (`[` `]`):

| Piece | What it does |
| --- | --- |
| Bump / Hollow | Raises or digs the snow. Side by side they make a ridge, a hill, a bowl or a gully; bigger areas grow higher or deeper in the middle. |
| Flat | The slope eases off: a shelf, with a lip at its lower edge to pop off. |
| Wall | A steeper pitch, easing back below. |
| Rocks | A band of rock across the slope: a cliff face to drop, a run-out below. |
| Forest / Clearing | Plants trees (they join the woods around) or opens up the natural forest. |
| Powder | Deep untouched snow, even on a piste. |

**Everything merges.** Pieces don't stamp a shape per tile: all the tiles of one kind make one mask, blurred into a smooth field that shapes the snow, so neighbours are one shape with no seam, step or edge, a bump beside a hollow rolls into it, and a piste across them simply follows the snow. A tile holds one shape, one cover and powder or not (three layers), so trees can grow on a bump. **Erase** (`X`) clears tiles.

### Snow

- The **groomed piste** is fast and grippy, with corduroy and groomer passes in the snow.
- Off the piste it's **deep powder**: slower, the skis sink, turns are softer, landings more forgiving, and the spray turns into clouds.
- **Bare rock** on cliffs, rock bands and any face too steep to hold snow (about 45°) rides like hard snow.
- **Ski tracks stay in the snow** run after run: thin carves on the piste, trenches in powder, smears where you skid. **Fresh snow** (••• menu) covers them. They're saved in the browser.

### The camera (drone view)

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Orbit | Left-drag on the snow while tracing, right-drag while painting, or pick Look (`V`) | One finger on the snow while tracing, or pick Look |
| Pan / zoom | Middle-drag / scroll | Two fingers / pinch |
| Reset the view | `R` | ••• menu |
| Relief view | `T` | Relief button |

### Riding

| Action | Keyboard | Touch |
| --- | --- | --- |
| Steer / spin in the air | `←` `→` or `A` `D` | Left thumb: slide left/right |
| Brake | `↓` / `S` on the snow | Left thumb: drag down |
| Flip in the air | `↑` front flip, `↓` backflip | Left thumb: drag up/down in the air |
| Crouch, then jump | Hold `Space`, release | Hold Jump, release |
| Absorb a big landing | Hold `Space` before touchdown | Hold Jump before touchdown |
| Restart / camera / back to building | `R` / `C` / `Esc` | Buttons top left |
| Sound | `M` | ••• menu |

Hold to load a jump (the ring fills) and release at a lip (a bump's crest, the edge of a flat, a cliff) to fly higher. Land with the skis straight and upright: clean landings score full points, sketchy ones half and cost speed, and only a really bad one is a wipeout (you lose the combo, tumble, get up and carry on). Let go of the stick in the air and the skier straightens up and finishes a nearly-complete flip by himself. Hitting the edge of the mountain just bumps you back.

**Speed bonus:** above 100 km/h a speed streak builds (40 points a second at 100 km/h, +3 per extra km/h: about 170/s at 145 km/h). It's banked once you've been back under 100 for 0.8 s, or at the finish, and lost on a wipeout. Tricks landed within 2.6 s of each other chain into a combo (×1.5, ×2, … up to ×5). A see-through ghost replays your best run.

Your mountain (its seed), pistes, pieces, best score, ghost and ski tracks autosave in the browser. Saves from older versions (before wild mountains) are kept aside, untouched, and you start on a new mountain.

## How the mountain is built

- `src/core/wild.js` generates the mountain from its seed as pure functions of position (height, rock bands, forest density), so it can be sampled at full resolution for the game or coarsely for the chooser's preview (`src/mountainPreview.js`). Its heights, rock and natural forest are computed once and kept as the base.
- `src/core/piste.js` turns waypoints into curves (centripetal Catmull-Rom: through every point, no loops or overshoot), resolves branches and joins, and carves the pistes into the snow: each cell is levelled towards the centre line's height (a quarter of the natural tilt kept), the centre line is smoothed and graded to 38° at most (half cut, half fill), banks widen where the piste cuts across a slope, and where pistes overlap their targets are blended into one surface.
- `src/core/terrain.js` holds the pieces and their fields: per kind, the painted tiles become a mask and three box blurs make it a near-gaussian field; bumps and hollows add a tight and a wide field (so big areas dome); flats, walls and rock bands change the slope along the fall line, column by column, then ease back to the mountain below.
- `src/core/world.js` puts it together on every edit: base, pistes, pieces, then the snow (groomed / powder / rock in `src/core/surface.js`) and the trees and boulders, kept off the pistes and the rock. A rebuild takes about 20 ms, so the snow follows a dragged point or a paint stroke live.
- `src/render/pisteGizmo.js` draws the waypoints (pins the same size on screen, never hidden by the snow), the dashed centre lines and the preview of the next stretch; the build grid and finish lines are drawn by the terrain shader (`src/render/terrainMesh.js`); `src/buildBar.js` is the bar at the bottom.

## Trees and rocks

They're obstacles: brushing one is a bump that costs a little speed, hitting one head-on (over ~40 km/h straight into it) is a wipeout. Rocks can be jumped. They're drawn as instanced meshes, so thousands cost a few draw calls.

## What's in the prototype

- **Heightfield terrain**: as big as the mountain (1.5 m cells, 1.8 m on the large one), kept under about 430,000 vertices for phones.
- **Skier physics**: a point mass with gravity, snow friction and air drag. It leaves the ground on its own when the slope falls away faster than gravity can follow, so bumps, lips and cliffs create real jumps. Landings are judged by impact speed into the slope: soft, rough (speed loss) or crash.
- **Tricks and style**: crouch-and-pop jumps with a short grace window after the lip, spins and front/back flips in the air, landings judged on impact, ski angle and balance, named tricks ("Switch Double Backflip 540"), combos, a results card and a ghost of your best run (`src/core/score.js`, tested).
- **Ride mode**: sending the skier drops the camera low behind him (chase cam or helmet cam) and you can steer, tuck and brake. Speed shows: the lens widens, the camera rumbles, snow sprays off the skis (rooster tails when carving, bursts on landing) and the screen edges streak. The skis have a heading and edge grip carves the velocity towards it; hands off, the skier simply follows the terrain. Land with the skis sideways and you crash.
- **Run outcomes**: finish (a finish line, or the bottom of the mountain), stopped (not enough slope), too slow.
- **Relief view** (Relief button or `T`): colours every point by how far it sits above or below its surroundings (a ~50 m blur) — crests warm orange, hollows cool blue — with low two-sun shading and 2 m / 10 m contours, so bumps, hollows and cliffs read at any distance.
- **Feedback**: live trail, the previous run as a dashed blue ghost line, topographic contours (2 m / 10 m), run stats and personal best.
- **Diorama look**: the mountain is a block with stratified sides on a base slab.

## Exit test for Phase 0

Hand it to a few people. Do they say "one more tweak" and keep going? If not, fix the feel before moving to Phase 1.

## Develop

```bash
npm install
npm run dev      # local dev server
npm test         # physics, scoring, mountains, pistes and pieces (Node, no browser needed)
npm run build    # production build into dist/
npm run smoke    # browser smoke test on the build: pick a mountain, trace and edit a piste, branch and join, paint bumps, undo, ride (needs Chromium: npx playwright install chromium)
```

Add `?debug` to the URL for a frame-cost readout (fps, worst frame, draw calls, triangles). CI (`.github/workflows/ci.yml`) runs the tests, the build and the smoke test on every pull request.

The physics runs in fixed 1/240 s steps whatever the screen's refresh rate, so a run (and the ghost of your best one) plays out identically at 60 Hz and 165 Hz.

Stack: [Vite](https://vite.dev) + [Three.js](https://threejs.org). The simulation core in `src/core/` has no Three.js dependency, so it runs in tests and can later move to a worker.

```
src/
  core/        heightfield, wild mountains, pistes, terrain pieces, skier physics, scoring (pure JS)
  render/      terrain mesh + shader, piste handles, trees and rocks, skier, spray, ski tracks
  buildBar.js  the build bar
  ui.js        overlay controls
  main.js      scene, input, game loop
tests/         node:test suites
```

## Deploy

Vercel detects Vite automatically: import the repo, keep the defaults (build `npm run build`, output `dist`), deploy.
