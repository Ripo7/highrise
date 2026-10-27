# Highrise

Design a mountain, send a skier, chase the perfect line. A browser 3D game where building the run is the gameplay.

This is **Phase 0**: a grey-box prototype to prove the core loop is fun before any art investment.

**Sculpt → send → watch → tweak → repeat.**

## Play

**Design** a run, **ride** it, and score on **style**.

### Designing the run

There are no ready-made mountains, and no drawing: **you stack sections down the slope**. Open the run editor with **Edit run** (`P`), or tap the snow anywhere to edit that spot.

- The **side view** at the top shows the whole descent at true angles, coloured like piste markers (green < 12°, blue 12–22°, red 22–32°, black 32°+). Tap it to pick a section.
- Each **section** has a slope (−20° climb to 55°), a length (20–300 m), a groomed **piste** width (20–140 m), a **bend** (the piste drifts left or right by the end of the section), **ups & downs** (flat, gentle, rolling or big waves) and **forest** beside the piste (open, glades or dense). Steppers repeat when held. Move, duplicate, clear or delete sections; up to 40 sections and 4 km.
- Each section has a **grid**: 7 columns of 20 m cells across the piste, one row per 20 m. Tap a cell to put an **element** in it, pick its size (small, medium, large), or remove it. Big elements run over several rows.
- New runs start from a template: **Blue cruiser**, **Park lap**, **Backcountry** or **Blank**.
- **Build this run** turns it into the 3D mountain. Editing a run keeps your hand sculpting and your ski tracks in place along it.

### Elements

| Category | Elements |
| --- | --- |
| Jumps | Kicker, Table, Berm, Rollers |
| Nature | Trees, Rock, Cliff drop, Moguls, Gully, Cornice, Frozen lake (ice) |
| Park | Rail, Box (ride onto them lined up to grind), Half-pipe |
| Resort | Chalet (hut, chalet, lodge), Lift pylon (pylons in the same column are joined by a chairlift with moving chairs), Bridge, Tunnel |
| Piste | Safety net (it catches you), Piste poles (in the section's colour), Slalom gate (+150 each), Snow cannon (blows a plume of snow) |

The catalogue is `src/core/elements.js`; collisions, grinding and gates are in `src/core/structures.js`; the meshes in `src/render/structureMeshes.js`.

### Snow

- The **groomed piste** is fast and grippy, with corduroy and groomer passes in the snow.
- Off the piste it's **deep powder**: slower, the skis sink, turns are softer, landings more forgiving, and the spray turns into clouds.
- **Ice** (frozen lakes) is slick, with little grip.
- **Ski tracks stay in the snow** run after run: thin carves on the piste, trenches in powder, smears where you skid. **Fresh snow** (••• menu) covers them. They're saved in the browser.

### The 3D view

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Edit the run | `P`, or click the snow (Orbit tool) | Edit run, or tap the snow |
| Orbit | Left-drag (Orbit tool), right-drag or Alt-drag | One finger (Orbit tool) |
| Pan / zoom | Middle-drag / scroll | Two fingers / pinch |
| Move the start gate | `5` then click | Start |
| Relief view | `T` | Relief button |
| Hand sculpting | **Advanced** (`A`): raise / lower / smooth / flatten `1`–`4`, Build `B` (kicker, table, berm, rollers, tree, rock, forest, clear), Size and Strength sliders, undo / redo | Same |

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

Your run, hand sculpting, start gate, best score, ghost and ski tracks autosave in the browser.

## How a run is built

`src/core/run.js` holds the model (sections, templates, the save format, and the conversion of older drawn runs into sections). `src/core/build.js` turns it into the mountain: the slopes are eased into each other over about ±10 m and integrated into the profile, the piste follows the bends as a groomed lane with a small ridge of snow at its edge, powder pillows and forest grow outside it, then the elements are built on top (snow first, then trees, rocks and structures). `src/core/surface.js` records groomed / powder / ice for the physics and the snow shader. The run editor is `src/runEditor.js`.

## Trees and rocks

Forest grows beside the piste, section by section (open, glades or dense): patches of woods with glades between them, thinning out next to the piste so the powder there is rideable, thicker towards the far edges, and rocks on the steep bits. The piste itself, the start, the finish and every element's footprint (and a kicker's landing) are kept clear. They're obstacles: brushing one is a bump that costs a little speed, hitting one head-on (over ~40 km/h straight into it) is a wipeout. Rocks can be jumped. Add more with Trees and Rock elements, or by hand with the Build tool in Advanced; hand-placed ones are part of undo, saved with the run, and stay at the same distance down the run when you edit it. They're drawn as two instanced meshes, so thousands cost two draw calls.

## What's in the prototype

- **Heightfield terrain**: 480 m wide, as long as the designed run (1.5 m cells, up to 2.15 m on a 4 km run) with raise, lower, smooth and flatten brushes, soft cosine falloff and a live cursor ring.
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
npm test         # physics + brush tests (Node, no browser needed)
npm run build    # production build into dist/
npm run smoke    # browser smoke test on the build: design a run, tap to edit, build a kicker, ride (needs Chromium: npx playwright install chromium)
```

Add `?debug` to the URL for a frame-cost readout (fps, worst frame, draw calls, triangles). CI (`.github/workflows/ci.yml`) runs the tests, the build and the smoke test on every pull request.

The physics runs in fixed 1/240 s steps whatever the screen's refresh rate, so a run (and the ghost of your best one) plays out identically at 60 Hz and 165 Hz.

Stack: [Vite](https://vite.dev) + [Three.js](https://threejs.org). The simulation core in `src/core/` has no Three.js dependency, so it runs in tests and can later move to a worker.

```
src/
  core/        heightfield, brushes, undo history, skier physics (pure JS)
  render/      terrain mesh + shader, skier mesh, trails
  ui.js        overlay controls
  main.js      scene, input, game loop
tests/         node:test suites
```

## Deploy

Vercel detects Vite automatically: import the repo, keep the defaults (build `npm run build`, output `dist`), deploy.
