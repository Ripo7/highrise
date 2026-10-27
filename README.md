# Highrise

Design a mountain, send a skier, chase the perfect line. A browser 3D game where building the mountain is the gameplay.

This is **Phase 0**: a grey-box prototype to prove the core loop is fun before any art investment.

**Build → send → watch → tweak → repeat.**

## Play

**Build** a mountain, **ride** it, and score on **style**.

### Building the mountain

No drawing, no 2D editor: you **build straight on the 3D mountain**, like in a building game.

1. **Choose a mountain**: Gentle (about 14°, green and blue), Medium (21°, blue with red pitches) or Steep (29°, black), and Short (500 m), Medium (900 m) or Long (1.5 km). It comes with a natural descent (easier at the top, steeper pitches and rolls, a run-out at the bottom), a groomed piste meandering down, powder and forest on either side, and optionally a few starter pieces. **New mountain** (`N`, ••• menu) picks another one.
2. **Pick a piece** in the build bar at the bottom (Terrain, Jumps, Nature, Park, Resort).
3. **Drag on the snow**: a ghost of the piece follows your finger or mouse, snapped to the **10 m grid**, and the mountain shows what it will become while you drag. Release to place. Dragging lays a row (jumps, rails, poles…) or paints an area (terrain, trees, moguls…).
4. **Neighbours join up**: two kickers side by side make one wide kicker, rails or boxes end to end one long rail, chalets in a rectangle one bigger building, mounds side by side a ridge.

**Erase** (`X`) removes whatever is under the drag, **Look** (`Esc`/`V`) only moves the camera, **Rotate** (`Q`) turns the pieces that can turn (safety nets). Undo / redo (`Ctrl+Z` / `Ctrl+Shift+Z`) cover everything.

### Pieces

| Category | Pieces | How they join |
| --- | --- | --- |
| Terrain | Mound, Hollow, Flat, Steeper, Drop, Groom, Powder | Mounds, hollows, shelves and pitches blend into one surface (a ridge, a bowl, a full-width face); a drop grows with its rectangle; Groom and Powder paint the snow |
| Jumps | Kicker, Table, Wall (berm), Rollers | Kickers and tables side by side get wider; walls and rollers end to end get longer |
| Nature | Trees, Rock, Moguls, Gully, Cornice, Frozen lake | Trees paint a forest, moguls a field, lakes one sheet of ice; gullies run on and widen; cornices across make one lip |
| Park | Rail, Box, Half-pipe | Rails and boxes end to end become one long rail or box (ride onto them lined up to grind); a half-pipe gets longer |
| Resort | Chalet, Lift pylon, Bridge, Tunnel, Safety net, Piste poles, Slalom gate (+150 each), Snow cannon | Chalets in a rectangle make one building; pylons in the same column are joined by a chairlift with moving chairs; bridges across make a longer span; tunnels get longer and wider; nets join into one (rotate to run them across) |

Terrain pieces, snow (Groom, Powder) and objects sit on three layers, so a kicker can go on a mound on powder. Every piece clears the forest under it (and in front of a jump, its landing).

**Sculpt by hand** (`A`, ••• menu) adds a Sculpt tab with the raise / lower / smooth / flatten brushes for free-form touches. Hand sculpting is stored on top of the pieces, so it survives adding or removing pieces.

The catalogue and the merge rules are `src/core/pieces.js`; the mountains `src/core/mountain.js`; collisions, grinding and gates `src/core/structures.js`; the meshes `src/render/structureMeshes.js`.

### Snow

- The **groomed piste** is fast and grippy, with corduroy and groomer passes in the snow.
- Off the piste it's **deep powder**: slower, the skis sink, turns are softer, landings more forgiving, and the spray turns into clouds.
- **Ice** (frozen lakes) is slick, with little grip.
- **Ski tracks stay in the snow** run after run: thin carves on the piste, trenches in powder, smears where you skid. **Fresh snow** (••• menu) covers them. They're saved in the browser.

### The camera (drone view)

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Orbit | Right-drag, Alt-drag, or left-drag with Look | One finger with Look |
| Pan / zoom | Middle-drag / scroll | Two fingers / pinch (with any piece) |
| Reset the view | `R` | ••• menu |
| Relief view | `T` | Relief button |
| Move the start gate | `G` then click | ••• menu |

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

Hold to load a jump (the ring fills) and release at a kicker's lip to fly higher. Land with the skis straight and upright: clean landings score full points, sketchy ones half and cost speed, and only a really bad one is a wipeout (you lose the combo, tumble, get up and carry on). Let go of the stick in the air and the skier straightens up and finishes a nearly-complete flip by himself. Hitting the edge of the piste just bumps you back.

