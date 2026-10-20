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
| Build a feature | `B` (press again to cycle Kicker → Table → Berm → Rollers), drag along the run | Build, then pick a feature and drag |
| Feature width / height | Size and Strength sliders (they read Width / Height in Build) | Same |
| Move the start gate | `5` then click | Start |
| Orbit | Right-drag or Alt-drag | Orbit tool, one finger |
| Pan / zoom | Middle-drag / scroll | Two fingers / pinch |
| Predicted line | `L` | Line button |
| Relief view | `T` | Relief button |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` | Buttons |
| Brush size | `[` `]` | Slider |

The **predicted line** reruns a hands-off skier every time you change the terrain (in a background thread) and draws where he'd go: blue dashes on the snow, orange arcs through the air, and a ring at each landing (green clean, amber sketchy, red wipeout).

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

Hold to load a jump (the ring fills) and release at a kicker's lip to fly higher. Land with the skis straight and upright: clean landings score full points, sketchy ones half and cost speed, and a bad one is a wipeout (you lose the combo, tumble, get up and carry on). Tricks landed within 2.6 s of each other chain into a combo (×1.5, ×2, … up to ×5). A see-through ghost replays your best run.

Your mountain, start gate, best score and ghost autosave in the browser. **New mountain** opens the picker.

## Mountains

Every run is 1.2 km long and 480 m wide. Start from:

| Mountain | Level | Hands-off run |
| --- | --- | --- |
| Blank slope | Build it yourself | An even 18° face, ~39 s, 133 km/h |
| Meander Valley | Easy | Wide banked bends down a rolling valley, ~52 s, 131 km/h |
| Kicker Line | Jumps | Five kickers with long landing hills (1.4–2.3 s of air) plus a roller lane, ~39 s, 147 km/h |
| Couloir | Expert | Wide steep bowl, narrow couloir, mogul field, fast finish, ~41 s, 150 km/h |

Templates live in `src/core/templates.js`: each is a slope profile along the run plus a cross-section function, so new ones are quick to add. The tests check that every template is skiable hands-off without crashing, takes over 30 s and tops 110 km/h.

## What's in the prototype

- **Heightfield terrain** (321 × 801 samples, 1.5 m apart: a 480 m × 1200 m piste) with raise, lower, smooth and flatten brushes, soft cosine falloff and a live cursor ring.
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
```

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
