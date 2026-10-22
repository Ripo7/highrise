# Highrise

Sculpt a mountain, send a skier, chase the perfect line. A browser 3D game where shaping the terrain is the gameplay.

This is **Phase 0**: a grey-box prototype to prove the core loop is fun before any art investment.

**Sculpt → send → watch → tweak → repeat.**

## Play

**Build** a playground on the mountain, **ride** it, and score on **style**.

### Building

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Raise / lower / smooth / flatten | `1`–`4`, left-drag (hold to keep building) | Tool bar, one finger |
| Build a feature | `B` (press again to cycle Kicker → Table → Berm → Rollers → Tree → Rock → Forest → Clear), drag along the run | Build, then pick a feature and drag |
| Trees and rocks | Build → Tree / Rock: tap (drag for a row) · Forest: drag to paint · Clear: drag to erase | Same |
| Feature width / height | Size and Strength sliders (they read Width / Height in Build) | Same |
| Move the start gate | `5` then click | Start |
| Orbit | Right-drag or Alt-drag | Orbit tool, one finger |
| Pan / zoom | Middle-drag / scroll | Two fingers / pinch |
| Relief view | `T` | Relief button |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` | Buttons |
| Brush size | `[` `]` | Slider |

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

Your run profile, sculpting, start gate, best score and ghost autosave in the browser.

## Your run

There are no ready-made mountains: **you draw the descent**. The run designer is a side view of the slope with a start flag. Drag from the flag down and to the right; the line follows your finger, and its angle is the real slope angle (1:1), coloured like piste markers (green < 12°, blue 12–22°, red 22–32°, black 32°+). Hold near the right edge and the view zooms out so the run keeps growing, up to 4 km. Press on the line to redraw from that point, move back to erase, undo a stroke. **Build this run** turns it into a 480 m wide 3D piste.

Open the designer again any time with **Profile** (`P`): your kickers and sculpting stay at the same distance down the run when you rebuild. **New run** (••• menu) starts from a blank page.

Profiles live in `src/core/profile.js` (resampling, smoothing, slope limits, the 3D build and carrying sculpting across); the designer is `src/profileEditor.js`. Long runs use slightly coarser terrain cells so the mesh stays under ~420k vertices for phones.

## Trees and rocks

Every new run grows forest along both sides, clumps of trees and boulders further in, and rocks on the steep bits, with a clear lane down the middle (`src/core/props.js`). They're obstacles: brushing one is a bump that costs a little speed, hitting one head-on (over ~40 km/h straight into it) is a wipeout. Rocks can be jumped. Add or remove them with the Build tool; they're part of undo, saved with the run, and stay at the same distance down the run when you redraw the profile (a longer run grows new forest on the extra part). They're drawn as two instanced meshes, so thousands cost two draw calls.

## What's in the prototype

- **Heightfield terrain**: 480 m wide, as long as the drawn run (1.5 m cells, up to 2.15 m on a 4 km run) with raise, lower, smooth and flatten brushes, soft cosine falloff and a live cursor ring.
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
npm run smoke    # browser smoke test on the build: draw a run, build a kicker, ride (needs Chromium: npx playwright install chromium)
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