**Speed bonus:** above 100 km/h a speed streak builds (40 points a second at 100 km/h, +3 per extra km/h: about 170/s at 145 km/h). It's banked once you've been back under 100 for 0.8 s, or at the finish, and lost on a wipeout. Tricks landed within 2.6 s of each other chain into a combo (×1.5, ×2, … up to ×5). A see-through ghost replays your best run.

Your mountain, pieces, hand sculpting, start gate, best score, ghost and ski tracks autosave in the browser. Runs drawn in older versions are kept as a mountain of their own.

## How the mountain is built

`src/core/mountain.js` makes the base once per mountain: the descent profile, the meandering piste (groomed, with a small ridge of snow at its edge), powder pillows and forest outside it. `src/core/world.js` resets the snow to that base and builds the pieces on it (`applyPieces` in `src/core/pieces.js`): terrain first, then the snow layer, then the objects, each group of joined tiles built as one piece. Rebuilding takes a few milliseconds, which is what lets the ghost show the mountain changing while you drag. `src/core/surface.js` records groomed / powder / ice for the physics and the snow shader; the build grid is drawn on the terrain by its shader (`src/render/terrainMesh.js`). The build bar is `src/buildBar.js`.

## Trees and rocks

Forest grows beside the piste: patches of woods with glades between them, thinning out next to the piste so the powder there is rideable, thicker towards the far edges, and rocks on the steep bits. The piste itself, the start, the finish and every piece's footprint (and a kicker's landing) are kept clear. They're obstacles: brushing one is a bump that costs a little speed, hitting one head-on (over ~40 km/h straight into it) is a wipeout. Rocks can be jumped. Add more with the Trees and Rock pieces. They're drawn as two instanced meshes, so thousands cost two draw calls.

## What's in the prototype

- **Heightfield terrain**: 480 m wide, as long as the mountain (1.5 m cells, up to 2.15 m on a 4 km run) with raise, lower, smooth and flatten brushes, soft cosine falloff and a live cursor ring.
- **Skier physics**: a point mass with gravity, snow friction and air drag. It leaves the ground on its own when the slope falls away faster than gravity can follow, so kickers and crests create real jumps. Landings are judged by impact speed into the slope: soft, rough (speed loss) or crash.
- **Tricks and style**: crouch-and-pop jumps with a short grace window after the lip, spins and front/back flips in the air, landings judged on impact, ski angle and balance, named tricks ("Switch Double Backflip 540"), combos, a results card and a ghost of your best run (`src/core/score.js`, tested).
- **Ride mode**: sending the skier drops the camera low behind him (chase cam or helmet cam) and you can steer, tuck and brake. Speed shows: the lens widens, the camera rumbles, snow sprays off the skis (rooster tails when carving, bursts on landing) and the screen edges streak. The skis have a heading and edge grip carves the velocity towards it; hands off, the skier simply follows the terrain. Land with the skis sideways and you crash.
- **Run outcomes**: finish, crash, stopped (not enough slope), off the edge, too slow.
- **Relief view** (Relief button or `T`): colours every point by how far it sits above or below its surroundings (a ~50 m blur) — crests warm orange, hollows cool blue — with low two-sun shading and 2 m / 10 m contours, so bumps, trenches and kickers read at any distance.
- **Feedback**: live trail, the previous run as a dashed blue ghost line, topographic contours (2 m / 10 m), run stats and personal best.
- **Diorama look**: the mountain is a block with stratified sides on a base slab.

## Exit test for Phase 0

Hand it to a few people. Do they say "one more tweak" and keep going? If not, fix the feel before moving to Phase 1.

## Develop

```bash
npm install
npm run dev      # local dev server
npm test         # physics, scoring, pieces and brush tests (Node, no browser needed)
npm run build    # production build into dist/
npm run smoke    # browser smoke test on the build: choose a mountain, build pieces, erase, undo, ride (needs Chromium: npx playwright install chromium)
```

Add `?debug` to the URL for a frame-cost readout (fps, worst frame, draw calls, triangles). CI (`.github/workflows/ci.yml`) runs the tests, the build and the smoke test on every pull request.

The physics runs in fixed 1/240 s steps whatever the screen's refresh rate, so a run (and the ghost of your best one) plays out identically at 60 Hz and 165 Hz.

Stack: [Vite](https://vite.dev) + [Three.js](https://threejs.org). The simulation core in `src/core/` has no Three.js dependency, so it runs in tests and can later move to a worker.

```
src/
  core/        heightfield, mountains, pieces, structures, skier physics, scoring (pure JS)
  render/      terrain mesh + shader, structures, skier, spray, ski tracks
  buildBar.js  the build bar
  ui.js        overlay controls
  main.js      scene, input, game loop
tests/         node:test suites
```

## Deploy

Vercel detects Vite automatically: import the repo, keep the defaults (build `npm run build`, output `dist`), deploy.
